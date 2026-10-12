"""Reproducible CAD experiments built on Cardisoft's existing native pipeline.

The outer test partition is passed ONLY to scoring/diagnostics after selection.
No serving artifacts are overwritten. Run via ``train.py --protocol nested``.
"""

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import log_loss
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline

from calibration import CalibratedBinaryModel, FeatureSchema, ProbabilityCalibrator
from clinical_metrics import binary_metrics, operating_thresholds
from learning_curves import save_learning_curves
from native_models import CatBoostNative
from preprocessing import (ALL_INPUT_FEATURES, LEAKAGE_COLUMNS, NATIVE_CAT_FEATURES,
                           build_native_preprocessor, native_cat_indices,
                           split_features_target)

HERE = Path(__file__).resolve().parent
DEFAULT_CONFIG = HERE / "configs/cad_nested.json"


def save_json(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(obj, indent=2, allow_nan=False, default=lambda x:
                         x.item() if isinstance(x, np.generic) else str(x)) + "\n")


def subset_groups(groups, indices):
    return None if groups is None else np.asarray(groups)[indices]


def cv_splits(y, groups, n_splits, seed):
    """Fail on inadequate classes/groups instead of silently changing the protocol."""
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
    pre = build_native_preprocessor()
    transformed = pre.fit_transform(X, y)
    model_params = {"verbose": False, "allow_writing_files": False,
                    "random_seed": seed, "thread_count": config["thread_count"],
                    "loss_function": "Logloss", "counter_calc_method": "SkipTest",
                    **params}
    if validation is not None:
        # CatBoost rejects use_weights when no non-default weights exist.
        model_params["eval_metric"] = ("Logloss:use_weights=false"
                                       if params.get("auto_class_weights", "None") != "None"
                                       else "Logloss")
    model = CatBoostNative(cat_features=native_cat_indices(), **model_params)
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
    """Fit the actual requested count: CatBoost prefixes need not equal refits."""
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
    """Select complexity/count using only inner validation log loss.

    An early-stopped fit proposes its best count. Every candidate count is then
    independently refitted on exactly the same inner folds. A prefix of a longer
    CatBoost fit is NOT assumed equivalent to training for that count, even with
    an explicit learning rate. Prefixes are used only for descriptive curves.
    """
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
        # Median of inner-only stopping counts is a further fixed-count proposal.
        counts = sorted(set(config["iteration_candidates"] +
                            [int(np.median(best_counts))]))
        # Separate worker processes keep CatBoost logger/global state isolated.
        # Count/fold fits are independent; collection order is deterministic.
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
                             ("selected", {**best.params, "iterations": config["max_iterations"]})]:
            pre, model = fit_base(X.iloc[tr], y.iloc[tr], params, config, seed)
            save_learning_curves(directory / "learning_curves" / name, model=model,
                preprocessor=pre, X_train=X.iloc[tr], y_train=y.iloc[tr],
                X_valid=X.iloc[va], y_valid=y.iloc[va], context={
                    "target": "cad", "model": "cat", "seed": seed, "fold": 1,
                    "fold_label": "Inner CV fold 1 (diagnostic full path)",
                    "source": "inner_cv_diagnostic", "params": params,
                    "selected_iteration": best.iterations if name == "selected" else params["iterations"],
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
    """Inner validation of raw/Platt/isotonic with an additional calibration level.

    For each inner validation fold, calibrators are fitted to SUB-fold OOF
    predictions from its training rows. Validation labels cannot enter those
    base fits or calibrator fits. Hyperparameters are already inner-selected;
    these internal scores are selection diagnostics, not unbiased performance.
    """
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
    """Outer evaluation only. This output is never fed back to feature selection."""
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
    """Union explicit patients and exact duplicate predictors into indivisible groups."""
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


def run(config, directory, dataset, group_column=None):
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
            # Selection functions receive no outer-test rows or labels.
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
    # Freeze a final choice using development-only inner CV, never outer outcomes.
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
    # Reproducible secondary historical-holdout comparison AFTER all choices are fixed.
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
    save_json(directory / "completion.json", {"completed_utc": datetime.now(timezone.utc).isoformat(),
                                              "elapsed_seconds": time.monotonic() - start})
    print(f"Complete: {directory / 'report.md'}", flush=True)
    return directory


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--dataset", type=Path, default=HERE.parent / "dataset/dataset.csv")
    parser.add_argument("--group-column")
    args = parser.parse_args(argv)
    config = json.loads(args.config.read_text())
    output = args.output or HERE / "experiments" / datetime.now(timezone.utc).strftime("cad_nested_%Y%m%dT%H%M%SZ")
    run(config, output, args.dataset, args.group_column)


if __name__ == "__main__":
    main()
