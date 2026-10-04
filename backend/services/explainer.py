"""Patient-specific feature attribution.

Primary: SHAP TreeExplainer (exact for RF/XGBoost). The installed shap build
is broken in some envs (numba/coverage conflict); in that case fall back to
model gain/frequency importance, clearly labeled via the `method` field.
Both describe model behavior, not clinical causality.
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "training"))

from inference import TARGET_KEYS, artifacts_dir, transformed_row  # noqa: E402
from preprocessing import clean_dataframe  # noqa: E402

TARGET_MAP = {"cad": "cad", "lad": "lad", "lcx": "lcx", "rca": "rca"}


def _fallback_explain(features: dict, target: str, top_k: int) -> dict:
    import joblib
    import pandas as pd

    from preprocessing import ALL_INPUT_FEATURES

    d = artifacts_dir() / target
    model = joblib.load(d / "model.joblib")
    meta = json.loads((d / "metadata.json").read_text())
    x, names = transformed_row(features, target)
    importances = np.asarray(model.feature_importances_, dtype=float)
    order = np.argsort(-importances)[:top_k]
    row = clean_dataframe(pd.DataFrame(
        [{k: features.get(k) for k in ALL_INPUT_FEATURES}])).iloc[0].to_dict()
    feats = [
        {"name": names[i],
         "value": float(x[i]),
         "contribution": float(importances[i] / importances.sum()),
         "raw_value": row.get(names[i].split("__")[-1], None)}
        for i in order
    ]
    return {
        "target": target.upper(),
        "base_value": float(meta["pos_rate_train"]),
        "probability": None,
        "method": "gain_importance_fallback",
        "note": ("SHAP unavailable in this environment; contributions are "
                 "normalized model importances (model behavior, not causality)."),
        "features": feats,
    }


def explain_patient(features: dict, target: str = "cad", top_k: int = 10) -> dict:
    target = TARGET_MAP[target.lower()]
    try:
        import shap
        import joblib

        d = artifacts_dir() / target
        model = joblib.load(d / "model.joblib")
        bg = np.load(d / "shap_background.npz")["background"]
        x, names = transformed_row(features, target)
        explainer = shap.TreeExplainer(model, data=bg)
        sv = np.asarray(explainer.shap_values(x.reshape(1, -1)))
        if sv.ndim == 3:  # binary classifier -> take positive class
            sv = sv[:, :, 1]
        sv = sv[0]
        base = explainer.expected_value
        if isinstance(base, (list, np.ndarray)):
            base = base[1] if len(base) > 1 else base[0]
        proba = float(model.predict_proba(x.reshape(1, -1))[0, 1])
        order = np.argsort(-np.abs(sv))[:top_k]
        return {
            "target": target.upper(),
            "base_value": float(base),
            "probability": proba,
            "method": "shap_tree",
            "note": ("SHAP values describe this model's output shift from base "
                     "value; not a causal clinical claim."),
            "features": [
                {"name": names[i], "value": float(x[i]),
                 "contribution": float(sv[i])}
                for i in order
            ],
        }
    except Exception as e:
        out = _fallback_explain(features, target, top_k)
        out["note"] += f" (shap error: {type(e).__name__})"
        if out["probability"] is None:
            try:
                import joblib
                model = joblib.load(artifacts_dir() / target / "model.joblib")
                x, _ = transformed_row(features, target)
                out["probability"] = float(model.predict_proba(x.reshape(1, -1))[0, 1])
            except Exception:
                pass
        return out
