"""Train CAD + LAD/LCX/RCA classifiers (leakage-safe).

For each target: stratified 80/20 split (seed 42) + REPEATED stratified 5-fold
CV on train (default 10 repeats, seeds 42..51); preprocessors fitted on train
folds only via Pipeline (or manual prep for the stacking track). Best model
by mean CV ROC-AUC (tie-break mean CV F1) is refit on full train and saved
with its preprocessor under training/artifacts/<target>/.

Two prep tracks: "onehot" (shared one-hot preprocessor) and "native"
(integer-coded categoricals for LightGBM / CatBoost). The saved artifact
layout is unchanged (preprocessor.joblib + model.joblib), so inference.py
and the backend work without modification.
"""

import argparse
import csv
import datetime
import json
import subprocess
from itertools import product
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import (average_precision_score, brier_score_loss,
                              f1_score, roc_auc_score)
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

from preprocessing import (TARGETS, build_native_preprocessor,
                            build_preprocessor, build_voting_preprocessor,
                            native_cat_indices, split_features_target)
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


def build_prep(prep):
    if prep == "native":
        return build_native_preprocessor()
    if prep == "voting":
        return build_voting_preprocessor()
    return build_preprocessor()


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


def fit_voting(scale_pos, Xt, y, cv=5, seed=RANDOM_STATE):
    estimators = build_voting_estimators(scale_pos, random_state=seed)
    best, _ = optimize_voting_weights_and_threshold(
        estimators, Xt, y, cv=cv, seed=seed,
    )
    return VotingClassifier(
        estimators,
        weights=best["weights"],
        threshold=best["threshold"],
    ).fit(Xt, y)


def fit_with_track(kind, params, scale_pos, prep, X_tr, y_tr):
    pre = build_prep(prep).fit(X_tr)
    Xt = pre.transform(X_tr)
    if kind == "vote":
        return pre, fit_voting(scale_pos, Xt, y_tr.values)
    if kind == "stack":
        clf = StackedModel(make_stack_bases(scale_pos)).fit(Xt, y_tr.values)
        return pre, clf
    clf = build_estimator(kind, params, scale_pos)
    fit_kwargs: dict = {}
    if prep == "native" and kind in ("lgbm", "cat"):
        key = "categorical_feature" if kind == "lgbm" else "cat_features"
        fit_kwargs[key] = native_cat_indices()
    clf.fit(Xt, y_tr.values, **fit_kwargs)
    return pre, clf


def repeated_cv_scores(cfg, X_train, y_train, scale_pos, seeds):
    aucs, f1s, praucs, briers = [], [], [], []
    for seed in seeds:
        skf = StratifiedKFold(n_splits=CV_FOLDS, shuffle=True, random_state=seed)
        for tr_idx, va_idx in skf.split(X_train, y_train):
            X_tr, X_va = X_train.iloc[tr_idx], X_train.iloc[va_idx]
            y_tr, y_va = y_train.iloc[tr_idx], y_train.iloc[va_idx]
            pre = build_prep(cfg["prep"]).fit(X_tr)
            Xt_tr, Xt_va = pre.transform(X_tr), pre.transform(X_va)
            if cfg["model"] == "vote":
                clf = fit_voting(scale_pos, Xt_tr, y_tr.values, cv=3, seed=seed)
            elif cfg["model"] == "stack":
                clf = StackedModel(make_stack_bases(scale_pos),
                                   random_state=seed).fit(Xt_tr, y_tr.values)
            else:
                clf = build_estimator(cfg["model"], cfg["params"], scale_pos)
                fit_kwargs = {}
                if cfg["prep"] == "native" and cfg["model"] in ("lgbm", "cat"):
                    key = ("categorical_feature" if cfg["model"] == "lgbm"
                           else "cat_features")
                    fit_kwargs[key] = native_cat_indices()
                clf.fit(Xt_tr, y_tr.values, **fit_kwargs)
            proba = clf.predict_proba(Xt_va)[:, 1]
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


