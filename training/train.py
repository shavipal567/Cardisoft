"""Train CAD + LAD/LCX/RCA classifiers (leakage-safe).

For each target: stratified 80/20 split (seed 42) + REPEATED stratified 5-fold
CV on train (default 10 repeats, seeds 42..51); preprocessors fitted on each
training fold, including inner ensemble folds. Best model by mean CV ROC-AUC
(tie-break mean CV F1) is refit on full train and saved with its preprocessor under
training/artifacts/<target>/. Voting F1 uses each fold's tuned threshold;
other candidates use 0.5.

Three prep tracks: "onehot" (shared one-hot preprocessor), "native"
(integer-coded categoricals for LightGBM / CatBoost), and "voting" (one-hot
plus StandardScaler). Stacking and voting fit fresh preprocessors on inner
training rows for their out-of-fold predictions. All classifiers return two-column
probabilities; the saved layout is preprocessor.joblib + model.joblib.

New runs default to target-specific engineered features: CAD logs, LAD counts,
LCX ratios+counts, RCA baseline. --feature-set overrides this fixed policy.
Feature engineering is saved inside the preprocessor, before fitted imputation.
"""

import argparse
import csv
import datetime
import hashlib
import json
import shutil
import subprocess
import time
from dataclasses import dataclass
from itertools import product
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import (average_precision_score, brier_score_loss,
                              f1_score, log_loss, roc_auc_score)
from sklearn.model_selection import (StratifiedGroupKFold, StratifiedKFold,
                                    train_test_split)
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

from calibration import CalibratedBinaryModel, FeatureSchema, ProbabilityCalibrator
from clinical_metrics import binary_metrics, operating_thresholds
from learning_curves import save_learning_curves
from native_models import CatBoostNative
from preprocessing import (ALL_INPUT_FEATURES, FEATURE_SETS, LEAKAGE_COLUMNS,
                            NATIVE_CAT_FEATURES, TARGETS,
                            build_native_preprocessor, build_preprocessor,
                            build_voting_preprocessor,
                            engineered_feature_names, native_cat_indices,
                            resolve_feature_set, split_features_target)
from stacking import StackedModel
from voting import (VotingClassifier, build_voting_estimators,
                    optimize_voting_weights_and_threshold)

RANDOM_STATE = 42
TEST_SIZE = 0.2
CV_FOLDS = 5
DEFAULT_REPEATS = 10

HERE = Path(__file__).resolve().parent
ARTIFACTS_DIR = HERE / "artifacts"
DATASET = HERE.parent / "dataset" / "dataset.csv"
EXPERIMENTS_CSV = ARTIFACTS_DIR / "experiments.csv"

RF_GRID = {
    "n_estimators": [200, 400],
    "max_depth": [8, None],
    "min_samples_leaf": [1, 2],
}
XGB_GRID = {
    "n_estimators": [200, 400],
    "max_depth": [3, 4],
    "learning_rate": [0.05, 0.1],
}
HGB_GRID = {
    "learning_rate": [0.05],
    "max_leaf_nodes": [15, 31],
    "min_samples_leaf": [10, 20],
}
LGBM_GRID = {
    "num_leaves": [7, 15, 31],
    "min_child_samples": [10, 20],
    "learning_rate": [0.05],
}
CAT_GRID = {
    "depth": [4, 6],
    "learning_rate": [0.05],
    "l2_leaf_reg": [3, 10],
}


def make_configs(y_train):
    scale_pos = float((len(y_train) - y_train.sum()) / max(y_train.sum(), 1))
    configs = []
    for v in product(*RF_GRID.values()):
        configs.append({"model": "rf", "prep": "onehot",
                        "params": dict(zip(RF_GRID.keys(), v))})
    for v in product(*XGB_GRID.values()):
        configs.append({"model": "xgb", "prep": "onehot",
                        "params": dict(zip(XGB_GRID.keys(), v))})
    for v in product(*HGB_GRID.values()):
        configs.append({"model": "hgb", "prep": "onehot",
                        "params": dict(zip(HGB_GRID.keys(), v))})
    for v in product(*LGBM_GRID.values()):
        configs.append({"model": "lgbm", "prep": "native",
                        "params": dict(zip(LGBM_GRID.keys(), v))})
    for v in product(*CAT_GRID.values()):
        configs.append({"model": "cat", "prep": "native",
                        "params": dict(zip(CAT_GRID.keys(), v))})
    configs.append({"model": "stack", "prep": "onehot", "params": {}})
    configs.append({"model": "vote", "prep": "voting", "params": {}})
    return configs, scale_pos


def build_prep(prep, feature_set="baseline"):
    if prep == "native":
        return build_native_preprocessor(feature_set)
    if prep == "voting":
        return build_voting_preprocessor(feature_set)
    return build_preprocessor(feature_set)


def build_estimator(kind, params, scale_pos):
    if kind == "rf":
        return RandomForestClassifier(
            n_jobs=-1, random_state=RANDOM_STATE, class_weight="balanced", **params
        )
    if kind == "xgb":
        return XGBClassifier(
            n_estimators=params["n_estimators"],
            max_depth=params["max_depth"],
            learning_rate=params["learning_rate"],
            subsample=0.8,
            colsample_bytree=0.8,
            reg_lambda=1.0,
            scale_pos_weight=scale_pos,
            tree_method="hist",
            eval_metric="logloss",
            n_jobs=-1,
            random_state=RANDOM_STATE,
        )
    if kind == "hgb":
        return HistGradientBoostingClassifier(
            learning_rate=params["learning_rate"],
            max_leaf_nodes=params["max_leaf_nodes"],
            min_samples_leaf=params["min_samples_leaf"],
            class_weight="balanced",
            random_state=RANDOM_STATE,
        )
    if kind == "lgbm":
        from native_models import LGBMArrayClassifier
        return LGBMArrayClassifier(
            n_estimators=300,
            num_leaves=params["num_leaves"],
            min_child_samples=params["min_child_samples"],
            learning_rate=params["learning_rate"],
            feature_fraction=0.8,
            verbose=-1,
            force_col_wise=True,
            n_jobs=-1,
            random_state=RANDOM_STATE,
        )
    if kind == "cat":
        from native_models import CatBoostNative
        return CatBoostNative(
            iterations=400,
            depth=params["depth"],
            learning_rate=params["learning_rate"],
            l2_leaf_reg=params["l2_leaf_reg"],
            auto_class_weights="Balanced",
            verbose=False,
            allow_writing_files=False,
            random_seed=RANDOM_STATE,
        )
    raise ValueError(f"unknown model kind: {kind}")


