"""Shared preprocessing for Cardisoft training + inference.

Leakage rule (PROBLEM.md S6, mandatory):
    LEAKAGE_COLUMNS = ["LAD", "LCX", "RCA", "Cath"]
must never be model inputs for CAD/LAD/LCX/RCA targets.

The preprocessor is fitted on TRAIN data only (see train.py).
"""

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, RobustScaler, StandardScaler
from sklearn.utils.validation import check_is_fitted

LEAKAGE_COLUMNS = ["LAD", "LCX", "RCA", "Cath"]

# Zero-variance / near-constant columns dropped from inputs.
DROP_COLUMNS = ["Exertional CP"]

# Target column in CSV -> artifact key + positive label mapping.
TARGETS = {
    "cad": {"column": "Cath", "positive": "CAD"},
    "lad": {"column": "LAD", "positive": "Stenotic"},
    "lcx": {"column": "LCX", "positive": "Stenotic"},
    "rca": {"column": "RCA", "positive": "Stenotic"},
}

# Numeric (median impute + robust scale). Includes 0/1 binaries kept as numerics.
NUMERIC_FEATURES = [
    "Age", "Weight", "Length", "BMI",
    "DM", "HTN", "Current Smoker", "EX-Smoker", "FH",
    "BP", "PR", "Edema",
    "Typical Chest Pain", "Function Class",
    "Q Wave", "St Elevation", "St Depression", "Tinversion",
    "FBS", "CR", "TG", "LDL", "HDL", "BUN", "ESR", "HB",
    "K", "Na", "WBC", "Lymph", "Neut", "PLT", "EF-TTE",
]

# Y/N categoricals (most-frequent impute + one-hot).
YN_FEATURES = [
    "Obesity", "CRF", "CVA", "Airway disease", "Thyroid Disease",
    "CHF", "DLP", "Weak Peripheral Pulse", "Lung rales",
    "Systolic Murmur", "Diastolic Murmur", "Dyspnea", "Atypical",
    "Nonanginal", "LowTH Ang", "LVH", "Poor R Progression",
]

# Nominal categoricals.
NOMINAL_FEATURES = ["Sex", "BBB", "VHD", "Region RWMA"]

ALL_INPUT_FEATURES = NUMERIC_FEATURES + YN_FEATURES + NOMINAL_FEATURES

# Categorical block for the native track (see build_native_preprocessor).
NATIVE_CAT_FEATURES = YN_FEATURES + NOMINAL_FEATURES

# These are model features, never additional API inputs. The target defaults
# follow the exploratory accuracy comparison; they are not validated winners.
RATIO_FEATURES = ["LDL_HDL_ratio", "TG_HDL_ratio", "Neut_Lymph_ratio"]
COUNT_FEATURES = ["risk_factor_count", "ecg_finding_count"]
LOG_SOURCES = ["TG", "FBS", "ESR"]
LOG_FEATURES = [f"log1p_{name}" for name in LOG_SOURCES]
ENGINEERED_FEATURES = RATIO_FEATURES + COUNT_FEATURES + LOG_FEATURES
FEATURE_SETS = ("baseline", "ratios", "counts", "logs", "ratios_counts",
                "ratios_counts_logs")
DEFAULT_FEATURE_SETS = {"cad": "logs", "lad": "counts",
                        "lcx": "ratios_counts", "rca": "baseline"}


def resolve_feature_set(feature_set="auto", target=None):
    if feature_set == "auto":
        if target not in DEFAULT_FEATURE_SETS:
            raise ValueError("An existing target is required for feature_set='auto'")
        return DEFAULT_FEATURE_SETS[target]
    if feature_set not in FEATURE_SETS:
        raise ValueError(f"Unknown feature set: {feature_set!r}; choose from {FEATURE_SETS}")
    return feature_set


def engineered_feature_names(feature_set):
    feature_set = resolve_feature_set(feature_set)
    return ((RATIO_FEATURES if "ratios" in feature_set else [])
            + (COUNT_FEATURES if "counts" in feature_set else [])
            + (LOG_FEATURES if "logs" in feature_set else []))


def numeric_feature_names(feature_set="baseline"):
    feature_set = resolve_feature_set(feature_set)
    return ([name for name in NUMERIC_FEATURES
             if not ("logs" in feature_set and name in LOG_SOURCES)]
            + engineered_feature_names(feature_set))


def engineer_features(X, feature_set="ratios_counts_logs"):
    """Compute row-wise features using raw measurements only, before imputation.

    LDL/HDL and TG/HDL represent relative lipid levels; Neut/Lymph represents
    the white-cell differential balance. Counts summarize five recorded risk
    factors and four ECG findings with equal weights (not clinical scores).
    log1p(TG/FBS/ESR) compresses tails while preserving the original ranks.

    Invalid/missing operands propagate. Ratios require positive denominators;
    logs require nonnegative labs; counts require every binary constituent.
    No target, cohort statistics, clinical cutoffs or fitted thresholds are used.
    """
    feature_set = resolve_feature_set(feature_set)
    out = pd.DataFrame(index=X.index)

    def numeric(name):
        return pd.to_numeric(X[name], errors="coerce").replace([np.inf, -np.inf], np.nan)

    if "ratios" in feature_set:
        for name, numerator, denominator in zip(RATIO_FEATURES,
                ["LDL", "TG", "Neut"], ["HDL", "HDL", "Lymph"]):
            n, d = numeric(numerator), numeric(denominator)
            out[name] = n.where(n.ge(0)) / d.where(d.gt(0))
    if "counts" in feature_set:
        def binary(name):
            values = numeric(name)
            return values.where(values.isin([0, 1]))
        risk = pd.DataFrame({name: binary(name) for name in
                             ["DM", "HTN", "Current Smoker", "FH"]})
        risk["DLP"] = X["DLP"].map({"Y": 1.0, "N": 0.0})
        out[COUNT_FEATURES[0]] = risk.sum(axis=1, min_count=5)
        ecg = pd.DataFrame({name: binary(name) for name in
                            ["Q Wave", "St Elevation", "St Depression", "Tinversion"]})
        out[COUNT_FEATURES[1]] = ecg.sum(axis=1, min_count=4)
    if "logs" in feature_set:
        for source, name in zip(LOG_SOURCES, LOG_FEATURES):
            values = numeric(source)
            out[name] = np.log1p(values.where(values.ge(0)))
    return out.replace([np.inf, -np.inf], np.nan)


