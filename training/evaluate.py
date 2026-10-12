"""Evaluate frozen artifacts on the held-out test split.

Reproduces train.py's stratified split (same seed) so evaluation uses data
never seen during fitting. Reports Accuracy/Precision/Recall/F1/ROC-AUC per
target (PROBLEM.md S10) and writes training/artifacts/metrics.json plus
per-target and combined confusion-matrix PNGs.
"""

import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score)
from sklearn.model_selection import train_test_split

from evaluation_plots import save_confusion_matrix_plots
from preprocessing import TARGETS, split_features_target
from train import ARTIFACTS_DIR, DATASET, RANDOM_STATE, TEST_SIZE

METRICS_PATH = ARTIFACTS_DIR / "metrics.json"


def evaluate_target(key, df):
    cfg = TARGETS[key]
    X, y = split_features_target(df, cfg["column"], cfg["positive"])
    _, X_test, _, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, stratify=y, random_state=RANDOM_STATE
    )
    d = ARTIFACTS_DIR / key
    prep = joblib.load(d / "preprocessor.joblib")
    model = joblib.load(d / "model.joblib")
    meta = json.loads((d / "metadata.json").read_text()) if (d / "metadata.json").exists() else {}
    threshold = meta.get("threshold", 0.5)
    Xt = prep.transform(X_test)
    proba = model.predict_proba(Xt)[:, 1]
    pred = (proba >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_test, pred, labels=[0, 1]).ravel().tolist()
    return {
        "target": key,
        "n_test": len(y_test),
        "pos_rate": float(y_test.mean()),
        "accuracy": float(accuracy_score(y_test, pred)),
        "precision": float(precision_score(y_test, pred, zero_division=0)),
        "recall": float(recall_score(y_test, pred, zero_division=0)),
        "f1": float(f1_score(y_test, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, proba)),
        "confusion_matrix": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
    }


def main():
    df = pd.read_csv(DATASET)
    results = {k: evaluate_target(k, df) for k in ("cad", "lad", "lcx", "rca")}
    METRICS_PATH.write_text(json.dumps(results, indent=2))
    plot_paths = save_confusion_matrix_plots(results, ARTIFACTS_DIR)
    print(f"{'target':6} {'acc':>6} {'prec':>6} {'rec':>6} {'f1':>6} {'auc':>6}")
    for k, m in results.items():
        print(f"{k:6} {m['accuracy']:.3f} {m['precision']:.3f} "
              f"{m['recall']:.3f} {m['f1']:.3f} {m['roc_auc']:.3f}")
    print(f"wrote {METRICS_PATH}")
    for path in plot_paths:
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