def make_stack_bases(scale_pos):
    return [
        ("rf", RandomForestClassifier(n_estimators=400, max_depth=None,
                                      min_samples_leaf=1, n_jobs=-1,
                                      random_state=RANDOM_STATE,
                                      class_weight="balanced")),
        ("xgb", XGBClassifier(n_estimators=400, max_depth=4, learning_rate=0.05,
                              subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0,
                              scale_pos_weight=scale_pos, tree_method="hist",
                              eval_metric="logloss", n_jobs=-1,
                              random_state=RANDOM_STATE)),
        ("hgb", HistGradientBoostingClassifier(learning_rate=0.05,
                                               max_leaf_nodes=31,
                                               min_samples_leaf=20,
                                               class_weight="balanced",
                                               random_state=RANDOM_STATE)),
    ]


def fit_voting(scale_pos, X, y, cv=5, seed=RANDOM_STATE, *, preprocessor):
    """Tune on raw training rows with inner-fold preprocessing, then refit.

    The seed controls member estimators and inner CV. Outer-fold scoring uses
    three inner folds; stability and final refitting use five by default.
    The supplied preprocessor is fitted on all X only after tuning and is
    saved separately from the returned model, which accepts transformed inputs.
    """
    estimators = build_voting_estimators(scale_pos, random_state=seed)
    best, _ = optimize_voting_weights_and_threshold(
        estimators, X, y, cv=cv, seed=seed, preprocessor=preprocessor,
    )
    Xt = preprocessor.fit_transform(X, y)
    return VotingClassifier(
        estimators,
        weights=best["weights"],
        threshold=best["threshold"],
    ).fit(Xt, y)


def fit_with_track(kind, params, scale_pos, prep, X_tr, y_tr,
                   *, seed=RANDOM_STATE, voting_cv=5, feature_set="baseline"):
    pre = build_prep(prep, feature_set)
    if kind == "vote":
        return pre, fit_voting(scale_pos, X_tr, y_tr.values,
                               cv=voting_cv, seed=seed, preprocessor=pre)
    if kind == "stack":
        clf = StackedModel(make_stack_bases(scale_pos), random_state=seed).fit(
            X_tr, y_tr.values, preprocessor=pre,
        )
        return pre, clf
    Xt = pre.fit_transform(X_tr, y_tr.values)
    clf = build_estimator(kind, params, scale_pos)
    fit_kwargs: dict = {}
    if prep == "native" and kind in ("lgbm", "cat"):
        key = "categorical_feature" if kind == "lgbm" else "cat_features"
        fit_kwargs[key] = native_cat_indices(feature_set)
    clf.fit(Xt, y_tr.values, **fit_kwargs)
    return pre, clf


def repeated_cv_scores(cfg, X_train, y_train, scale_pos, seeds,
                       *, first_fold_callback=None):
    aucs, f1s, praucs, briers = [], [], [], []
    for seed in seeds:
        skf = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=seed)
        for tr_idx, va_idx in skf.split(X_train, y_train):
            X_tr, X_va = X_train.iloc[tr_idx], X_train.iloc[va_idx]
            y_tr, y_va = y_train.iloc[tr_idx], y_train.iloc[va_idx]
            pre, clf = fit_with_track(
                cfg["model"], cfg["params"], scale_pos, cfg["prep"], X_tr, y_tr,
                seed=seed, voting_cv=3, feature_set=cfg.get("feature_set", "baseline"),
            )
            if first_fold_callback is not None and not aucs:
                first_fold_callback({
                    "model": clf, "preprocessor": pre,
                    "X_train": X_tr, "y_train": y_tr,
                    "X_valid": X_va, "y_valid": y_va,
                })
            proba = clf.predict_proba(pre.transform(X_va))[:, 1]
            pred = (proba >= getattr(clf, "threshold", 0.5)).astype(int)
            aucs.append(roc_auc_score(y_va, proba))
            f1s.append(f1_score(y_va, pred))
            praucs.append(average_precision_score(y_va, proba))
            briers.append(brier_score_loss(y_va, proba))
    return {
        "cv_roc_auc": float(np.mean(aucs)),
        "cv_roc_auc_std": float(np.std(aucs)),
        "cv_f1": float(np.mean(f1s)),
        "cv_pr_auc": float(np.mean(praucs)),
        "cv_brier": float(np.mean(briers)),
        "n_scores": len(aucs),
    }


def stability_jaccard(kind, params, scale_pos, prep, X_train, y_train, seeds, k=10,
                     *, feature_set="baseline"):
    """Mean pairwise Jaccard of top-k gain importances across repeat seeds."""
    tops = []
    for r, seed in enumerate(seeds):
        if kind in ("stack", "vote"):
            _, clf = fit_with_track(
                kind, params, scale_pos, prep, X_train, y_train, seed=seed,
                feature_set=feature_set,
            )
            imp = np.asarray(clf.feature_importances_, dtype=float)
        else:
            pre = build_prep(prep, feature_set).fit(X_train)
            Xt = pre.transform(X_train)
            clf = build_estimator(kind, params, scale_pos)
            # Vary the model seed per repeat so overlap is meaningful.
            for attr in ("random_state", "random_seed"):
                try:
                    clf.set_params(**{attr: 42 + r})
                    break
                except Exception:
                    continue
            fit_kwargs = {}
            if prep == "native" and kind in ("lgbm", "cat"):
                key = ("categorical_feature" if kind == "lgbm"
                       else "cat_features")
                fit_kwargs[key] = native_cat_indices(feature_set)
            clf.fit(Xt, y_train.values, **fit_kwargs)
            imp = np.asarray(getattr(clf, "feature_importances_", None),
                             dtype=float)
            if imp is None or imp.size == 0:
                return float("nan")
        tops.append(set(np.argsort(-imp)[:k].tolist()))
    sims = []
    for i in range(len(tops)):
        for j in range(i + 1, len(tops)):
            sims.append(len(tops[i] & tops[j]) / max(len(tops[i] | tops[j]), 1))
    return float(np.mean(sims)) if sims else float("nan")


