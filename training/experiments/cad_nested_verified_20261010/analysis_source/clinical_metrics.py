"""Unweighted binary metrics, calibration diagnostics and training-only thresholds."""

import warnings

import numpy as np
from scipy.optimize import brentq
from scipy.special import expit, logit
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (accuracy_score, average_precision_score, brier_score_loss,
                             confusion_matrix, f1_score, fbeta_score, log_loss,
                             precision_score, recall_score, roc_auc_score)


def calibration_bins(y, p, n_bins=5, strategy="quantile"):
    y, p = np.asarray(y), np.asarray(p)
    edges = (np.unique(np.quantile(p, np.linspace(0, 1, n_bins + 1)))
             if strategy == "quantile" else np.linspace(0, 1, n_bins + 1))
    assignments = np.searchsorted(edges[1:-1], p, side="right")
    bins = []
    for i in np.unique(assignments):
        mask = assignments == i
        bins.append({"count": int(mask.sum()), "mean_probability": float(p[mask].mean()),
                     "observed_fraction": float(y[mask].mean())})
    return bins


def calibration_metrics(y, p):
    """Joint intercept/slope plus calibration-in-the-large (slope fixed to one)."""
    y, p = np.asarray(y), np.clip(p, 1e-6, 1 - 1e-6)
    z = logit(p)
    result = {}
    for strategy, count in [("quantile", 5), ("uniform", 10)]:
        bins = calibration_bins(y, p, count, strategy)
        result[f"ece_{strategy}_{count}"] = float(sum(
            b["count"] * abs(b["mean_probability"] - b["observed_fraction"])
            for b in bins) / len(y))
    result.update(calibration_intercept=None, calibration_slope=None,
                  calibration_in_large=None)
    if len(np.unique(y)) < 2:
        return result
    result["calibration_in_large"] = float(brentq(
        lambda a: np.mean(expit(a + z)) - np.mean(y), -50, 50))
    if np.std(z) < 1e-10:
        return result  # A slope is not identifiable for prevalence predictions.
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always", ConvergenceWarning)
        fit = LogisticRegression(penalty=None, max_iter=2000, tol=1e-9).fit(z[:, None], y)
    # Complete OR quasi-complete separation has no finite unpenalized slope.
    # Isotonic scores can create boundary ties shared by both classes.
    separated = max(z[y == 0]) <= min(z[y == 1]) or max(z[y == 1]) <= min(z[y == 0])
    if not caught and not separated:
        result["calibration_intercept"] = float(fit.intercept_[0])
        result["calibration_slope"] = float(fit.coef_[0, 0])
    return result


def binary_metrics(y, p, threshold=0.5, *, calibration=True):
    y, p = np.asarray(y), np.asarray(p, dtype=float)
    if p.shape != y.shape or not np.isfinite(p).all() or np.any((p < 0) | (p > 1)):
        raise ValueError("Expected one finite probability in [0, 1] for each label")
    pred = (p >= np.asarray(threshold)).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    result = {
        "n": len(y), "prevalence": float(np.mean(y)),
        "roc_auc": float(roc_auc_score(y, p)) if len(np.unique(y)) == 2 else None,
        "average_precision": float(average_precision_score(y, p)) if np.sum(y) else None,
        "accuracy": float(accuracy_score(y, pred)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "sensitivity": float(recall_score(y, pred, zero_division=0)),
        "specificity": float(tn / (tn + fp)) if tn + fp else None,
        "f1": float(f1_score(y, pred, zero_division=0)),
        "f2": float(fbeta_score(y, pred, beta=2, zero_division=0)),
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
        "brier": float(brier_score_loss(y, p)),
        "tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp),
        "false_positives_per_100": float(100 * fp / len(y)),
        "predicted_positive_fraction": float(pred.mean()),
    }
    if calibration:
        result.update(calibration_metrics(y, p))
    return result


def operating_thresholds(y, p, sensitivity_targets=(.9, .95),
                         specificity_targets=(.8, .9)):
    """Select on training OOF labels only; >= consistently defines positive.

    Endpoints admit all-positive and all-negative decisions. Constraints are
    empirical on training OOF data; they are not guarantees on new patients.
    """
    y, p = np.asarray(y), np.asarray(p)
    thresholds = np.r_[0., np.unique(p), np.nextafter(1., 2.)]
    predictions = p[:, None] >= thresholds[None, :]
    tp = np.sum(predictions & (y[:, None] == 1), axis=0)
    fp = np.sum(predictions & (y[:, None] == 0), axis=0)
    positives, negatives = np.sum(y == 1), np.sum(y == 0)
    sensitivity = tp / positives
    specificity = 1 - fp / negatives
    f2 = 5 * tp / np.maximum(4 * positives + tp + fp, 1)
    # Tie-break F2 by specificity, then sensitivity, then threshold.
    best = max(range(len(thresholds)), key=lambda i: (f2[i], specificity[i],
                                                     sensitivity[i], thresholds[i]))
    selected = {"fixed_0.5": .5, "f2_max": float(thresholds[best])}
    for target in sensitivity_targets:
        valid = np.flatnonzero(sensitivity >= target)
        i = max(valid, key=lambda i: (specificity[i], sensitivity[i], thresholds[i]))
        selected[f"sensitivity_{target:g}"] = float(thresholds[i])
    for target in specificity_targets:
        valid = np.flatnonzero(specificity >= target)
        i = max(valid, key=lambda i: (sensitivity[i], specificity[i], thresholds[i]))
        selected[f"specificity_{target:g}"] = float(thresholds[i])
    return selected
