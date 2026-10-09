"""Shared preprocessing for Cardisoft training + inference.

Leakage rule (PROBLEM.md S6, mandatory):
    LEAKAGE_COLUMNS = ["LAD", "LCX", "RCA", "Cath"]
must never be model inputs for CAD/LAD/LCX/RCA targets.

The preprocessor is fitted on TRAIN data only (see train.py).
"""

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, RobustScaler

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


def clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize known data quirks. Idempotent; safe for train and inference."""
    df = df.copy()
    if "Sex" in df.columns:
        df["Sex"] = df["Sex"].replace({"Fmale": "Female"})
    if "Region RWMA" in df.columns:
        # Treat region code as categorical label (mapping undocumented in source data).
        df["Region RWMA"] = df["Region RWMA"].astype(str)
    return df


def build_preprocessor() -> ColumnTransformer:
    numeric_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", RobustScaler()),
    ])
    categorical_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
    ])
    return ColumnTransformer([
        ("num", numeric_pipe, NUMERIC_FEATURES),
        ("cat", categorical_pipe, YN_FEATURES + NOMINAL_FEATURES),
    ])


def build_native_preprocessor() -> ColumnTransformer:
    """Native-categorical track for LightGBM / CatBoost.

    Numerics identical to the one-hot track; categoricals become integer
    codes (-1 = unknown/missing) instead of one-hot columns. Output column
    order is [NUMERIC_FEATURES..., NATIVE_CAT_FEATURES...], so categorical
    positions are ``range(len(NUMERIC_FEATURES), len(ALL_INPUT_FEATURES))``.
    """
    numeric_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", RobustScaler()),
    ])
    categorical_pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("encoder", OrdinalEncoder(handle_unknown="use_encoded_value",
                                  unknown_value=-1, encoded_missing_value=-1)),
    ])
    return ColumnTransformer([
        ("num", numeric_pipe, NUMERIC_FEATURES),
        ("cat", categorical_pipe, NATIVE_CAT_FEATURES),
    ])


def native_cat_indices() -> list:
    """Column positions of categorical codes in native-track output."""
    start = len(NUMERIC_FEATURES)
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