def append_experiment(row):
    exists = EXPERIMENTS_CSV.exists()
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    fields = list(row)
    if exists:
        with EXPERIMENTS_CSV.open(newline="") as handle:
            reader = csv.DictReader(handle)
            fields = list(reader.fieldnames or [])
            old_rows = list(reader)
        additions = [name for name in row if name not in fields]
        if additions:
            fields.extend(additions)
            temporary = EXPERIMENTS_CSV.with_suffix(".csv.tmp")
            with temporary.open("w", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                for old in old_rows:
                    old.setdefault("feature_set", "baseline")
                    writer.writerow(old)
            temporary.replace(EXPERIMENTS_CSV)
    with open(EXPERIMENTS_CSV, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        if not exists:
            w.writeheader()
        w.writerow(row)


def train_target(key, df, repeats, learning_curves="best", *, feature_set="auto"):
    if learning_curves not in ("best", "all", "none"):
        raise ValueError("learning_curves must be 'best', 'all', or 'none'")
    if repeats < 1:
        raise ValueError("repeats must be at least 1")
    cfg = TARGETS[key]
    feature_set = resolve_feature_set(feature_set, key)
    X, y = split_features_target(df, cfg["column"], cfg["positive"])
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, stratify=y, random_state=RANDOM_STATE
    )
    seeds = [RANDOM_STATE + r for r in range(repeats)]
    configs, scale_pos = make_configs(y_train)
    configs = [{**candidate, "feature_set": feature_set} for candidate in configs]
    print(f"[{key}] feature set: {feature_set}", flush=True)
    try:
        git_hash = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=HERE.parent, text=True).strip()
    except Exception:
        git_hash = "unknown"
    started = datetime.datetime.now(datetime.timezone.utc)
    stamp = started.isoformat()
    out_dir = ARTIFACTS_DIR / key
    curve_run = out_dir / "learning_curves" / started.strftime("%Y%m%dT%H%M%S%fZ")

    def write_curves(entry, first_fold, config_index):
        directory = curve_run / f"{config_index:02d}_{entry['model']}_{entry['prep']}"
        save_learning_curves(directory, **first_fold, context={
            "target": key, "model": entry["model"], "prep": entry["prep"],
            "params": entry["params"], "timestamp": stamp, "git_hash": git_hash,
            "feature_set": feature_set,
            "seed": seeds[0], "fold": 1, "cv_folds": CV_FOLDS,
        })
        entry["learning_curves"] = str(directory.relative_to(out_dir))
        print(f"[{key}] saved learning curves: {directory}", flush=True)

    results = []
    best_fold, best_index, best_score = None, None, (-float("inf"), -float("inf"))
    for config_index, c in enumerate(configs, 1):
        first_fold = {}
        scores = repeated_cv_scores(
            c, X_train, y_train, scale_pos, seeds,
            first_fold_callback=first_fold.update if learning_curves != "none" else None,
        )
        entry = {"model": c["model"], "prep": c["prep"], "params": c["params"],
                 "feature_set": feature_set,
                 **scores}
        results.append(entry)
        if learning_curves == "all":
            write_curves(entry, first_fold, config_index)
        score = (scores["cv_roc_auc"], scores["cv_f1"])
        if score > best_score:
            best_fold, best_index, best_score = first_fold, config_index, score
        print(f"[{key}] {c['model']}/{c['prep']} {c['params']} "
              f"-> AUC={scores['cv_roc_auc']:.4f}±{scores['cv_roc_auc_std']:.4f} "
              f"F1={scores['cv_f1']:.4f} PRAUC={scores['cv_pr_auc']:.4f} "
              f"Brier={scores['cv_brier']:.4f}", flush=True)
        append_experiment({
            "timestamp": stamp, "git_hash": git_hash, "target": key,
            "model": c["model"], "prep": c["prep"],
            "feature_set": feature_set,
            "params": json.dumps(c["params"]), "n_repeats": repeats,
            "cv_roc_auc_mean": round(scores["cv_roc_auc"], 4),
            "cv_roc_auc_std": round(scores["cv_roc_auc_std"], 4),
            "cv_f1_mean": round(scores["cv_f1"], 4),
            "cv_pr_auc_mean": round(scores["cv_pr_auc"], 4),
            "cv_brier_mean": round(scores["cv_brier"], 4),
        })

    best = sorted(results, key=lambda r: (r["cv_roc_auc"], r["cv_f1"]),
                  reverse=True)[0]
    print(f"[{key}] BEST: {best}", flush=True)
    if learning_curves == "best":
        write_curves(best, best_fold, best_index)
    stab = stability_jaccard(best["model"], best["params"], scale_pos,
                             best["prep"], X_train, y_train, seeds, feature_set=feature_set)
    print(f"[{key}] winner stability top-10 Jaccard: {stab:.3f}", flush=True)

    # Refit winner on full train (preprocessor fit on train only).
    pre, clf = fit_with_track(best["model"], best["params"], scale_pos,
                              best["prep"], X_train, y_train, feature_set=feature_set)

    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(pre, out_dir / "preprocessor.joblib")
    joblib.dump(clf, out_dir / "model.joblib")
    # Explainability background: up to 100 transformed train rows.
    Xt = pre.transform(X_train)
    background_indices = np.random.RandomState(RANDOM_STATE).choice(
        len(Xt), size=min(100, len(Xt)), replace=False)
    bg = np.asarray(Xt)[background_indices]
    np.savez_compressed(out_dir / "shap_background.npz", background=bg)
    # Recompute ratios/counts from raw inputs during patient explanations.
    joblib.dump(X_train.iloc[background_indices], out_dir / "shap_raw_background.joblib")
    schema = {"input_features": ALL_INPUT_FEATURES,
              "output_features": pre.get_feature_names_out().tolist(),
              "feature_set": feature_set, "engineered_features": engineered_feature_names(feature_set)}
    (out_dir / "feature_schema.json").write_text(json.dumps(schema, indent=2))
    meta = {
        "target": key, "csv_column": cfg["column"], "positive_label": cfg["positive"],
        "n_train": len(X_train), "n_test": len(X_test),
        "pos_rate_train": float(y_train.mean()), "pos_rate_test": float(y_test.mean()),
        "best": best, "all_cv_results": results,
        "feature_set": feature_set, "engineered_features": schema["engineered_features"],
        "n_model_features": len(schema["output_features"]),
        "feature_set_selection": "Fixed before this run; auto defaults came from exploratory development accuracy",
        "stability_top10_jaccard": stab,
        "random_state": RANDOM_STATE, "test_size": TEST_SIZE,
        "repeats": repeats, "seeds": seeds,
        "git_hash": git_hash,
        "learning_curves_mode": learning_curves,
    }
    if best["model"] == "vote":
        meta["threshold"] = float(clf.threshold)
        meta["voting_weights"] = {
            name: float(w) for (name, _), w in zip(
                clf.estimators, clf.weights or [1.0] * len(clf.estimators)
            )
        }
    (out_dir / "metadata.json").write_text(json.dumps(meta, indent=2))
    return best