def stability_jaccard(kind, params, scale_pos, prep, X_train, y_train, seeds, k=10):
    """Mean pairwise Jaccard of top-k gain importances across repeat seeds."""
    tops = []
    for r, seed in enumerate(seeds):
        pre = build_prep(prep).fit(X_train)
        Xt = pre.transform(X_train)
        if kind == "stack":
            clf = StackedModel(make_stack_bases(scale_pos),
                               random_state=seed).fit(Xt, y_train.values)
            imp = np.asarray(clf.feature_importances_, dtype=float)
        elif kind == "vote":
            clf = fit_voting(scale_pos, Xt, y_train.values, seed=seed)
            imp = np.asarray(clf.feature_importances_, dtype=float)
        else:
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
                fit_kwargs[key] = native_cat_indices()
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
    with open(EXPERIMENTS_CSV, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(row.keys()))
        if not exists:
            w.writeheader()
        w.writerow(row)


def train_target(key, df, repeats):
    cfg = TARGETS[key]
    X, y = split_features_target(df, cfg["column"], cfg["positive"])
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, stratify=y, random_state=RANDOM_STATE
    )
    seeds = [RANDOM_STATE + r for r in range(repeats)]
    configs, scale_pos = make_configs(y_train)
    try:
        git_hash = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=HERE.parent, text=True).strip()
    except Exception:
        git_hash = "unknown"
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

    results = []
    for c in configs:
        scores = repeated_cv_scores(c, X_train, y_train, scale_pos, seeds)
        entry = {"model": c["model"], "prep": c["prep"], "params": c["params"],
                 **scores}
        results.append(entry)
        print(f"[{key}] {c['model']}/{c['prep']} {c['params']} "
              f"-> AUC={scores['cv_roc_auc']:.4f}±{scores['cv_roc_auc_std']:.4f} "
              f"F1={scores['cv_f1']:.4f} PRAUC={scores['cv_pr_auc']:.4f} "
              f"Brier={scores['cv_brier']:.4f}", flush=True)
        append_experiment({
            "timestamp": stamp, "git_hash": git_hash, "target": key,
            "model": c["model"], "prep": c["prep"],
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
    stab = stability_jaccard(best["model"], best["params"], scale_pos,
                             best["prep"], X_train, y_train, seeds)
    print(f"[{key}] winner stability top-10 Jaccard: {stab:.3f}", flush=True)

    # Refit winner on full train (preprocessor fit on train only).
    pre, clf = fit_with_track(best["model"], best["params"], scale_pos,
                              best["prep"], X_train, y_train)

    out_dir = ARTIFACTS_DIR / key
    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(pre, out_dir / "preprocessor.joblib")
    joblib.dump(clf, out_dir / "model.joblib")
    # Explainability background: up to 100 transformed train rows.
    Xt = pre.transform(X_train)
    bg = np.asarray(Xt)[np.random.RandomState(RANDOM_STATE).choice(
        len(Xt), size=min(100, len(Xt)), replace=False)]
    np.savez_compressed(out_dir / "shap_background.npz", background=bg)
    meta = {
        "target": key, "csv_column": cfg["column"], "positive_label": cfg["positive"],
        "n_train": len(X_train), "n_test": len(X_test),
        "pos_rate_train": float(y_train.mean()), "pos_rate_test": float(y_test.mean()),
        "best": best, "all_cv_results": results,
        "stability_top10_jaccard": stab,
        "random_state": RANDOM_STATE, "test_size": TEST_SIZE,
        "repeats": repeats, "seeds": seeds,
        "git_hash": git_hash,
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


def main(targets, repeats):
    df = pd.read_csv(DATASET)
    print(f"dataset: {df.shape}")
    for key in targets:
        train_target(key, df, repeats)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--targets", nargs="*", default=["cad", "lad", "lcx", "rca"])
    ap.add_argument("--repeats", type=int, default=DEFAULT_REPEATS)
    args = ap.parse_args()
    main(args.targets, args.repeats)
