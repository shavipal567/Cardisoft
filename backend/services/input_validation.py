"""Evaluate frozen models on held-out rows with the submitted input mask.

These are exploratory cohort metrics, never a probability that an individual
prediction is correct. No fitting, feature selection or threshold tuning occurs.
"""

import json
import logging
from functools import lru_cache
from math import sqrt
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

from inference import TARGET_KEYS, get_artifact
from preprocessing import ALL_INPUT_FEATURES, TARGETS, clean_dataframe, split_features_target
from schemas import PatientInput

DATASET = Path(__file__).resolve().parents[1] / "data" / "dataset.csv"
logger = logging.getLogger(__name__)


def wilson_interval(correct: int, total: int) -> dict:
    """95% Wilson score interval for the fraction of correctly classified rows.

    https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm
    """
    z = 1.959963984540054
    p = correct / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    margin = z * sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return {"low": max(0.0, center - margin), "high": min(1.0, center + margin)}


@lru_cache(maxsize=1)
def _dataset(revision: tuple) -> pd.DataFrame:
    return pd.read_csv(revision[0])


def _predictions(bundle, X):
    probabilities = np.asarray(bundle["model"].predict_proba(bundle["prep"].transform(X)))[:, 1]
    if not np.isfinite(probabilities).all():
        raise ValueError("Non-finite validation predictions")
    return (probabilities >= bundle["threshold"]).astype(int)


@lru_cache(maxsize=8)
def _cohort(target: str, version: str, split: str, threshold: float, revision: tuple):
    metadata = json.loads(split)
    config = TARGETS[target]
    if metadata["csv_column"] != config["column"] or metadata["positive_label"] != config["positive"]:
        raise ValueError("Validation labels do not match the model metadata")
    X, y = split_features_target(_dataset(revision), config["column"], config["positive"])
    X_train, X_test, _, y_test = train_test_split(
        X, y, stratify=y, random_state=metadata["random_state"], test_size=metadata["test_size"],
    )
    if len(X_train) != metadata["n_train"] or len(X_test) != metadata["n_test"]:
        raise ValueError("Validation dataset does not match the saved split sizes")
    bundle = get_artifact(target)
    if bundle["version"] != version or bundle["threshold"] != threshold:
        raise ValueError("Model changed during validation")
    labels = y_test.to_numpy()
    full_accuracy = float(np.mean(_predictions(bundle, X_test) == labels))
    return X_test, labels, full_accuracy


@lru_cache(maxsize=128)
def _evaluate(supplied: tuple, defaults: tuple, models: tuple, revision: tuple) -> dict:
    default_values = dict(defaults)
    targets = {}
    for target, version, split, threshold in models:
        X_test, labels, full_accuracy = _cohort(target, version, split, threshold, revision)
        masked = X_test.copy()
        for key in ALL_INPUT_FEATURES:
            if key not in supplied:
                masked[key] = default_values[key]
        predicted = _predictions(get_artifact(target), clean_dataframe(masked))
        correct = int(np.sum(predicted == labels))
        positives = int(np.sum(labels == 1))
        true_positives = int(np.sum((predicted == 1) & (labels == 1)))
        targets[target.upper()] = {
            "accuracy": correct / len(labels), "correct": correct, "n_test": len(labels),
            "accuracy_interval": wilson_interval(correct, len(labels)),
            "recall": true_positives / positives if positives else None,
            "full_input_accuracy": full_accuracy,
            "majority_baseline": max(positives, len(labels) - positives) / len(labels),
            "model_version": version,
        }
    return targets


def input_validation(supplied: set[str]) -> dict:
    """Measure the exact field mask, independent of this patient's values.

    Cache keys include the input mask, defaults, model version/threshold/split,
    and dataset file revision. Missing validation resources must not block
    an otherwise valid prediction.
    """
    mask = tuple(key for key in ALL_INPUT_FEATURES if key in supplied)
    summary = {"supplied_count": len(mask), "total_features": len(ALL_INPUT_FEATURES)}
    try:
        stat = DATASET.stat()
        revision = (str(DATASET), stat.st_mtime_ns, stat.st_size)
        models = []
        for target in TARGET_KEYS:
            bundle = get_artifact(target)
            metadata = bundle["metadata"]
            split = json.dumps({key: metadata[key] for key in (
                "csv_column", "positive_label", "random_state", "test_size", "n_train", "n_test",
            )}, sort_keys=True)
            models.append((target, bundle["version"], split, bundle["threshold"]))
        targets = _evaluate(mask, tuple(PatientInput().to_feature_dict().items()), tuple(models), revision)
        return {**summary, "status": "available", "method": "held_out_default_substitution", "targets": targets}
    except Exception:
        logger.warning("Input-mask validation is unavailable", exc_info=True)
        return {**summary, "status": "unavailable",
                "reason": "Accuracy could not be evaluated for the loaded models and validation dataset."}