def save_curves_for_saved_target(key, df):
    """Refit a saved winner's configuration on the first CV fold for diagnostics.

    Writes a new curve run; existing models, preprocessors and metadata are
    untouched. This reconstructs curves rather than recovering past logs.
    """
    target_dir = ARTIFACTS_DIR / key
    saved = json.loads((target_dir / "metadata.json").read_text())
    best = saved["best"]
    cfg = TARGETS[key]
    X, y = split_features_target(df, cfg["column"], cfg["positive"])
    X_train, _, y_train, _ = train_test_split(
        X, y, test_size=saved["test_size"], stratify=y,
        random_state=saved["random_state"],
    )
    seed = saved["seeds"][0]
    splitter = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=seed)
    tr, va = next(splitter.split(X_train, y_train))
    scale_pos = float((len(y_train) - y_train.sum()) / max(y_train.sum(), 1))
    pre, clf = fit_with_track(
        best["model"], best["params"], scale_pos, best["prep"],
        X_train.iloc[tr], y_train.iloc[tr], seed=seed, voting_cv=3,
        feature_set=best.get("feature_set", saved.get("feature_set", "baseline")),
    )
    started = datetime.datetime.now(datetime.timezone.utc)
    directory = (target_dir / "learning_curves" /
                 started.strftime("%Y%m%dT%H%M%S%fZ") / "saved_best")
    save_learning_curves(
        directory, model=clf, preprocessor=pre,
        X_train=X_train.iloc[tr], y_train=y_train.iloc[tr],
        X_valid=X_train.iloc[va], y_valid=y_train.iloc[va],
        context={
            "target": key, "model": best["model"], "prep": best["prep"],
            "params": best["params"], "timestamp": started.isoformat(),
            "feature_set": best.get("feature_set", saved.get("feature_set", "baseline")),
            "seed": seed, "fold": 1, "cv_folds": CV_FOLDS,
            "regenerated_from_saved_config": True,
            "saved_training_git_hash": saved.get("git_hash", "unknown"),
        },
    )
    print(f"[{key}] saved learning curves: {directory}", flush=True)
    return directory


def main(targets, repeats, learning_curves="best", *, curves_only=False, feature_set="auto"):
    df = pd.read_csv(DATASET)
    print(f"dataset: {df.shape}")
    for key in targets:
        if curves_only:
            save_curves_for_saved_target(key, df)
        else:
            train_target(key, df, repeats, learning_curves=learning_curves, feature_set=feature_set)


if __name__ == "__main__":
    # Keep the established entry point; the nested CAD protocol has its own
    # explicit configuration and isolated experiment outputs.
    import sys
    if "--protocol" in sys.argv:
        position = sys.argv.index("--protocol")
        if sys.argv[position + 1:position + 2] != ["nested"]:
            raise SystemExit("Supported explicit protocol: nested")
        nested_main(sys.argv[1:position] + sys.argv[position + 2:])
        raise SystemExit(0)
    ap = argparse.ArgumentParser()
    ap.add_argument("--targets", nargs="*", default=["cad", "lad", "lcx", "rca"])
    ap.add_argument("--repeats", type=int, default=DEFAULT_REPEATS)
    ap.add_argument("--feature-set", choices=["auto", *FEATURE_SETS], default="auto",
                    help="auto: CAD logs, LAD counts, LCX ratios+counts, RCA baseline; "
                         "or use one explicit feature set for all requested targets")
    ap.add_argument("--learning-curves", choices=["best", "all", "none"], default="best",
                    help="save per-stage train/validation PNGs and CSVs for the winner "
                         "(default), every candidate, or none; uses the first CV fold")
    ap.add_argument("--curves-only", action="store_true",
                    help="refit saved winning configurations on the first CV fold "
                         "to save curves, without replacing serving artifacts")
    args = ap.parse_args()
    if args.curves_only and args.learning_curves != "best":
        ap.error("--curves-only uses saved winners; --learning-curves must be best")
    if args.curves_only and args.feature_set != "auto":
        ap.error("--curves-only restores the feature set recorded in saved metadata")
    main(args.targets, args.repeats, args.learning_curves, curves_only=args.curves_only,
         feature_set=args.feature_set)


NESTED_DEFAULT_CONFIG = HERE / "configs/cad_nested.json"


def save_json(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(obj, indent=2, allow_nan=False, default=lambda x:
                         x.item() if isinstance(x, np.generic) else str(x)) + "\n")


def subset_groups(groups, indices):
    return None if groups is None else np.asarray(groups)[indices]


def cv_splits(y, groups, n_splits, seed):
    y = np.asarray(y)
    splitter = (StratifiedKFold(n_splits, shuffle=True, random_state=seed)
                if groups is None else
                StratifiedGroupKFold(n_splits, shuffle=True, random_state=seed))
    splits = list(splitter.split(np.zeros(len(y)), y, groups))
    for train, valid in splits:
        if len(np.unique(y[train])) != 2 or len(np.unique(y[valid])) != 2:
            raise ValueError("Each CV train/validation partition needs both classes")
        if groups is not None and set(np.asarray(groups)[train]) & set(np.asarray(groups)[valid]):
            raise AssertionError("Patient groups overlap")
    return splits


def split_manifest(X, splits):
    return [{"fold": k + 1, "train_rows": X.index[tr].tolist(),
             "validation_rows": X.index[va].tolist()} for k, (tr, va) in enumerate(splits)]


