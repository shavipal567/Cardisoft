"""Reproducible helpers for engineered-feature-analysis.ipynb.

Research analysis only: production preprocessing and saved models are not changed.
Features are fixed, row-wise transformations; learned preprocessing is fold-local.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from hashlib import sha256
from importlib.metadata import version
from pathlib import Path
import json
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.stats import false_discovery_control, mannwhitneyu
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (average_precision_score, brier_score_loss,
                             confusion_matrix, log_loss, roc_auc_score)
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, RobustScaler

DATASET_DIR = Path(__file__).resolve().parent
ROOT = DATASET_DIR.parent
sys.path.insert(0, str(ROOT / "training"))
from preprocessing import (ALL_INPUT_FEATURES, LEAKAGE_COLUMNS,
                           NATIVE_CAT_FEATURES, NUMERIC_FEATURES, TARGETS,
                           clean_dataframe)
from native_models import CatBoostNative

OUTPUT = DATASET_DIR / "engineered_feature_analysis"
SEEDS = (42, 43, 44)
FOLDS = 5
RATIOS = ["LDL_HDL_ratio", "TG_HDL_ratio", "Neut_Lymph_ratio"]
COUNTS = ["risk_factor_count", "ecg_finding_count"]
LOG_SOURCES = ["TG", "FBS", "ESR"]
LOGS = [f"log1p_{name}" for name in LOG_SOURCES]
ENGINEERED = RATIOS + COUNTS + LOGS
VARIANTS = ("baseline", "ratios", "counts", "logs", "ratios_counts",
            "ratios_counts_logs")
METRICS = ("roc_auc", "average_precision", "log_loss", "brier",
           "sensitivity", "specificity")


def feature_definitions():
    return pd.DataFrame([
        (RATIOS[0], "LDL / HDL", "LDL; HDL", "ratio", "Relative lipid levels"),
        (RATIOS[1], "TG / HDL", "TG; HDL", "ratio", "Relative lipid levels"),
        (RATIOS[2], "Neut / Lymph", "Neut; Lymph", "ratio", "White-cell differential balance"),
        (COUNTS[0], "DM + HTN + Current Smoker + FH + 1[DLP == Y]",
         "DM; HTN; Current Smoker; FH; DLP", "count 0–5", "Unweighted count; not a validated clinical score"),
        (COUNTS[1], "Q Wave + St Elevation + St Depression + Tinversion",
         "Q Wave; St Elevation; St Depression; Tinversion", "count 0–4",
         "Four recorded ECG findings; not interchangeable diagnoses"),
        *[(f"log1p_{name}", f"ln(1 + {name})", name, "log transform",
           "Compresses the right tail; adds no new measurement") for name in LOG_SOURCES],
    ], columns=["feature", "formula", "source_columns", "type", "interpretation"])


def engineer_features(X):
    """Derive eight features without labels, fitted statistics or row removal.

    Missing/non-finite operands propagate. Ratios require a positive denominator;
    logs require a nonnegative lab value. A count requires every constituent to be
    observed and valid, so absent information is never silently counted as zero.
    """
    out = pd.DataFrame(index=X.index)

    def numeric(name):
        return pd.to_numeric(X[name], errors="coerce").replace([np.inf, -np.inf], np.nan)

    for name, numerator, denominator in zip(RATIOS, ["LDL", "TG", "Neut"],
                                            ["HDL", "HDL", "Lymph"]):
        n, d = numeric(numerator), numeric(denominator)
        out[name] = n.where(n.ge(0)) / d.where(d.gt(0))
    risk = pd.DataFrame({name: numeric(name).where(numeric(name).isin([0, 1]))
                         for name in ["DM", "HTN", "Current Smoker", "FH"]})
    risk["DLP"] = X["DLP"].map({"Y": 1.0, "N": 0.0})
    out[COUNTS[0]] = risk.sum(axis=1, min_count=5)
    ecg = pd.DataFrame({name: numeric(name).where(numeric(name).isin([0, 1]))
                        for name in ["Q Wave", "St Elevation", "St Depression", "Tinversion"]})
    out[COUNTS[1]] = ecg.sum(axis=1, min_count=4)
    for source, name in zip(LOG_SOURCES, LOGS):
        values = numeric(source)
        out[name] = np.log1p(values.where(values.ge(0)))
    return out.replace([np.inf, -np.inf], np.nan)


class FeatureSet(BaseEstimator, TransformerMixin):
    """Keep the raw allow-list; add prespecified features before learned transforms."""

    def __init__(self, variant="baseline"):
        self.variant = variant

    def fit(self, X, y=None):
        if self.variant not in VARIANTS:
            raise ValueError(f"Unknown feature set: {self.variant}")
        return self

    def transform(self, X):
        base = clean_dataframe(X.loc[:, ALL_INPUT_FEATURES])
        if self.variant == "baseline":
            return base
        derived = engineer_features(base)
        if "logs" in self.variant:
            base = base.drop(columns=LOG_SOURCES)
        for name in additions(self.variant):
            base[name] = derived[name]
        return base


def additions(variant):
    return ((RATIOS if "ratios" in variant else [])
            + (COUNTS if "counts" in variant else [])
            + (LOGS if "logs" in variant else []))


def load_data():
    df = pd.read_csv(DATASET_DIR / "dataset.csv")
    assert len(df) == 303 and set(ALL_INPUT_FEATURES).isdisjoint(LEAKAGE_COLUMNS)
    assert not df.duplicated(subset=ALL_INPUT_FEATURES).any(), "Group duplicate inputs before CV."
    for spec in TARGETS.values():
        assert set(df[spec["column"]].unique()) == {"Normal", spec["positive"]}
    OUTPUT.mkdir(exist_ok=True)
    return df


def development_partitions(df):
    """Match the original per-target 80/20 stratified split, seed 42."""
    partitions, manifest = {}, []
    for target, spec in TARGETS.items():
        y = df[spec["column"]].eq(spec["positive"]).astype(int)
        dev, held = train_test_split(df.index.to_numpy(), test_size=0.2,
                                    random_state=42, stratify=y)
        assert len(dev) == 242 and len(held) == 61 and not set(dev) & set(held)
        partitions[target] = (dev, held)
        for role, indices in [("development", dev), ("excluded_holdout", held)]:
            manifest.extend({"target": target, "row_index": int(i), "role": role}
                            for i in indices)
    pd.DataFrame(manifest).to_csv(OUTPUT / "partitions.csv", index=False)
    return partitions


def describe_features(df, partitions):
    """Descriptive views use only the 242-row CAD development partition."""
    raw = clean_dataframe(df.loc[partitions["cad"][0], ALL_INPUT_FEATURES])
    derived = engineer_features(raw)
    summary = derived.describe(percentiles=[.25, .5, .75]).T
    summary["missing"] = derived.isna().sum()
    summary["unique"] = derived.nunique()
    summary["skew"] = derived.skew()
    summary.index.name = "feature"
    summary.to_csv(OUTPUT / "feature_summary.csv")
    skew = pd.DataFrame({"raw_skew": raw[LOG_SOURCES].skew().to_numpy(),
                         "log_skew": derived[LOGS].skew().to_numpy()}, index=LOG_SOURCES)
    skew.index.name = "source"
    skew.to_csv(OUTPUT / "log_transform_skew.csv")
    corr = pd.concat([raw[NUMERIC_FEATURES], derived], axis=1).corr(method="spearman")
    corr.to_csv(OUTPUT / "spearman_correlations.csv")
    relationships = []
    for name in ENGINEERED:
        ranked = corr.loc[name, NUMERIC_FEATURES].abs().sort_values(ascending=False)
        for rank, source in enumerate(ranked.index[:3], 1):
            relationships.append({"feature": name, "rank": rank, "raw_feature": source,
                                  "spearman_rho": corr.loc[name, source]})
    relationships = pd.DataFrame(relationships)
    relationships.to_csv(OUTPUT / "strongest_raw_correlations.csv", index=False)
    return raw, derived, summary, skew, corr, relationships


def target_associations(df, partitions):
    """Descriptive two-sided Mann–Whitney tests; BH over all 4 × 8 comparisons.

    Signed rank-biserial effect is 2*AUC-1: positive means larger values in the
    positive class. AUC uses the feature itself (no fitted model); values below
    .5 indicate inverse association, not an absence of signal.
    """
    rows = []
    for target, spec in TARGETS.items():
        part = df.loc[partitions[target][0]]
        derived = engineer_features(part)
        y = part[spec["column"]].eq(spec["positive"]).astype(int)
        for name in ENGINEERED:
            valid = derived[name].notna()
            values, labels = derived.loc[valid, name], y.loc[valid]
            pos, neg = values[labels.eq(1)], values[labels.eq(0)]
            test = mannwhitneyu(pos, neg, alternative="two-sided", method="asymptotic")
            auc = roc_auc_score(labels, values)
            rows.append({"target": target, "feature": name, "n_positive": len(pos),
                         "n_negative": len(neg), "positive_median": pos.median(),
                         "negative_median": neg.median(), "positive_q25": pos.quantile(.25),
                         "positive_q75": pos.quantile(.75), "negative_q25": neg.quantile(.25),
                         "negative_q75": neg.quantile(.75), "feature_auc": auc,
                         "rank_biserial": 2 * auc - 1, "p_value": test.pvalue})
    table = pd.DataFrame(rows)
    table["q_value_bh_32_tests"] = false_discovery_control(table.p_value.to_numpy(), method="bh")
    table.to_csv(OUTPUT / "target_associations.csv", index=False)
    return table


def make_model(target, variant, seed):
    """Freeze the existing target model's settings; only the feature set changes.

    Native categorical positions are recomputed after every feature-set change.
    The CAD configuration matches the deployed 400-iteration CatBoost baseline,
    not the separate nested regularization experiment.
    """
    nums = [n for n in NUMERIC_FEATURES if not ("logs" in variant and n in LOG_SOURCES)]
    nums += additions(variant)
    num_pipe = Pipeline([("imputer", SimpleImputer(strategy="median")),
                         ("scaler", RobustScaler())])
    if target == "cad":
        encoder = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1,
                                 encoded_missing_value=-1)
        estimator = CatBoostNative(
            cat_features=list(range(len(nums), len(nums) + len(NATIVE_CAT_FEATURES))),
            iterations=400, depth=4, learning_rate=.05, l2_leaf_reg=3,
            auto_class_weights="Balanced", random_seed=seed, verbose=False,
            thread_count=1, allow_writing_files=False)
    else:
        encoder = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
        estimator = RandomForestClassifier(n_estimators=400,
            max_depth=8 if target == "rca" else None, min_samples_leaf=2,
            class_weight="balanced", random_state=seed, n_jobs=1)
    cat_pipe = Pipeline([("imputer", SimpleImputer(strategy="most_frequent")),
                         ("encoder", encoder)])
    pre = ColumnTransformer([("num", num_pipe, nums), ("cat", cat_pipe, NATIVE_CAT_FEATURES)])
    return Pipeline([("features", FeatureSet(variant)), ("preprocessor", pre),
                     ("model", estimator)])


def score_predictions(y, p):
    tn, fp, fn, tp = confusion_matrix(y, p >= .5, labels=[0, 1]).ravel()
    return {"roc_auc": roc_auc_score(y, p), "average_precision": average_precision_score(y, p),
            "log_loss": log_loss(y, p, labels=[0, 1]), "brier": brier_score_loss(y, p),
            "sensitivity": tp / (tp + fn), "specificity": tn / (tn + fp)}


def benchmark(df, partitions, *, workers=2):
    """Prespecified ablations: 3 seeds × 5 folds × 6 variants × 4 targets.

    No tuning, feature selection, early stopping, calibration or threshold search
    occurs here. These development-CV comparisons cannot independently validate a
    winner chosen after inspecting them. No historical holdout is scored.
    """
    fold_records, prediction_records, split_records = [], [], []

    def one_fold(target, seed, fold, train_ids, validation_ids):
        spec = TARGETS[target]
        X = df.loc[:, ALL_INPUT_FEATURES]
        y = df[spec["column"]].eq(spec["positive"]).astype(int)
        scores, predictions = [], []
        for variant in VARIANTS:
            model = make_model(target, variant, seed)
            model.fit(X.loc[train_ids], y.loc[train_ids])
            p = model.predict_proba(X.loc[validation_ids])[:, 1]
            assert np.isfinite(p).all() and ((p >= 0) & (p <= 1)).all()
            key = {"target": target, "seed": seed, "fold": fold, "variant": variant}
            scores.append({**key, **score_predictions(y.loc[validation_ids], p)})
            predictions.extend({**key, "row_index": int(i), "y": int(y.loc[i]),
                                "probability": float(prob)} for i, prob in zip(validation_ids, p))
        return scores, predictions

    jobs = []
    for target, spec in TARGETS.items():
        dev, held = partitions[target]
        y = df.loc[dev, spec["column"]].eq(spec["positive"]).astype(int)
        for seed in SEEDS:
            for fold, (tr, va) in enumerate(StratifiedKFold(FOLDS, shuffle=True,
                                                          random_state=seed).split(dev, y), 1):
                train_ids, validation_ids = dev[tr], dev[va]
                assert not (set(train_ids) | set(validation_ids)) & set(held)
                assert not set(train_ids) & set(validation_ids)
                jobs.append((target, seed, fold, train_ids, validation_ids))
                split_records.append({"target": target, "seed": seed, "fold": fold,
                                      "train_rows": train_ids.tolist(),
                                      "validation_rows": validation_ids.tolist()})
    (OUTPUT / "cv_splits.json").write_text(json.dumps(split_records, indent=2) + "\n")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(one_fold, *job): job[:3] for job in jobs}
        for completed, future in enumerate(as_completed(futures), 1):
            scores, predictions = future.result()
            fold_records.extend(scores)
            prediction_records.extend(predictions)
            if completed % 5 == 0:
                print(f"Completed {completed}/{len(jobs)} fold groups ({completed * len(VARIANTS)} fits)", flush=True)
    folds = pd.DataFrame(fold_records).sort_values(["target", "seed", "fold", "variant"])
    predictions = pd.DataFrame(prediction_records).sort_values(["target", "seed", "variant", "row_index"])
    folds.to_csv(OUTPUT / "cv_fold_metrics.csv", index=False)
    predictions.to_csv(OUTPUT / "cv_oof_predictions.csv", index=False)
    repeat_rows = []
    for (target, seed, variant), block in predictions.groupby(["target", "seed", "variant"]):
        assert len(block) == 242 and block.row_index.nunique() == 242
        repeat_rows.append({"target": target, "seed": seed, "variant": variant,
                            **score_predictions(block.y, block.probability)})
    repeats = pd.DataFrame(repeat_rows)
    repeats.to_csv(OUTPUT / "cv_repeat_metrics.csv", index=False)
    summary = repeats.groupby(["target", "variant"])[list(METRICS)].agg(["mean", "std"])
    summary.columns = ["_".join(c) for c in summary.columns]
    summary = summary.reset_index()
    summary.to_csv(OUTPUT / "cv_summary.csv", index=False)
    base = repeats[repeats.variant.eq("baseline")].drop(columns="variant")
    paired = repeats.merge(base, on=["target", "seed"], suffixes=("", "_baseline"))
    for metric in METRICS:
        paired[f"delta_{metric}"] = paired[metric] - paired[f"{metric}_baseline"]
    paired.to_csv(OUTPUT / "cv_paired_deltas.csv", index=False)
    return folds, predictions, repeats, summary, paired


def make_figures(df, partitions, raw, derived, corr, associations, summary, paired):
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
    files = []

    def save(fig, name):
        path = OUTPUT / name
        fig.savefig(path, dpi=160, bbox_inches="tight", facecolor="white")
        plt.close(fig)
        files.append(path)

    fig, axes = plt.subplots(2, 4, figsize=(16, 7))
    for ax, name in zip(axes.flat, ENGINEERED):
        vals = derived[name].dropna()
        bins = np.arange(-.5, vals.max() + 1.5) if name in COUNTS else 22
        ax.hist(vals, bins=bins, color="#337e9b", edgecolor="white")
        ax.set(title=name, ylabel="Records", xlabel="Value")
    fig.suptitle("Engineered feature distributions · CAD development records (n=242)")
    fig.tight_layout(rect=(0, 0, 1, .95))
    save(fig, "feature_distributions.png")

    fig, axes = plt.subplots(3, 2, figsize=(11, 9))
    for row, source in enumerate(LOG_SOURCES):
        for col, values in enumerate([raw[source], derived[f"log1p_{source}"]]):
            axes[row, col].hist(values, bins=24, color=["#337e9b", "#e8a64d"][col], edgecolor="white")
            axes[row, col].set(title=f"{'Raw' if col == 0 else 'log1p'} {source} · skew={values.skew():.2f}",
                               xlabel="Value", ylabel="Records")
    fig.suptitle("Tail compression does not add new patient measurements")
    fig.tight_layout(rect=(0, 0, 1, .96))
    save(fig, "raw_vs_log_labs.png")

    fig, ax = plt.subplots(figsize=(9, 7))
    matrix = corr.loc[ENGINEERED, ENGINEERED]
    im = ax.imshow(matrix, cmap="RdBu_r", vmin=-1, vmax=1)
    ax.set_xticks(range(len(ENGINEERED)), ENGINEERED, rotation=45, ha="right")
    ax.set_yticks(range(len(ENGINEERED)), ENGINEERED)
    for i in range(len(ENGINEERED)):
        for j in range(len(ENGINEERED)):
            value = matrix.iloc[i, j]
            ax.text(j, i, f"{value:.2f}", ha="center", va="center",
                    color="white" if abs(value) > .65 else "black", fontsize=8)
    ax.set_title("Engineered-feature Spearman correlation · CAD development split")
    fig.colorbar(im, ax=ax, label="Spearman rho")
    fig.tight_layout()
    save(fig, "engineered_correlations.png")

    fig, axes = plt.subplots(2, 4, figsize=(16, 7))
    y = df.loc[partitions["cad"][0], "Cath"].eq("CAD")
    for ax, name in zip(axes.flat, ENGINEERED):
        ax.boxplot([derived.loc[~y, name].dropna(), derived.loc[y, name].dropna()],
                   labels=["Normal", "CAD"], widths=.5)
        ax.set(title=name, ylabel="Value")
    fig.suptitle("CAD group distributions · development split only")
    fig.tight_layout(rect=(0, 0, 1, .95))
    save(fig, "cad_group_distributions.png")

    fig, ax = plt.subplots(figsize=(8, 6))
    matrix = associations.pivot(index="feature", columns="target", values="rank_biserial").loc[ENGINEERED, list(TARGETS)]
    im = ax.imshow(matrix, cmap="RdBu_r", vmin=-1, vmax=1)
    ax.set_xticks(range(4), [t.upper() for t in TARGETS])
    ax.set_yticks(range(8), ENGINEERED)
    for i in range(8):
        for j in range(4):
            ax.text(j, i, f"{matrix.iloc[i, j]:+.2f}", ha="center", va="center", fontsize=10)
    ax.set_title("Unadjusted association by target · target-specific development splits")
    fig.colorbar(im, ax=ax, label="Rank-biserial effect (positive = higher in positive class)")
    fig.tight_layout()
    save(fig, "target_associations.png")

    fig, axes = plt.subplots(2, 2, figsize=(15, 9), sharey=True)
    alternatives = list(VARIANTS[1:])
    for ax, target in zip(axes.flat, TARGETS):
        subset = paired[paired.target.eq(target)]
        for seed, color, offset in zip(SEEDS, ["#337e9b", "#e8a64d", "#9a5476"], [-.12, 0, .12]):
            block = subset[subset.seed.eq(seed)].set_index("variant").loc[alternatives]
            ax.scatter(block.delta_log_loss, np.arange(len(alternatives)) + offset,
                       color=color, label=f"Seed {seed}", s=42)
        ax.axvline(0, color="gray", linestyle="--", linewidth=1)
        ax.set_yticks(range(len(alternatives)), alternatives)
        ax.set(title=target.upper(), xlabel="OOF log-loss change vs baseline (negative is better)")
        ax.legend(fontsize=8)
    fig.suptitle("Paired development-CV comparisons · each dot is one complete OOF repeat")
    fig.tight_layout(rect=(0, 0, 1, .96))
    save(fig, "cv_log_loss_deltas.png")

    fig, axes = plt.subplots(1, 2, figsize=(15, 5))
    colors = ["#337e9b", "#e8a64d", "#9a5476", "#4f956b"]
    for target, color in zip(TARGETS, colors):
        block = summary[summary.target.eq(target)].set_index("variant").loc[list(VARIANTS)]
        for ax, metric in zip(axes, ["roc_auc", "log_loss"]):
            ax.plot(range(len(VARIANTS)), block[f"{metric}_mean"], marker="o", color=color,
                    label=target.upper())
            ax.set_xticks(range(len(VARIANTS)), VARIANTS, rotation=35, ha="right")
            ax.set_ylabel("Mean complete-repeat OOF " + metric.replace("_", " "))
            ax.legend()
    fig.suptitle("Feature-set comparison · fixed model settings, three repeated 5-fold splits")
    fig.tight_layout(rect=(0, 0, 1, .94))
    save(fig, "cv_feature_set_comparison.png")
    return files


def save_provenance(df):
    config = {
        "dataset_sha256": sha256((DATASET_DIR / "dataset.csv").read_bytes()).hexdigest(),
        "analysis_sha256": sha256(Path(__file__).read_bytes()).hexdigest(),
        "raw_rows": len(df), "raw_columns": len(df.columns),
        "original_predictors": len(ALL_INPUT_FEATURES), "derived_features": ENGINEERED,
        "excluded_target_columns": LEAKAGE_COLUMNS, "seeds": list(SEEDS), "folds": FOLDS,
        "holdout": "Per-target stratified 20%, seed 42; excluded from association and model analysis",
        "variants": list(VARIANTS), "log_policy": "Replace TG/FBS/ESR in log variants",
        "threshold": .5, "primary_comparison": "unweighted log_loss; also inspect AUC and Brier",
        "cv_role": "exploratory fixed-configuration comparison, not nested feature selection",
        "uncertainty": "SD across 3 correlated OOF repeats is descriptive, not a confidence interval",
        "cad_model": {"family": "CatBoostNative", "iterations": 400, "depth": 4,
                      "learning_rate": .05, "l2_leaf_reg": 3, "auto_class_weights": "Balanced"},
        "vessel_models": {"family": "RandomForestClassifier", "n_estimators": 400,
                          "min_samples_leaf": 2, "class_weight": "balanced",
                          "max_depth": {"lad": None, "lcx": None, "rca": 8}},
        "packages": {p: version(p) for p in ["numpy", "pandas", "scipy", "scikit-learn", "catboost", "matplotlib"]},
    }
    (OUTPUT / "provenance.json").write_text(json.dumps(config, indent=2) + "\n")
    feature_definitions().to_csv(OUTPUT / "feature_definitions.csv", index=False)
    # Separate research export: source CSV stays immutable; no labels in this feature table.
    export = engineer_features(df)
    export.index.name = "row_index"
    export.to_csv(OUTPUT / "engineered_features.csv")
    return config
