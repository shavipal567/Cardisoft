"""Inference helper shared by training smoke tests and backend/.

Loads frozen artifacts from training/artifacts/<target>/
(preprocessor + model). No fitting here.
"""

import os
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from preprocessing import ALL_INPUT_FEATURES, clean_dataframe, get_output_feature_names

HERE = Path(__file__).resolve().parent
DEFAULT_ARTIFACTS = HERE / "artifacts"
TARGET_KEYS = ("cad", "lad", "lcx", "rca")


def artifacts_dir() -> Path:
    return Path(os.environ.get("ARTIFACTS_DIR", str(DEFAULT_ARTIFACTS)))


@lru_cache(maxsize=1)
def _load_all():
    base = artifacts_dir()
    bundle = {}
    for key in TARGET_KEYS:
        d = base / key
        bundle[key] = {
            "prep": joblib.load(d / "preprocessor.joblib"),
            "model": joblib.load(d / "model.joblib"),
        }
    return bundle


def available() -> bool:
    try:
        _load_all()
        return True
    except Exception:
        return False


def predict_patient(features: dict) -> dict:
    """features: raw clinical inputs keyed by CSV column name.

    Returns PROBLEM.md S23 schema:
    {cad: {prediction, probability}, vessels: {LAD, LCX, RCA}}.
    """
    bundle = _load_all()
    row = {k: features.get(k) for k in ALL_INPUT_FEATURES}
    df = clean_dataframe(pd.DataFrame([row]))
    out = {}
    for key in TARGET_KEYS:
        prep, model = bundle[key]["prep"], bundle[key]["model"]
        Xt = prep.transform(df)
        proba = float(model.predict_proba(Xt)[0, 1])
        out[key] = {"prediction": int(proba >= 0.5), "probability": proba}
    return {
        "cad": out["cad"],
        "vessels": {"LAD": out["lad"], "LCX": out["lcx"], "RCA": out["rca"]},
    }


def transformed_row(features: dict, target: str = "cad"):
    """Return (transformed vector, feature names) for explanation."""
    bundle = _load_all()
    prep = bundle[target]["prep"]
    row = {k: features.get(k) for k in ALL_INPUT_FEATURES}
    df = clean_dataframe(pd.DataFrame([row]))
    Xt = prep.transform(df)
    return np.asarray(Xt)[0], get_output_feature_names(prep)