def fit_base(X, y, params, config, seed, *, validation=None, early_stop=False):
    pre = build_native_preprocessor(config.get("feature_set", "baseline"))
    transformed = pre.fit_transform(X, y)
    model_params = {"verbose": False, "allow_writing_files": False,
                    "random_seed": seed, "thread_count": config["thread_count"],
                    "loss_function": "Logloss", "counter_calc_method": "SkipTest",
                    **params}
    if validation is not None:
        model_params["eval_metric"] = ("Logloss:use_weights=false"
                                       if params.get("auto_class_weights", "None") != "None"
                                       else "Logloss")
    model = CatBoostNative(cat_features=native_cat_indices(config.get("feature_set", "baseline")), **model_params)
    kwargs = {}
    if validation is not None:
        kwargs["eval_set"] = (pre.transform(validation[0]), validation[1])
        kwargs["use_best_model"] = False
    if early_stop:
        kwargs["early_stopping_rounds"] = config["early_stopping_rounds"]
    model.fit(transformed, y, **kwargs)
    return pre, model


def probability_at(model, pre, X, iteration):
    return model.model.predict_proba(model._frame(pre.transform(X)),
                                     ntree_end=iteration)[:, 1]


def score_fixed_count(Xtr, ytr, Xva, yva, params, config, seed):
    pre, model = fit_base(Xtr, ytr, params, config, seed)
    p = model.predict_proba(pre.transform(Xva))[:, 1]
    return (p, float(log_loss(yva, p)),
            float(log_loss(ytr, model.predict_proba(pre.transform(Xtr))[:, 1])))


@dataclass
class Selection:
    name: str
    params: dict
    iterations: int
    inner_log_loss: float
    raw_oof: np.ndarray


def select_inner(X, y, groups, config, seed, directory, *, curves=False):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    splits = cv_splits(y, groups, config["inner_folds"], seed)
    save_json(directory / "inner_splits.json", split_manifest(X, splits))
    scores, stopping, histories = [], [], []
    best, best_key = None, None
    baseline_losses = []
    for tr, va in splits:
        _, loss, _ = score_fixed_count(X.iloc[tr], y.iloc[tr], X.iloc[va], y.iloc[va],
                                      config["baseline"], config, config["baseline"]["random_seed"])
        baseline_losses.append(loss)
    for candidate in config["candidates"]:
        best_counts = []
        for k, (tr, va) in enumerate(splits):
            params = {**candidate["params"], "iterations": config["max_iterations"]}
            pre, model = fit_base(X.iloc[tr], y.iloc[tr], params, config, seed,
                                  validation=(X.iloc[va], y.iloc[va]), early_stop=True)
            count = max(1, model.model.get_best_iteration() + 1)
            best_counts.append(count)
            stopping.append({"candidate": candidate["name"], "inner_fold": k + 1,
                             "best_iteration": count,
                             "detector_stopped_at": model.model.tree_count_})
            for split, metrics in model.model.get_evals_result().items():
                for metric, values in metrics.items():
                    histories.extend({"candidate": candidate["name"], "inner_fold": k + 1,
                        "partition": split, "native_metric": metric, "iteration": step,
                        "value": value} for step, value in enumerate(values, 1))
        counts = sorted(set(config["iteration_candidates"] +
                            [int(np.median(best_counts))]))
        evaluations = joblib.Parallel(n_jobs=config.get("search_jobs", 1))(
            joblib.delayed(score_fixed_count)(X.iloc[tr], y.iloc[tr], X.iloc[va], y.iloc[va],
                {**candidate["params"], "iterations": count}, config, seed)
            for count in counts for tr, va in splits)
        for count_index, count in enumerate(counts):
            oof = np.zeros(len(y))
            valid_losses, train_losses = [], []
            for k, (tr, va) in enumerate(splits):
                p, valid_loss, train_loss = evaluations[count_index * len(splits) + k]
                oof[va] = p
                valid_losses.append(valid_loss)
                train_losses.append(train_loss)
            score = {"candidate": candidate["name"], "iterations": count,
                     "inner_train_log_loss_mean": float(np.mean(train_losses)),
                     "inner_validation_log_loss_mean": float(np.mean(valid_losses)),
                     "inner_validation_log_loss_std": float(np.std(valid_losses, ddof=1)),
                     "from_early_stopping_median": count == int(np.median(best_counts)),
                     "params": json.dumps(candidate["params"], sort_keys=True)}
            scores.append(score)
            key = (score["inner_validation_log_loss_mean"], count, candidate["name"])
            if best_key is None or key < best_key:
                best_key = key
                best = Selection(candidate["name"], candidate["params"], count, key[0], oof.copy())
    pd.DataFrame(scores).to_csv(directory / "inner_search.csv", index=False)
    pd.DataFrame(stopping).to_csv(directory / "early_stopping.csv", index=False)
    pd.DataFrame(histories).to_csv(directory / "native_training_history.csv", index=False)
    save_json(directory / "selection.json", {
        "candidate": best.name, "params": best.params, "iterations": best.iterations,
        "inner_validation_log_loss": best.inner_log_loss,
        "baseline_inner_validation_log_loss": float(np.mean(baseline_losses)) if baseline_losses else None,
        "criterion": "Minimum mean unweighted inner-validation log loss; ties: fewer iterations, name",
    })
    if curves:
        tr, va = splits[0]
        for name, params in [("baseline", config["baseline"]),
                             ("selected", {**best.params, "iterations": config["max_iterations"]}),
                             ("selected_fixed_count", {**best.params, "iterations": best.iterations})]:
            pre, model = fit_base(X.iloc[tr], y.iloc[tr], params, config, seed)
            save_learning_curves(directory / "learning_curves" / name, model=model,
                preprocessor=pre, X_train=X.iloc[tr], y_train=y.iloc[tr],
                X_valid=X.iloc[va], y_valid=y.iloc[va], context={
                    "target": "cad", "model": "cat", "seed": seed, "fold": 1,
                    "fold_label": ("Inner CV fold 1 (actual selected-count fit)"
                                   if name == "selected_fixed_count" else
                                   "Inner CV fold 1 (diagnostic full path)"),
                    "source": ("inner_cv_selected_count" if name == "selected_fixed_count"
                               else "inner_cv_diagnostic"), "params": params,
                    "selected_iteration": params["iterations"] if name == "baseline" else best.iterations,
                    "used_for_selection": "Selection used all inner folds, not this plot",
                })
    return best


def fixed_oof(X, y, groups, params, config, seed, folds):
    splits = cv_splits(y, groups, folds, seed)
    probabilities = np.zeros(len(y))
    for tr, va in splits:
        pre, model = fit_base(X.iloc[tr], y.iloc[tr], params, config, seed)
        probabilities[va] = model.predict_proba(pre.transform(X.iloc[va]))[:, 1]
    return probabilities, split_manifest(X, splits)


