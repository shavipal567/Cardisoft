"""Patient-specific grouped permutation Shapley estimates in probability units.

Uses frozen training backgrounds and paired forward/reverse permutations.
No SHAP/numba dependency and no substitution with global feature importance.
Categorical encodings move together, preserving valid one-hot combinations.
"""
from functools import lru_cache
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "training"))
from inference import artifacts_dir, get_artifact, transformed_row  # noqa: E402
from preprocessing import ALL_INPUT_FEATURES  # noqa: E402

BACKGROUND_ROWS = 16
ORDER_PAIRS = 4
SEED = 42


@lru_cache(maxsize=4)
def _background(path: str) -> np.ndarray:
    with np.load(path) as data:
        rows = np.asarray(data["background"], dtype=float)
    rng = np.random.default_rng(SEED)
    return rows[rng.choice(len(rows), min(BACKGROUND_ROWS, len(rows)), replace=False)]


def feature_groups(names: list[str]) -> dict[str, list[int]]:
    """Map transformed columns to whole original features (including one-hots)."""
    groups = {key: [] for key in ALL_INPUT_FEATURES}
    for index, name in enumerate(names):
        raw = name.split("__", 1)[-1]
        candidates = [key for key in groups if raw == key or raw.startswith(key + "_")]
        if not candidates:
            raise ValueError(f"Unrecognized transformed feature: {name}")
        groups[max(candidates, key=len)].append(index)
    return {key: columns for key, columns in groups.items() if columns}


def permutation_contributions(model, x, background, groups):
    """Approximate grouped Shapley values; complete paths ensure additivity.

    Each path begins at one reference patient and ends at the explained
    patient. Average marginal probability changes across paired orders and
    reference rows. This is an interventional approximation, not causality.
    """
    columns = list(groups.values())
    count = len(columns)
    rng = np.random.default_rng(SEED)
    paths, orders = [], []
    for reference in background:
        for _ in range(ORDER_PAIRS):
            order = rng.permutation(count)
            for sequence in (order, order[::-1]):
                path = np.empty((count + 1, len(x)))
                path[0] = reference
                for step, feature in enumerate(sequence, start=1):
                    path[step] = path[step - 1]
                    path[step, columns[feature]] = x[columns[feature]]
                paths.append(path)
                orders.append(sequence)
    probabilities = np.asarray(model.predict_proba(np.concatenate(paths)))[:, 1].reshape(-1, count + 1)
    if not np.isfinite(probabilities).all():
        raise ValueError("Model returned non-finite explanation probabilities")
    contributions = np.zeros(count)
    for sequence, changes in zip(orders, np.diff(probabilities, axis=1)):
        contributions[sequence] += changes
    contributions /= len(paths)
    return float(probabilities[:, 0].mean()), float(probabilities[:, -1].mean()), contributions


def explain_patient(features: dict, target: str = "cad", top_k: int = 10) -> dict:
    target = target.lower()
    model = get_artifact(target)["model"]
    x, names = transformed_row(features, target)
    background = _background(str(artifacts_dir() / target / "shap_background.npz"))
    groups = feature_groups(names)
    base, probability, contributions = permutation_contributions(model, x, background, groups)
    keys = list(groups)
    order = np.argsort(-np.abs(contributions), kind="stable")[:top_k]
    selected = float(contributions[order].sum())
    return {
        "target": target.upper(),
        "base_value": base,
        "probability": probability,
        "signed": True,
        "method": "permutation_shapley",
        "output_space": "probability",
        "approximate": True,
        "background_rows": len(background),
        "permutations_per_background": ORDER_PAIRS * 2,
        "remaining_contribution": float(contributions.sum() - selected),
        "note": ("Approximate patient-specific Shapley contributions in probability units, "
                 "relative to a sample of training patients. Positive values increase this "
                 "model estimate; negative values decrease it. These explain model behavior, "
                 "not medical causes. Uncollected measurements use server defaults."),
        "features": [
            {"name": keys[i], "value": features.get(keys[i]),
             "raw_value": features.get(keys[i]), "contribution": float(contributions[i])}
            for i in order
        ],
    }
