"""Save held-out confusion matrices as counts and row-normalised percentages."""

import json
from pathlib import Path

import numpy as np


def draw_confusion_matrix(ax, matrix, target, *, normalize=False, vmax=None):
    """Draw actual classes on rows and predicted classes on columns, [0, 1]."""
    matrix = np.asarray(matrix, dtype=int)
    totals = matrix.sum(axis=1, keepdims=True)
    values = (np.divide(matrix, totals, out=np.zeros_like(matrix, dtype=float),
                        where=totals != 0) if normalize else matrix)
    maximum = (1.0 if normalize else
               (vmax if vmax is not None else max(int(matrix.max()), 1)))
    image = ax.imshow(values, cmap="Blues", vmin=0, vmax=maximum)
    positive = "CAD" if target == "cad" else "Stenotic"
    labels = ["Normal (0)", f"{positive} (1)"]
    ax.set_xticks([0, 1], labels=labels)
    ax.set_yticks([0, 1], labels=labels)
    ax.set_xlabel("Predicted class")
    ax.set_ylabel("Actual class")
    names = (("TN", "FP"), ("FN", "TP"))
    for row in range(2):
        for col in range(2):
            if normalize:
                label = f"{values[row, col]:.1%}" if totals[row, 0] else "N/A"
            else:
                label = str(matrix[row, col])
            ax.text(col, row, f"{names[row][col]}\n{label}", ha="center", va="center",
                    fontsize=15, fontweight="bold",
                    color="white" if values[row, col] > maximum / 2 else "#172b3a")
    return image


def save_confusion_matrix_plots(results, artifacts_dir):
    """Save per-target count/percentage PNGs and a combined count overview.

    Counts come directly from the evaluated results written to metrics.json.
    Threshold labels use each target's saved metadata, defaulting to 0.5.
    """
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure

    artifacts_dir = Path(artifacts_dir)
    matrices = {}
    thresholds = {}
    paths = []
    for key, result in results.items():
        counts = result["confusion_matrix"]
        matrix = np.array([[counts["tn"], counts["fp"]], [counts["fn"], counts["tp"]]])
        matrices[key] = matrix
        target_dir = artifacts_dir / key
        target_dir.mkdir(parents=True, exist_ok=True)
        metadata_path = target_dir / "metadata.json"
        metadata = json.loads(metadata_path.read_text()) if metadata_path.exists() else {}
        thresholds[key] = float(metadata.get("threshold", 0.5))
        figure = Figure(figsize=(11, 5.2), layout="constrained", facecolor="white")
        FigureCanvasAgg(figure)
        axes = figure.subplots(1, 2)
        for ax, normalize in zip(axes, (False, True)):
            image = draw_confusion_matrix(ax, matrix, key, normalize=normalize)
            ax.set_title("Patient counts" if not normalize else "Percent of each actual class",
                         fontsize=12, fontweight="bold")
            figure.colorbar(image, ax=ax, shrink=0.8,
                            label="Patients" if not normalize else "Fraction of actual class")
        figure.suptitle(f"{key.upper()} · Held-out test confusion matrix\n"
                       f"n = {result['n_test']} · Decision threshold = {thresholds[key]:g}",
                       fontsize=15, fontweight="bold")
        path = target_dir / "confusion_matrix.png"
        figure.savefig(path, dpi=180)
        paths.append(path)

    figure = Figure(figsize=(10, 5 * ((len(results) + 1) // 2)),
                    layout="constrained", facecolor="white")
    FigureCanvasAgg(figure)
    axes = figure.subplots((len(results) + 1) // 2, 2, squeeze=False)
    maximum = max(max(int(matrix.max()), 1) for matrix in matrices.values())
    for ax, (key, matrix) in zip(axes.flat, matrices.items()):
        image = draw_confusion_matrix(ax, matrix, key, vmax=maximum)
        ax.set_title(f"{key.upper()} · n = {results[key]['n_test']} · threshold {thresholds[key]:g}",
                     fontsize=12, fontweight="bold")
    for ax in list(axes.flat)[len(results):]:
        ax.set_visible(False)
    figure.colorbar(image, ax=list(axes.flat)[:len(results)], shrink=0.65, label="Patients")
    figure.suptitle("Confusion matrices · Held-out test sets\n"
                   "Each target uses its own stratified test split",
                   fontsize=16, fontweight="bold")
    path = artifacts_dir / "confusion_matrices.png"
    figure.savefig(path, dpi=180)
    paths.append(path)
    return paths