def select_calibration(X, y, groups, selection, config, seed, directory):
    splits = cv_splits(y, groups, config["inner_folds"], seed)
    params = {**selection.params, "iterations": selection.iterations}
    oof = {method: np.zeros(len(y)) for method in config["calibration_methods"]}
    scores, manifest = [], []
    for k, (tr, va) in enumerate(splits):
        sub_oof, sub_splits = fixed_oof(X.iloc[tr], y.iloc[tr], subset_groups(groups, tr),
            params, config, seed + 1000 + k, config["calibration_folds"])
        pre, model = fit_base(X.iloc[tr], y.iloc[tr], params, config, seed)
        raw = model.predict_proba(pre.transform(X.iloc[va]))[:, 1]
        manifest.append({"inner_fold": k + 1, "calibrator_rows": X.index[tr].tolist(),
                         "validation_rows": X.index[va].tolist(), "subfolds": sub_splits})
        for method in oof:
            cal = ProbabilityCalibrator(method, config["probability_clip"]).fit(sub_oof, y.iloc[tr])
            oof[method][va] = cal.predict(raw)
            scores.append({"method": method, "inner_fold": k + 1,
                           "log_loss": log_loss(y.iloc[va], oof[method][va])})
    score_frame = pd.DataFrame(scores)
    means = score_frame.groupby("method").log_loss.mean().to_dict()
    selected = min(config["calibration_methods"], key=lambda method: means[method])
    if not np.allclose(oof["raw"], np.clip(selection.raw_oof, config["probability_clip"],
                                          1 - config["probability_clip"]), atol=1e-10, rtol=1e-10):
        raise AssertionError("Selected-count OOF predictions differ from independent fixed-count refits")
    calibrators = {method: ProbabilityCalibrator(method, config["probability_clip"]).fit(
        oof["raw"], y) for method in oof}
    thresholds = operating_thresholds(y, oof[selected], config["sensitivity_targets"],
                                      config["specificity_targets"])
    if config["threshold_policy"] not in thresholds:
        raise ValueError("threshold_policy must be a configured, training-OOF-derived operating point")
    score_frame.to_csv(Path(directory) / "inner_calibration.csv", index=False)
    save_json(Path(directory) / "calibration_splits.json", manifest)
    save_json(Path(directory) / "calibration_selection.json", {
        "method": selected, "inner_mean_log_loss": means, "thresholds": thresholds,
        "threshold_policy": config["threshold_policy"],
        "calibrator_fit_rows": X.index.tolist(),
    })
    pd.DataFrame({"row_index": X.index, "y": y.values, "base_oof": selection.raw_oof,
                  **{f"cross_calibrated_{k}": v for k, v in oof.items()}}).to_csv(
                      Path(directory) / "inner_predictions.csv", index=False)
    return selected, calibrators, thresholds


def diagnostic_permutations(model, pre, X, y, seed, repeats):
    rng = np.random.default_rng(seed)
    reference = log_loss(y, model.predict_proba(pre.transform(X))[:, 1])
    rows = []
    for name in X.columns:
        for repeat in range(repeats):
            permuted = X.copy()
            permuted[name] = rng.permutation(permuted[name].values)
            loss = log_loss(y, model.predict_proba(pre.transform(permuted))[:, 1])
            rows.append({"feature": name, "permutation": repeat,
                         "log_loss_increase": float(loss - reference)})
    return rows


def audit_and_groups(df, X, y, group_column=None):
    if set(df.Cath.dropna().unique()) != {"CAD", "Normal"} or df.Cath.isna().any():
        raise ValueError("CAD target must contain exactly CAD/Normal; refusing implicit relabeling")
    if list(X.columns) != ALL_INPUT_FEATURES or set(X.columns) & set(LEAKAGE_COLUMNS):
        raise ValueError("Input schema does not match the existing 54-feature specification")
    if group_column is None:
        matches = [c for c in df if c.lower() in ("patient_id", "patientid", "subject_id", "subjectid")]
        if len(matches) == 1:
            group_column = matches[0]
        elif len(matches) > 1:
            raise ValueError("Multiple possible patient identifiers; specify --group-column")
    if group_column and (group_column in ALL_INPUT_FEATURES or df[group_column].isna().any()):
        raise ValueError("Patient identifier must be a complete, non-feature column")
    parent = np.arange(len(X))

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    keys = [pd.util.hash_pandas_object(X, index=False).values]
    if group_column:
        keys.append(df[group_column].values)
    for values in keys:
        first = {}
        for i, value in enumerate(values):
            if value in first:
                parent[root(i)] = root(first[value])
            else:
                first[value] = i
    groups = np.array([root(i) for i in range(len(X))])
    grouped = bool(group_column) or len(np.unique(groups)) < len(X)
    vessel_any = (df[["LAD", "LCX", "RCA"]] == "Stenotic").any(axis=1)
    disagreements = df.index[y.astype(bool) != vessel_any].tolist()
    deterministic_binary = []
    for c in X:
        if X[c].nunique() == 2:
            codes = pd.factorize(X[c])[0]
            if np.array_equal(codes, y) or np.array_equal(1 - codes, y):
                deterministic_binary.append(c)
    return (groups if grouped else None), {
        "rows": len(df), "columns": len(df.columns), "features": list(X.columns),
        "target": "Cath == CAD (unchanged)", "positive_class": 1,
        "target_counts": df.Cath.value_counts().to_dict(), "prevalence": float(y.mean()),
        "missing_cells": int(df.isna().sum().sum()),
        "duplicate_full_rows": int(df.duplicated().sum()),
        "duplicate_input_rows": int(X.duplicated().sum()),
        "group_column": group_column, "grouped_splits": grouped,
        "patient_independence_verified": bool(group_column),
        "n_groups": int(len(np.unique(groups))),
        "target_vessel_disagreement_rows": disagreements,
        "target_vessel_disagreement_values": df.loc[disagreements, LEAKAGE_COLUMNS].to_dict("index"),
        "exact_binary_target_proxies": deterministic_binary,
        "excluded_diagnosis_columns": LEAKAGE_COLUMNS,
        "preprocessing": "Median/mode imputation, robust scaling and ordinal vocabulary fitted inside every training partition; no resampling or feature selection",
        "feature_availability": "Specification includes ECG/echo/lab inputs. No timestamps or acquisition protocol verify availability before angiography; all original features retained.",
        "redundancy_review": ["BMI/Weight/Length/Obesity", "Lymph/Neut", "chest-pain categories"],
        "rare_feature_review": {c: X[c].value_counts().to_dict() for c in X
                                 if X[c].nunique() <= 5 and X[c].value_counts().min() <= 5},
    }


