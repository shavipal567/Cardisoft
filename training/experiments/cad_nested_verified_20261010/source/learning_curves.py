"""Persist per-stage metrics from a fitted outer-CV model without refitting.

Boosting curves use actual fitted iteration prefixes. Forest curves average
successive trees; these are tree-count diagnostics, not optimisation epochs.
Ensembles expose member curves and their own final-fit metrics separately.
"""

import csv
import json
from pathlib import Path

import numpy as np
from lightgbm import LGBMClassifier
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import (accuracy_score, average_precision_score,
                             brier_score_loss, f1_score, fbeta_score,
                             log_loss, roc_auc_score)
from xgboost import XGBClassifier

from native_models import CatBoostNative

METRICS = {
    "log_loss": "Log loss (lower is better)",
    "roc_auc": "ROC-AUC",
    "pr_auc": "PR-AUC (average precision)",
    "accuracy": "Accuracy",
    "f1": "F1",
    "brier": "Brier score (lower is better)",
    "f2": "F2 (recall-weighted)",
}
AXES = {
    "boosting_iteration": "Boosting iteration",
    "tree_count": "Number of trees",
    "final_fit": "Final fitted model (no epoch history)",
}


def staged_probabilities(model, X):
    """Yield (step type, 1-based step, positive probability) for fitted stages."""
    if isinstance(model, RandomForestClassifier):
        total = np.zeros(len(X), dtype=float)
        for step, tree in enumerate(model.estimators_, 1):
            total += tree.predict_proba(X)[:, 1]
            yield "tree_count", step, total / step
    elif isinstance(model, XGBClassifier):
        for step in range(1, model.get_booster().num_boosted_rounds() + 1):
            yield "boosting_iteration", step, model.predict_proba(
                X, iteration_range=(0, step))[:, 1]
    elif isinstance(model, LGBMClassifier):
        for step in range(1, model.booster_.current_iteration() + 1):
            yield "boosting_iteration", step, model.predict_proba(
                X, num_iteration=step)[:, 1]
    elif isinstance(model, HistGradientBoostingClassifier):
        for step, proba in enumerate(model.staged_predict_proba(X), 1):
            yield "boosting_iteration", step, proba[:, 1]
    elif isinstance(model, CatBoostNative):
        for step, proba in enumerate(
                model.model.staged_predict_proba(model._frame(X)), 1):
            yield "boosting_iteration", step, proba[:, 1]
    else:
        # Logistic regression and the ensemble itself do not expose epochs.
        yield "final_fit", 1, model.predict_proba(X)[:, 1]


def probability_metrics(y, proba, threshold=0.5):
    """Score unweighted binary metrics, matching the training CV convention."""
    pred = (proba >= threshold).astype(int)
    return {
        "log_loss": float(log_loss(y, proba, labels=[0, 1])),
        "roc_auc": float(roc_auc_score(y, proba)),
        "pr_auc": float(average_precision_score(y, proba)),
        "accuracy": float(accuracy_score(y, pred)),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "brier": float(brier_score_loss(y, proba)),
        "f2": float(fbeta_score(y, pred, beta=2, zero_division=0)),
    }


def plot_metrics(rows, path, title):
    """Save a standalone metric-panel PNG using a headless Matplotlib canvas."""
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure

    nrows = (len(METRICS) + 2) // 3
    figure = Figure(figsize=(12, 3.5 * nrows + 0.5),
                    layout="constrained", facecolor="white")
    FigureCanvasAgg(figure)
    grid = figure.add_gridspec(nrows, 3)
    axes = []
    for index in range(len(METRICS)):
        # A single metric in the final row spans the full width.
        cell = (grid[index // 3, :] if index == len(METRICS) - 1 and index % 3 == 0
                else grid[index // 3, index % 3])
        axes.append(figure.add_subplot(cell))
    step_type = rows[0]["step_type"]
    for ax, (metric, label) in zip(axes, METRICS.items()):
        for split, color in (("train", "#126782"), ("validation", "#c75c12")):
            selected = [row for row in rows if row["split"] == split]
            ax.plot([row["step"] for row in selected],
                    [row[metric] for row in selected], label=split.title(),
                    color=color, linewidth=1.8,
                    marker="o" if len(selected) == 1 else None)
        ax.set_title(label, loc="left", fontsize=11, fontweight="bold")
        ax.set_xlabel(AXES[step_type], fontsize=9)
        ax.grid(alpha=0.2)
        ax.spines[["top", "right"]].set_visible(False)
        if metric != "log_loss":
            ax.set_ylim(-0.03, 1.03)
        if step_type == "final_fit":
            ax.set_xticks([1])
        else:
            from matplotlib.ticker import MaxNLocator
            ax.xaxis.set_major_locator(MaxNLocator(integer=True))
    axes[0].legend(frameon=False)
    figure.suptitle(title, fontsize=14, fontweight="bold")
    figure.savefig(path, dpi=160)


def save_learning_curves(directory, *, model, preprocessor, X_train, y_train,
                         X_valid, y_valid, context):
    """Save CSV metrics, PNG plots and provenance for one outer CV fold.

    The inputs must be that fold's raw train/validation rows and its fitted
    preprocessor/model. No test data, refitting or parameter selection is used.
    """
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    Xt_train = preprocessor.transform(X_train)
    Xt_valid = preprocessor.transform(X_valid)
    X = np.concatenate((Xt_train, Xt_valid))
    n_train = len(y_train)
    components = [("model", model)]
    if hasattr(model, "fitted_estimators_"):
        components.extend((name, member) for (name, _), member in
                          zip(model.estimators, model.fitted_estimators_))

    rows, plots = [], []
    for name, member in components:
        member_rows = []
        threshold = float(getattr(member, "threshold", 0.5))
        for step_type, step, proba in staged_probabilities(member, X):
            for split, y, p in (("train", y_train, proba[:n_train]),
                                ("validation", y_valid, proba[n_train:])):
                member_rows.append({
                    "component": name, "step_type": step_type, "step": step,
                    "split": split, "threshold": threshold,
                    **probability_metrics(y, p, threshold),
                })
        rows.extend(member_rows)
        plot_name = f"{name}.png"
        plot_metrics(member_rows, directory / plot_name,
                     f"{context['target'].upper()} · {context['model']} · {name}\n"
                     f"{context.get('fold_label', 'Outer CV fold ' + str(context['fold']))}"
                     f" · seed {context['seed']}")
        plots.append(plot_name)

    with (directory / "metrics.csv").open("w", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    metadata = {
        **context,
        "source": context.get("source", "first_outer_cv_fold"),
        "n_train": n_train, "n_validation": len(y_valid),
        "train_row_indices": [int(i) for i in X_train.index],
        "validation_row_indices": [int(i) for i in X_valid.index],
        "held_out_test_used": False,
        "metrics_file": "metrics.csv", "plots": plots,
        "note": "One fold, not a CV average or final refit. Forest steps count "
                "trees; boosters count iterations. Ensemble/member final-fit "
                "points are not epoch curves. All metrics are unweighted.",
    }
    (directory / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    return metadata