class NumericFeatureEngineer(TransformerMixin, BaseEstimator):
    """Serializable, cloneable numeric branch shared by training and inference."""

    def __init__(self, feature_set="baseline"):
        self.feature_set = feature_set

    def fit(self, X, y=None):
        resolve_feature_set(self.feature_set)
        self.feature_names_in_ = np.asarray(X.columns, dtype=object)
        self.n_features_in_ = len(self.feature_names_in_)
        return self

    def transform(self, X):
        check_is_fitted(self, "feature_names_in_")
        derived = engineer_features(X, self.feature_set)
        original = [name for name in numeric_feature_names(self.feature_set)
                    if name in NUMERIC_FEATURES]
        raw = X.loc[:, original].apply(pd.to_numeric, errors="coerce")
        return pd.concat([raw, derived], axis=1).replace([np.inf, -np.inf], np.nan)

    def get_feature_names_out(self, input_features=None):
        check_is_fitted(self, "feature_names_in_")
        return np.asarray(numeric_feature_names(self.feature_set), dtype=object)


def _numeric_branch(feature_set):
    feature_set = resolve_feature_set(feature_set)
    # Preserve the exact legacy transformer for no-argument callers/artifacts.
    columns = list(NUMERIC_FEATURES)
    steps = []
    if feature_set != "baseline":
        if "counts" in feature_set:
            columns.append("DLP")
        steps.append(("engineer", NumericFeatureEngineer(feature_set)))
    steps.extend([
        ("imputer", SimpleImputer(strategy="median", keep_empty_features=feature_set != "baseline")),
        ("scaler", RobustScaler()),
    ])
    return Pipeline(steps), columns


def clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize known data quirks. Idempotent; safe for train and inference."""
    df = df.copy()
    if "Sex" in df.columns:
        df["Sex"] = df["Sex"].replace({"Fmale": "Female"})
    if "Region RWMA" in df.columns:
        # Treat region code as categorical label (mapping undocumented in source data).
        df["Region RWMA"] = df["Region RWMA"].astype(str)
    return df


def build_preprocessor(feature_set="baseline") -> ColumnTransformer:
    numeric_pipe, numeric_columns = _numeric_branch(feature_set)
    categorical_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
    ])
    return ColumnTransformer([
        ("num", numeric_pipe, numeric_columns),
        ("cat", categorical_pipe, YN_FEATURES + NOMINAL_FEATURES),
    ])


def build_native_preprocessor(feature_set="baseline") -> ColumnTransformer:
    """Native-categorical track for LightGBM / CatBoost.

    Numerics identical to the one-hot track; categoricals become integer
    codes (-1 = unknown/missing) instead of one-hot columns. Output column
    order is [numeric_feature_names(feature_set)..., NATIVE_CAT_FEATURES...].
    ``native_cat_indices(feature_set)`` tracks the shifted categorical positions.
    """
    numeric_pipe, numeric_columns = _numeric_branch(feature_set)
    categorical_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("encoder", OrdinalEncoder(handle_unknown="use_encoded_value",
                                  unknown_value=-1, encoded_missing_value=-1)),
    ])
    return ColumnTransformer([
        ("num", numeric_pipe, numeric_columns),
        ("cat", categorical_pipe, NATIVE_CAT_FEATURES),
    ])


def build_voting_preprocessor(feature_set="baseline") -> Pipeline:
    ct = build_preprocessor(feature_set)
    return Pipeline([
        ("onehot", ct),
        ("scaler", StandardScaler(with_mean=False)),
    ])


def native_cat_indices(feature_set="baseline") -> list:
    """Column positions of categorical codes in native-track output."""
    start = len(numeric_feature_names(feature_set))
    return list(range(start, start + len(NATIVE_CAT_FEATURES)))


def encode_target(series: pd.Series, positive: str) -> pd.Series:
    return (series == positive).astype(int)


def split_features_target(df: pd.DataFrame, target_column: str, positive: str):
    """Drop leakage + target + zero-variance cols; return (X, y)."""
    df = clean_dataframe(df)
    drop = LEAKAGE_COLUMNS + [target_column] + [c for c in DROP_COLUMNS if c in df.columns]
    X = df.drop(columns=[c for c in drop if c in df.columns])
    # Keep only known input features (guards against stray columns).
    X = X[[c for c in ALL_INPUT_FEATURES if c in X.columns]]
    y = encode_target(df[target_column], positive)
    return X, y


def get_output_feature_names(preprocessor: ColumnTransformer) -> list:
    """Feature names after transform (sklearn >= 1.0)."""
    return list(preprocessor.get_feature_names_out())