def preserve_sources(directory, dataset):
    source = directory / "source"
    source.mkdir()
    for p in HERE.glob("*.py"):
        shutil.copy2(p, source / p.name)
    shutil.copy2(HERE / "requirements.txt", source / "requirements.txt")
    import importlib.metadata
    environment = {name: importlib.metadata.version(name) for name in
                   ["catboost", "scikit-learn", "numpy", "pandas", "scipy", "joblib", "matplotlib"]}
    save_json(directory / "provenance.json", {
        "dataset": str(dataset), "dataset_sha256": hashlib.sha256(dataset.read_bytes()).hexdigest(),
        "git_head": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
        "versions": environment,
        "source_sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in source.iterdir()},
    })
    snapshot = directory / "baseline_snapshot"
    if not snapshot.exists():
        snapshot.mkdir()
        shutil.copytree(HERE / "artifacts/cad", snapshot / "cad",
                        ignore=shutil.ignore_patterns("learning_curves", "*.png"))
        shutil.copy2(HERE / "artifacts/metrics.json", snapshot / "metrics.json")


def run_nested(config, directory, dataset, group_column=None):
    if config["target"] != "cad" or config["selection_metric"] != "unweighted_log_loss":
        raise ValueError("This audited protocol supports CAD and unweighted-log-loss selection")
    if set(config["calibration_methods"]) != {"raw", "sigmoid", "isotonic"}:
        raise ValueError("The comparison requires raw, sigmoid and isotonic calibration arms")
    if not config["seeds"] or len(set(config["seeds"])) != len(config["seeds"]):
        raise ValueError("Provide unique repeat seeds")
    if not config["iteration_candidates"] or any(n < 1 or n > config["max_iterations"]
                                                 for n in config["iteration_candidates"]):
        raise ValueError("Fixed iteration candidates must be positive and <= max_iterations")
    if config["bootstrap_samples"] < 1 or config["permutation_repeats"] < 1:
        raise ValueError("Bootstrap/permutation repetitions must be positive")
    start = time.monotonic()
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    if (directory / "config.json").exists():
        raise ValueError("Run directory already contains an experiment; choose a new directory")
    save_json(directory / "config.json", config)
    preserve_sources(directory, Path(dataset))
    df = pd.read_csv(dataset)
    X, y = split_features_target(df, "Cath", "CAD")
    groups, audit = audit_and_groups(df, X, y, group_column)
    save_json(directory / "data_audit.json", audit)
    if groups is None:
        development, holdout = train_test_split(np.arange(len(y)), test_size=config["test_size"],
            stratify=y, random_state=config["split_seed"])
    else:
        if config["test_size"] != .2:
            raise ValueError("Grouped holdout currently requires test_size=0.2 (one of five folds)")
        development, holdout = cv_splits(y, groups, 5, config["split_seed"])[0]
    save_json(directory / "partitions.json", {
        "development_rows": X.index[development].tolist(), "historical_holdout_rows": X.index[holdout].tolist(),
        "note": "Historical holdout has previously been inspected; not a new pristine external validation cohort.",
        "grouped": groups is not None,
    })
    Xdev, ydev = X.iloc[development], y.iloc[development]
    gdev = subset_groups(groups, development)
    pd.DataFrame([{"feature": c, "dtype": str(X[c].dtype), "unique": X[c].nunique(),
                   "missing": int(X[c].isna().sum()), "included": True} for c in X]).to_csv(
                       directory / "feature_audit.csv", index=False)
    corr = Xdev.select_dtypes("number").corr()
    pd.DataFrame([{"feature_a": a, "feature_b": b, "pearson": corr.loc[a, b]}
        for i, a in enumerate(corr) for b in corr.columns[i+1:] if abs(corr.loc[a, b]) >= .8]).to_csv(
            directory / "redundant_numeric_features.csv", index=False)
    predictions, fold_metrics, thresholds_all, permutations, outer_manifest = [], [], [], [], []
    for seed in config["seeds"]:
        splits = cv_splits(ydev, gdev, config["outer_folds"], seed)
        outer_manifest.append({"seed": seed, "folds": split_manifest(Xdev, splits)})
        save_json(directory / "outer_splits.json", outer_manifest)
        for fold, (tr, te) in enumerate(splits, 1):
            fold_dir = directory / "folds" / f"seed_{seed}_fold_{fold}"
            Xtr, ytr, Xte, yte = Xdev.iloc[tr], ydev.iloc[tr], Xdev.iloc[te], ydev.iloc[te]
            gtr = subset_groups(gdev, tr)
            selection = select_inner(Xtr, ytr, gtr, config, seed, fold_dir,
                                     curves=seed == config["seeds"][0] and fold == 1)
            method, calibrators, thresholds = select_calibration(
                Xtr, ytr, gtr, selection, config, seed, fold_dir)
            pre, base = fit_base(Xtr, ytr, {**selection.params, "iterations": selection.iterations}, config, seed)
            baseline_pre, baseline = fit_base(Xtr, ytr, config["baseline"], config, config["baseline"]["random_seed"])
            threshold = thresholds[config["threshold_policy"]]
            selected = CalibratedBinaryModel(base, calibrators[method], threshold)
            models = {"baseline": (baseline_pre, baseline),
                      **{m: (pre, CalibratedBinaryModel(base, c)) for m, c in calibrators.items()},
                      "selected": (pre, selected)}
            for variant in [*models, "prevalence"]:
                limit = threshold if variant == "selected" else .5
                if variant == "prevalence":
                    p, ptr = np.full(len(yte), ytr.mean()), np.full(len(ytr), ytr.mean())
                else:
                    prep, model = models[variant]
                    p = model.predict_proba(prep.transform(Xte))[:, 1]
                    ptr = model.predict_proba(prep.transform(Xtr))[:, 1]
                metrics = binary_metrics(yte, p, limit)
                fold_metrics.append({"seed": seed, "fold": fold, "variant": variant,
                    "candidate": "legacy_fixed" if variant == "baseline" else selection.name,
                    "iterations": config["baseline"]["iterations"] if variant == "baseline" else
                                  (0 if variant == "prevalence" else selection.iterations),
                    "calibration_method": method if variant == "selected" else variant,
                    "threshold": limit, "training_log_loss": float(log_loss(ytr, ptr)),
                    "inner_validation_log_loss": selection.inner_log_loss if variant == "raw" else None,
                    **metrics})
                for i, row in enumerate(Xte.index):
                    predictions.append({"seed": seed, "fold": fold, "row_index": int(row),
                        "group": int(row) if groups is None else int(groups[row]),
                        "variant": variant, "y": int(yte.iloc[i]), "probability": float(p[i]),
                        "threshold": limit, "prediction": int(p[i] >= limit)})
            p = selected.predict_proba(pre.transform(Xte))[:, 1]
            for name, t in {**{f"fixed_{v:g}": v for v in config["fixed_thresholds"]}, **thresholds}.items():
                thresholds_all.append({"seed": seed, "fold": fold, "policy": name, "threshold": t,
                                       **binary_metrics(yte, p, t, calibration=False)})
            for entry in diagnostic_permutations(selected, pre, Xte, yte, seed + fold,
                                                 config["permutation_repeats"]):
                permutations.append({"seed": seed, "fold": fold, **entry})
            for filename, records in [("outer_predictions.csv", predictions), ("outer_fold_metrics.csv", fold_metrics),
                                      ("outer_threshold_metrics.csv", thresholds_all), ("permutation_importance.csv", permutations)]:
                pd.DataFrame(records).to_csv(directory / filename, index=False)
            current = fold_metrics[-2]
            print(f"seed={seed} fold={fold} {selection.name}/{selection.iterations} calibration={method} "
                  f"outer loss={current['log_loss']:.4f} AUC={current['roc_auc']:.4f}", flush=True)
    final_dir = directory / "final_selection"
    final = select_inner(Xdev, ydev, gdev, config, config["split_seed"], final_dir, curves=True)
    method, calibrators, thresholds = select_calibration(
        Xdev, ydev, gdev, final, config, config["split_seed"], final_dir)
    pre, base = fit_base(Xdev, ydev, {**final.params, "iterations": final.iterations}, config, config["split_seed"])
    threshold = thresholds[config["threshold_policy"]]
    model = CalibratedBinaryModel(base, calibrators[method], threshold)
    artifacts = directory / "model" / "cad"
    artifacts.mkdir(parents=True)
    joblib.dump(pre, artifacts / "preprocessor.joblib")
    joblib.dump(model, artifacts / "model.joblib")
    schema = FeatureSchema().fit(Xdev)
    pipeline = Pipeline([("schema", schema), ("preprocessor", pre), ("classifier", model)])
    joblib.dump(pipeline, artifacts / "pipeline.joblib")
    np.savez_compressed(artifacts / "shap_background.npz", X=pre.transform(Xdev.iloc[:100]))
    save_json(artifacts / "feature_schema.json", {
        "input_features": list(Xdev.columns), "output_features": pre.get_feature_names_out().tolist(),
        "categorical_features": NATIVE_CAT_FEATURES, "categorical_positions": native_cat_indices(),
        "input_dtypes": Xdev.dtypes.astype(str).to_dict(),
        "category_vocabulary": [v.tolist() for v in pre.named_transformers_["cat"].named_steps["encoder"].categories_],
        "target_column": "Cath", "positive_label": "CAD", "classes": [0, 1],
        "cleaning": "Existing clean_dataframe; Fmale->Female, Region RWMA->str",
    })
    metadata = {"target": "cad", "csv_column": "Cath", "positive_label": "CAD",
        "n_train": len(ydev), "n_test": len(holdout), "pos_rate_train": float(ydev.mean()),
        "threshold": threshold, "threshold_policy": config["threshold_policy"],
        "alternative_thresholds": thresholds, "calibration": method, "protocol": "nested_cv",
        "best": {"model": "cat", "prep": "native", "candidate": final.name,
                 "params": {**final.params, "iterations": final.iterations},
                 "inner_validation_log_loss": final.inner_log_loss},
        "seeds": config["seeds"], "git_hash": json.loads((directory / "provenance.json").read_text())["git_head"],
        "status": "Experimental candidate; serving artifacts have not been replaced"}
    save_json(artifacts / "metadata.json", metadata)
    legacy_pre, legacy = fit_base(Xdev, ydev, config["baseline"], config, config["baseline"]["random_seed"])
    holdout_rows, holdout_metrics = [], {}
    for variant in ["baseline", *calibrators, "selected", "prevalence"]:
        limit = threshold if variant == "selected" else .5
        if variant == "baseline":
            prob = legacy.predict_proba(legacy_pre.transform(X.iloc[holdout]))[:, 1]
        elif variant == "prevalence":
            prob = np.full(len(holdout), ydev.mean())
        else:
            candidate_model = model if variant == "selected" else CalibratedBinaryModel(base, calibrators[variant])
            prob = candidate_model.predict_proba(pre.transform(X.iloc[holdout]))[:, 1]
        holdout_metrics[variant] = binary_metrics(y.iloc[holdout], prob, limit)
        for row, label, p in zip(X.index[holdout], y.iloc[holdout], prob):
            holdout_rows.append({"row_index": int(row), "variant": variant, "y": int(label),
                                 "probability": p, "threshold": limit})
    save_json(directory / "historical_holdout_metrics.json", holdout_metrics)
    pd.DataFrame(holdout_rows).to_csv(directory / "historical_holdout_predictions.csv", index=False)
    from experiment_report import generate_report
    generate_report(directory)
    save_json(directory / "completion.json", {"completed_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                              "elapsed_seconds": time.monotonic() - start})
    print(f"Complete: {directory / 'report.md'}", flush=True)
    return directory


def nested_main(argv=None):
    parser = argparse.ArgumentParser(description="Nested CAD experiment")
    parser.add_argument("--config", type=Path, default=NESTED_DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--dataset", type=Path, default=HERE.parent / "dataset/dataset.csv")
    parser.add_argument("--group-column")
    args = parser.parse_args(argv)
    config = json.loads(args.config.read_text())
    output = args.output or HERE / "experiments" / datetime.datetime.now(datetime.timezone.utc).strftime("cad_nested_%Y%m%dT%H%M%SZ")
    run_nested(config, output, args.dataset, args.group_column)
