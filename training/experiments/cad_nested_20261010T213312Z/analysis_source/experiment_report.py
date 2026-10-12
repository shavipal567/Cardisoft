"""Regenerate CAD tables, paired uncertainty, and standalone figures from saved OOF predictions."""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score, roc_curve

from clinical_metrics import binary_metrics, calibration_bins
from evaluation_plots import draw_confusion_matrix

CORE = ["log_loss", "roc_auc", "average_precision", "sensitivity", "specificity",
        "precision", "f1", "f2", "accuracy", "brier"]


def fast_repeat_metrics(y, probabilities, thresholds):
    """Mean of complete OOF repeat metrics, keeping repeated patients together."""
    pred = probabilities >= thresholds
    tp = np.sum(pred & (y[None, :] == 1), axis=1)
    fp = np.sum(pred & (y[None, :] == 0), axis=1)
    fn = np.sum(~pred & (y[None, :] == 1), axis=1)
    tn = np.sum(~pred & (y[None, :] == 0), axis=1)
    p = np.clip(probabilities, np.finfo(float).eps, 1 - np.finfo(float).eps)
    return {
        "log_loss": float(np.mean(-(y * np.log(p) + (1 - y) * np.log1p(-p)))),
        "roc_auc": float(np.mean([roc_auc_score(y, row) for row in probabilities])),
        "average_precision": float(np.mean([average_precision_score(y, row) for row in probabilities])),
        "sensitivity": float(np.mean(tp / (tp + fn))),
        "specificity": float(np.mean(tn / (tn + fp))),
        "precision": float(np.mean(tp / np.maximum(tp + fp, 1))),
        "f1": float(np.mean(2 * tp / np.maximum(2 * tp + fp + fn, 1))),
        "f2": float(np.mean(5 * tp / np.maximum(5 * tp + fp + 4 * fn, 1))),
        "accuracy": float(np.mean((tp + tn) / len(y))),
        "brier": float(np.mean((probabilities - y) ** 2)),
    }


def paired_bootstrap(predictions, samples, seed):
    """Resample patient/duplicate clusters; retain all repeats for each sampled unit.

    Percentile intervals are conditional on fitted models/splits and this source
    cohort. They do not capture training-set resampling or external-site shift.
    The estimand is mean complete-OOF-repeat performance, not an ensemble of
    averaged patient probabilities and not a mean of independent fold scores.
    """
    variants = ["baseline", "raw", "selected"]
    arrays = {}
    for variant in variants:
        data = predictions[predictions.variant == variant].sort_values(["seed", "row_index"])
        p = data.pivot(index="seed", columns="row_index", values="probability")
        t = data.pivot(index="seed", columns="row_index", values="threshold")
        arrays[variant] = (p.to_numpy(), t.to_numpy())
    first = predictions[(predictions.variant == "baseline") &
                        (predictions.seed == predictions.seed.min())].sort_values("row_index")
    y = first.y.to_numpy()
    groups = first.group.to_numpy()
    clusters = [np.flatnonzero(groups == group) for group in np.unique(groups)]
    rng = np.random.default_rng(seed)
    draws = {variant: [] for variant in variants}
    for _ in range(samples):
        indices = np.concatenate([clusters[i] for i in rng.integers(len(clusters), size=len(clusters))])
        if len(np.unique(y[indices])) != 2:
            continue
        for variant, (p, t) in arrays.items():
            draws[variant].append(fast_repeat_metrics(y[indices], p[:, indices], t[:, indices]))
    result = {"sampling_unit": "patient/group cluster (row assumed patient when ID unavailable)",
              "estimand": "mean complete-OOF-repeat metric", "requested_samples": samples,
              "valid_samples": len(draws["baseline"]), "variants": {}, "paired_differences": {}}
    for variant, (p, t) in arrays.items():
        point = fast_repeat_metrics(y, p, t)
        result["variants"][variant] = {metric: {
            "estimate": point[metric],
            "ci95": np.quantile([d[metric] for d in draws[variant]], [.025, .975]).tolist(),
        } for metric in CORE}
        if variant != "baseline":
            result["paired_differences"][f"{variant}_minus_baseline"] = {metric: {
                "estimate": point[metric] - result["variants"]["baseline"][metric]["estimate"],
                "ci95": np.quantile([a[metric] - b[metric] for a, b in
                                      zip(draws[variant], draws["baseline"])], [.025, .975]).tolist(),
            } for metric in CORE}
    return result


def figure(rows=1, cols=1, size=(8, 6)):
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure
    fig = Figure(figsize=size, layout="constrained", facecolor="white")
    FigureCanvasAgg(fig)
    return fig, fig.subplots(rows, cols, squeeze=False)


def evaluation_figures(predictions, directory, *, label="Outer OOF"):
    directory.mkdir(parents=True, exist_ok=True)
    colors = {"baseline": "#a5402d", "raw": "#13788d", "sigmoid": "#9467bd",
              "isotonic": "#a87912", "selected": "#236d36", "prevalence": "#777777"}
    # Average curves over full repeats, never concatenate repeated patients as independent.
    fig, axes = figure(1, 2, (12, 5))
    grid = np.linspace(0, 1, 201)
    for variant in ["baseline", "raw", "selected"]:
        roc_lines, pr_lines, aucs, aps = [], [], [], []
        for _, data in predictions[predictions.variant == variant].groupby("seed"):
            fpr, tpr, _ = roc_curve(data.y, data.probability)
            precision, recall, _ = precision_recall_curve(data.y, data.probability)
            roc_lines.append(np.interp(grid, fpr, tpr))
            pr_lines.append(np.interp(grid, recall[::-1], precision[::-1]))
            aucs.append(roc_auc_score(data.y, data.probability))
            aps.append(average_precision_score(data.y, data.probability))
        for ax, lines, text in [(axes[0, 0], roc_lines, f"{variant}: AUC {np.mean(aucs):.3f}"),
                               (axes[0, 1], pr_lines, f"{variant}: AP {np.mean(aps):.3f}")]:
            mean, std = np.mean(lines, axis=0), np.std(lines, axis=0)
            ax.plot(grid, mean, color=colors[variant], label=text)
            ax.fill_between(grid, np.maximum(0, mean-std), np.minimum(1, mean+std),
                            alpha=.08, color=colors[variant])
    prevalence = predictions[predictions.variant == "baseline"].y.mean()
    axes[0, 0].plot([0, 1], [0, 1], "--", color="grey")
    axes[0, 1].axhline(prevalence, linestyle="--", color="grey", label=f"Prevalence {prevalence:.3f}")
    for ax, xlabel, ylabel in [(axes[0, 0], "False positive rate", "Sensitivity"),
                              (axes[0, 1], "Recall", "Precision")]:
        ax.set(xlabel=xlabel, ylabel=ylabel, xlim=(0, 1), ylim=(0, 1.02))
        ax.legend(fontsize=9)
        ax.grid(alpha=.2)
    fig.suptitle(f"{label}: ROC and precision–recall\nMean across repeats; shading = repeat SD (not confidence interval)")
    fig.savefig(directory / "roc_precision_recall.png", dpi=170)

    seed = predictions.seed.min()
    fig, axes = figure(2, 1, (8, 9))
    for variant in ["baseline", "raw", "sigmoid", "isotonic", "selected"]:
        data = predictions[(predictions.variant == variant) & (predictions.seed == seed)]
        bins = calibration_bins(data.y, data.probability)
        axes[0, 0].plot([b["mean_probability"] for b in bins],
                        [b["observed_fraction"] for b in bins], "o-", label=variant, color=colors[variant])
        axes[1, 0].hist(data.probability, bins=np.linspace(0, 1, 11), histtype="step",
                        linewidth=1.5, label=variant, color=colors[variant])
    axes[0, 0].plot([0, 1], [0, 1], "--", color="grey")
    axes[0, 0].set(xlabel="Mean predicted probability", ylabel="Observed CAD fraction", xlim=(0, 1), ylim=(0, 1))
    axes[1, 0].set(xlabel="Predicted probability", ylabel="Patient count")
    axes[0, 0].legend()
    fig.suptitle(f"{label}: calibration, seed {seed}\nFive quantile bins; ties can reduce bin count; small-bin uncertainty")
    fig.savefig(directory / "calibration.png", dpi=170)

    fig, axes = figure(2, 2, (11, 9))
    for i, variant in enumerate(["baseline", "selected"]):
        data = predictions[(predictions.variant == variant) & (predictions.seed == seed)]
        metrics = binary_metrics(data.y, data.probability, data.threshold, calibration=False)
        matrix = [[metrics["tn"], metrics["fp"]], [metrics["fn"], metrics["tp"]]]
        for j, norm in enumerate([False, True]):
            draw_confusion_matrix(axes[i, j], matrix, "cad", normalize=norm)
            axes[i, j].set_title(f"{variant}: {'row percentages' if norm else 'counts'}")
    fig.suptitle(f"{label}: confusion matrices, seed {seed}\nOne OOF prediction per patient; saved fold thresholds")
    fig.savefig(directory / "confusion_matrices.png", dpi=170)
    seeds = sorted(predictions.seed.unique())
    if len(seeds) > 1:
        fig, axes = figure(len(seeds), 2, (9, 3.2 * len(seeds)))
        for i, seed in enumerate(seeds):
            for j, variant in enumerate(["baseline", "selected"]):
                data = predictions[(predictions.variant == variant) & (predictions.seed == seed)]
                m = binary_metrics(data.y, data.probability, data.threshold, calibration=False)
                draw_confusion_matrix(axes[i, j], [[m["tn"], m["fp"]], [m["fn"], m["tp"]]], "cad")
                axes[i, j].set_title(f"{variant} · seed {seed}")
        fig.suptitle("Outer OOF confusion matrices by repeat (same patients recur across repeats)")
        fig.savefig(directory / "confusion_matrices_by_seed.png", dpi=120)


def markdown_table(frame):
    """Avoid an optional tabulate dependency."""
    def fmt(value):
        if isinstance(value, (float, np.floating)):
            return "NA" if pd.isna(value) else f"{value:.4f}"
        return str(value).replace("|", "/").replace("\n", " ")
    return "\n".join(["| " + " | ".join(map(str, frame.columns)) + " |",
                       "| " + " | ".join(["---"] * len(frame.columns)) + " |"] +
                      ["| " + " | ".join(fmt(v) for v in row) + " |" for row in frame.itertuples(index=False, name=None)])


def generate_report(directory):
    from nested_cv import save_json
    directory = Path(directory)
    config = json.loads((directory / "config.json").read_text())
    audit = json.loads((directory / "data_audit.json").read_text())
    metadata = json.loads((directory / "model/cad/metadata.json").read_text())
    predictions = pd.read_csv(directory / "outer_predictions.csv")
    folds = pd.read_csv(directory / "outer_fold_metrics.csv")
    thresholds = pd.read_csv(directory / "outer_threshold_metrics.csv")
    numeric = [*CORE, "prevalence", "training_log_loss", "iterations", "calibration_intercept",
               "calibration_slope", "calibration_in_large", "ece_quantile_5", "ece_uniform_10"]
    summary = folds.groupby("variant")[numeric].agg(["mean", "std"])
    summary.columns = ["_".join(c) for c in summary.columns]
    summary.to_csv(directory / "cv_summary.csv")
    repeats = []
    for (variant, seed), data in predictions.groupby(["variant", "seed"]):
        repeats.append({"variant": variant, "seed": seed,
                        **binary_metrics(data.y, data.probability, data.threshold)})
    repeat_frame = pd.DataFrame(repeats)
    repeat_frame.to_csv(directory / "repeat_metrics.csv", index=False)
    calibration_columns = ["calibration_intercept", "calibration_slope", "calibration_in_large",
                           "ece_quantile_5", "ece_uniform_10"]
    calibration_summary = repeat_frame.groupby("variant")[calibration_columns].agg(["mean", "std"])
    calibration_summary.columns = ["_".join(c) for c in calibration_summary.columns]
    calibration_summary.to_csv(directory / "calibration_summary.csv")
    uncertainty = paired_bootstrap(predictions, config["bootstrap_samples"], config["bootstrap_seed"])
    save_json(directory / "bootstrap_ci.json", uncertainty)
    threshold_summary = thresholds.groupby("policy")[[*CORE, "false_positives_per_100", "threshold"]].agg(["mean", "std"])
    threshold_summary.columns = ["_".join(c) for c in threshold_summary.columns]
    threshold_summary.to_csv(directory / "threshold_summary.csv")
    permutation = pd.read_csv(directory / "permutation_importance.csv")
    if len(permutation):
        # Aggregate repetitions within each fold before describing across-fold spread.
        per_fold = permutation.groupby(["seed", "fold", "feature"]).log_loss_increase.mean().reset_index()
        importance = per_fold.groupby("feature").log_loss_increase.agg(["mean", "std"])
        importance["positive_fold_fraction"] = per_fold.groupby("feature").log_loss_increase.apply(lambda s: float((s > 0).mean()))
        importance.sort_values("mean", ascending=False).to_csv(directory / "feature_importance_summary.csv")
    else:
        importance = pd.DataFrame(columns=["mean", "std", "positive_fold_fraction"])
    selected = predictions[predictions.variant == "selected"].copy()
    selected["error"] = selected.prediction != selected.y
    selected.groupby("row_index").agg(probability_mean=("probability", "mean"),
        probability_std=("probability", "std"), error_fraction=("error", "mean"),
        y=("y", "first")).to_csv(directory / "patient_stability.csv")
    source = json.loads((directory / "provenance.json").read_text())
    dataset = pd.read_csv(source["dataset"])
    subgroups = []
    for (variant, seed), data in predictions[predictions.variant.isin(["baseline", "selected"])].groupby(["variant", "seed"]):
        cohort = dataset.loc[data.row_index]
        for name, mask in [("age_under_60", cohort.Age < 60), ("age_60_plus", cohort.Age >= 60),
                           ("sex_male", cohort.Sex == "Male"), ("sex_female", cohort.Sex.isin(["Fmale", "Female"]))]:
            rows = data.iloc[np.flatnonzero(mask.to_numpy())]
            subgroups.append({"variant": variant, "seed": seed, "subgroup": name,
                              **binary_metrics(rows.y, rows.probability, rows.threshold)})
    pd.DataFrame(subgroups).to_csv(directory / "subgroup_metrics.csv", index=False)

    plots = directory / "plots"
    evaluation_figures(predictions, plots)
    historical = pd.read_csv(directory / "historical_holdout_predictions.csv")
    historical["seed"] = config["split_seed"]
    evaluation_figures(historical, plots / "historical_holdout", label="Historical holdout (previously inspected)")
    fig, axes = figure(2, 2, (12, 8))
    for ax, metric in zip(axes.flat, ["log_loss", "roc_auc", "brier", "f2"]):
        for variant, color in [("baseline", "#a5402d"), ("selected", "#236d36")]:
            values = folds[folds.variant == variant].sort_values(["seed", "fold"])
            ax.plot(range(1, len(values) + 1), values[metric], ".-", label=variant, color=color, alpha=.8)
        ax.set(title=metric, xlabel="Outer fold (grouped by seed)")
        ax.grid(alpha=.2)
    axes[0, 0].legend()
    fig.suptitle("Paired outer-fold results; folds/repeats are dependent")
    fig.savefig(plots / "fold_performance.png", dpi=170)

    fig, axes = figure(1, 2, (13, 6))
    view = threshold_summary.sort_values("sensitivity_mean")
    for metric in ["sensitivity", "specificity", "precision", "f2"]:
        axes[0, 0].plot(view.index, view[f"{metric}_mean"], "o-", label=metric)
    axes[0, 0].legend()
    axes[0, 0].set(ylim=(0, 1.03), ylabel="Outer-fold mean")
    axes[0, 1].bar(view.index, view.false_positives_per_100_mean, color="#c76d38")
    axes[0, 1].set(ylabel="False positives per 100 evaluated patients")
    for ax in axes.flat:
        ax.tick_params(axis="x", rotation=70)
    fig.suptitle("Exploratory operating points: selected on training OOF, evaluated on outer folds\nSensitivity/specificity targets are training constraints, not clinical guarantees")
    fig.savefig(plots / "threshold_tradeoffs.png", dpi=170)
    fig, axes = figure(size=(10, 6))
    search = pd.read_csv(directory / "final_selection/inner_search.csv")
    for name, rows in search.groupby("candidate"):
        rows = rows.sort_values("iterations")
        axes[0, 0].plot(rows.iterations, rows.inner_validation_log_loss_mean, "o-", label=name)
    axes[0, 0].set(xlabel="Boosting iterations", ylabel="Mean inner-validation log loss")
    axes[0, 0].legend(fontsize=9)
    fig.suptitle("Final development-only selection (not outer evaluation)")
    fig.savefig(plots / "inner_iteration_comparison.png", dpi=170)
    if len(importance):
        fig, axes = figure(size=(10, 7))
        top = importance.sort_values("mean").tail(15)
        axes[0, 0].barh(top.index, top["mean"], xerr=top["std"], color="#13788d")
        axes[0, 0].set(xlabel="Outer-test log-loss increase after permutation (mean ± fold SD)")
        fig.suptitle("Feature diagnostics only; no features selected/removed from these results")
        fig.savefig(plots / "permutation_importance.png", dpi=170)

    comparison_rows = []
    for variant in ["baseline", "raw", "sigmoid", "isotonic", "selected", "prevalence"]:
        row = {"variant": variant}
        for metric in ["iterations", "training_log_loss", *CORE, "calibration_slope", "calibration_intercept", "ece_quantile_5"]:
            row[metric] = f"{summary.loc[variant, metric+'_mean']:.4f} ± {summary.loc[variant, metric+'_std']:.4f}"
        comparison_rows.append(row)
    comparison = pd.DataFrame(comparison_rows)
    comparison.to_csv(directory / "comparison.csv", index=False)
    paired = folds[folds.variant.isin(["baseline", "selected"])].pivot(index=["seed", "fold"], columns="variant", values="log_loss")
    wins = int((paired.selected < paired.baseline).sum())
    selection_counts = folds[folds.variant == "selected"].groupby(["candidate", "calibration_method", "iterations"]).size().reset_index(name="folds")
    selection_counts.to_csv(directory / "selection_frequency.csv", index=False)
    historical_metrics = json.loads((directory / "historical_holdout_metrics.json").read_text())
    hold_table = pd.DataFrame(historical_metrics).T[[*CORE, "calibration_slope", "calibration_intercept", "ece_quantile_5"]].reset_index(names="variant")
    operating = threshold_summary[[f"{m}_mean" for m in ["sensitivity", "specificity", "precision", "f2", "false_positives_per_100"]]].reset_index()
    ci_table = pd.DataFrame([{"metric": metric,
        "baseline": uncertainty["variants"]["baseline"][metric]["estimate"],
        "selected": uncertainty["variants"]["selected"][metric]["estimate"],
        "difference": uncertainty["paired_differences"]["selected_minus_baseline"][metric]["estimate"],
        "difference_95%_CI": str([round(x, 4) for x in uncertainty["paired_differences"]["selected_minus_baseline"][metric]["ci95"]])}
        for metric in CORE])
    calibration_table = calibration_summary[[c + "_mean" for c in calibration_columns]].reset_index()
    baseline_summary, selected_summary = summary.loc["baseline"], summary.loc["selected"]
    baseline_gap = baseline_summary.log_loss_mean - baseline_summary.training_log_loss_mean
    selected_gap = selected_summary.log_loss_mean - selected_summary.training_log_loss_mean
    loss_interval = uncertainty["paired_differences"]["selected_minus_baseline"]["log_loss"]["ci95"]
    interpretation = (
        "The conditional paired interval excludes zero in favor of lower log loss."
        if loss_interval[1] < 0 else
        "The conditional paired log-loss interval includes zero; a probability-quality improvement remains uncertain."
        if loss_interval[0] <= 0 else
        "The conditional paired interval indicates higher log loss for the candidate.")
    report = f"""# CAD nested validation experiment

Run: `{directory.name}`. Final model: `{metadata['best']['candidate']}`, **{metadata['best']['params']['iterations']} iterations**, calibration **{metadata['calibration']}**, threshold **{metadata['threshold']}** ({metadata['threshold_policy']}). Selected using development-only inner CV, not outer/holdout outcomes. Existing serving models are unchanged.

Outer-fold mean log loss changes **{baseline_summary.log_loss_mean:.4f} → {selected_summary.log_loss_mean:.4f}**; the mean validation-minus-training loss gap changes **{baseline_gap:.4f} → {selected_gap:.4f}**. Sensitivity changes **{baseline_summary.sensitivity_mean:.4f} → {selected_summary.sensitivity_mean:.4f}**, and specificity **{baseline_summary.specificity_mean:.4f} → {selected_summary.specificity_mean:.4f}**. {interpretation} These results describe a probability/sensitivity/specificity trade-off, not universal clinical superiority.

## Audit and baseline

The existing CAD model is CatBoost {source['versions']['catboost']}, with native integer-coded categoricals; 400 iterations, depth 4, learning rate .05, L2=3, balanced class weights. Saved CatBoost resolves to Plain boosting and symmetric trees, not Ordered boosting. Its threshold is .5. The historical search selected from 32 configurations by mean ROC-AUC then F1 on repeated 5-fold CV. It did not maximize CAD F2 or select a stopping iteration. Reusing those folds to report the winning score introduces selection optimism. The previously plotted "outer" fold was part of that selection procedure; it was not an independent outer test of the complete search.

`baseline_snapshot/` preserves the previous model/configuration and available metrics; the initial audit includes an exact prediction-matching refit. New paired baseline results below refit the fixed legacy winner on exactly the improved pipeline's outer training rows. This is a fixed-model comparator, not an unbiased rerun of the historical 32-model selection procedure. The winner and proposed search were informed by prior views of this same cohort, so nesting cannot erase historical analyst adaptation.

Data: {audit['rows']} rows, 54 unchanged predictors, prevalence {audit['prevalence']:.4f}, zero exact duplicates in this dataset. `Cath == CAD` remains class 1. `Cath/LAD/LCX/RCA` never enter predictors. Cath versus any-stenotic disagreement rows: {audit['target_vessel_disagreement_rows']}; these are flagged, never relabeled. `data_audit.json` and `feature_audit.csv` contain the full schema and findings.

There is no patient identifier or timing metadata in the supplied CSV. The specification includes ECG/echo/laboratory predictors but cannot establish that each measurement precedes the intended decision. Repeated-patient independence and prediction-time availability therefore remain unverified. An explicit/recognized patient-ID column activates stratified grouped splits at every level; exact duplicate predictors are also grouped. No legitimate predictor was removed for correlation. BMI/weight/height/obesity, Lymph/Neut and rare categories warrant stability review. Imputation, scaling, categorical vocabularies and all calibrators fit within training partitions. No resampling or learned feature selection is performed. A legacy XGBoost class-weight ratio was computed from the whole development partition; the new CatBoost path computes automatic weights only in its fitting partition.

## Protocol and controlled experiments

The original 242/61 development/historical-holdout split (seed 42) is retained for the supplied ungrouped data. Outer seeds: {config['seeds']}; {config['outer_folds']} outer folds, {config['inner_folds']} inner folds. Folds, raw row indices and sub-calibration partitions are recorded. The 61-row historical holdout has already been viewed in project development; its secondary result is not pristine external validation.

Primary objective: unweighted log loss for probability estimation. Six small, prespecified candidate configurations isolate stopping, removal of class weighting, lower depth, increased L2, and slower learning; the last is an explicit combined leaf/sampling intervention. Full parameters: `config.json`. CatBoost supports L2, depth, sampling and Depthwise minimum leaf sample constraints; its SymmetricTree policy does not honor that leaf constraint. No unsupported L1/minimum split-gain parameter is invented. The combined arm uses Depthwise, minimum leaf samples 15, Bernoulli row sampling .8 and feature sampling .8.

Inner-only early stopping uses patience {config['early_stopping_rounds']}, maximum {config['max_iterations']}, and `Logloss:use_weights=false`; categorical counters exclude validation data (`SkipTest`). Fixed counts {config['iteration_candidates']} and each candidate's median inner best iteration are compared by mean inner loss. Every candidate count is evaluated with an independent fixed-count fit: CatBoost prefixes of longer fits need not reproduce a model trained for that exact count. An explicit check verifies selected-count OOF predictions against independent refits. Final refits use the chosen count with no outer eval_set. All stage metrics, including F2, are saved; full-path diagnostic plots deliberately show later overfitting after the selected count. A minimum on one plotted fold is not the selection rule.

Calibration compares raw, Platt sigmoid (smoothed targets on raw log odds, monotone nonnegative slope), and isotonic. For each inner validation fold, a further {config['calibration_folds']}-fold training-only OOF fit supplies calibrator training data. Inner validation labels never enter those base/calibrator fits. Calibration method is chosen by mean inner log loss, then fitted to development-side OOF predictions. Hyperparameters were already inner-selected, so inner calibration scores are selection diagnostics; outer results estimate the whole procedure. Isotonic is evaluated as a small-sample diagnostic and may overfit. All calibration transforms clip probabilities to [{config['probability_clip']}, {1-config['probability_clip']}].

The final threshold policy stays at .5 absent a justified clinical utility/constraint. Exploratory F2 and sensitivity/specificity operating points use cross-calibrated inner OOF labels exclusively. They do not select on outer-test labels. Balanced weights are a candidate choice, not an assumption that CAD is the minority class (it is the majority).

## Outer-fold comparison (mean ± sample SD)

Columns labeled training describe resubstitution on the outer training rows. Every other performance column describes outer-test evaluation. The `raw/sigmoid/isotonic` arms share the inner-selected base model; `selected` additionally selects calibration within training. Rows are not models selected by outer performance. `prevalence` uses each outer training partition's prevalence and predicts everybody positive at .5.

{markdown_table(comparison)}

Selected-pipeline log loss improved in **{wins}/{len(paired)} outer folds**. This count is descriptive, not a significance test; folds/repeats share patients and training data. `repeat_metrics.csv` reports each seed's full OOF performance. `selection_frequency.csv` records configuration/stopping/calibration variability. `inner_search.csv`, `inner_calibration.csv` and `early_stopping.csv` are explicitly separate inner diagnostics.

## Paired uncertainty

{markdown_table(ci_table)}

Intervals use {config['bootstrap_samples']} paired cluster-bootstrap draws, resampling each patient/group with all repeat predictions together. Estimates here are mean complete-OOF-repeat metrics, which differ slightly from mean per-fold metrics above. Intervals are conditional on fitted models/splits and this cohort; they do not capture refitting uncertainty, historical analyst choices, or external-site shift. Fold SD is not a confidence interval. Calibration intercept/slope are noisy diagnostics without a reported interval; a constant predictor or complete separation gives an undefined slope rather than an invented number.

## Calibration and probability quality

Calibration diagnostics below are averaged over complete OOF repeats (one prediction per patient per repeat), which are more stable than regressions on individual approximately 49-row folds. The main comparison also preserves fold-level calibration values for audit; large fold-level slopes should not be mistaken for precise estimates.

{markdown_table(calibration_table)}

`cv_summary.csv` and `repeat_metrics.csv` include joint logistic calibration intercept (ideal 0), slope (ideal 1), calibration-in-the-large with slope fixed at 1, ECE with 5 quantile bins and 10 equal-width bins, log loss and Brier. Calibration regression is evaluation-only and is never used to alter outer predictions. ECE depends strongly on binning/sample size; ties can reduce quantile bin count. Brier mixes calibration and discrimination and does not prove calibration by itself. Compare against the prevalence probability baseline, not zero. `plots/calibration.png` shows seed {config['seeds'][0]} once per patient; it does not pool dependent repetitions as extra patients.

## Sensitivity, specificity and false-positive burden

{markdown_table(operating)}

Rows show **outer** mean results using thresholds fixed or selected exclusively inside training. Sensitivity/specificity labels denote exploratory training targets and are not guaranteed on outer patients. F2 can be high for an all-positive classifier in this high-prevalence cohort; inspect the prevalence row, specificity, precision, and false positives per 100 patients before interpreting recall-weighted scores. No operating point is clinically justified merely by these internal results.

## Historical holdout (secondary, previously inspected)

{markdown_table(hold_table)}

These scores are computed only after freezing final hyperparameters/calibration/threshold, but this cohort was already inspected historically. They must not be used for another selection round or claimed as new independent validation.

## Feature and robustness diagnostics

Outer-test permutation importance measures increase in log loss and is used only for explanation, after all choices. `feature_importance_summary.csv` aggregates permutation repetitions within folds before reporting fold spread and positive-effect frequency; correlated predictors can mask each other's importance. No feature was removed based on this analysis. `subgroup_metrics.csv` covers sex and age (<60/≥60), with sample sizes and class counts. These small, repeated subgroups are descriptive; they neither establish fairness nor justify subgroup retuning. `patient_stability.csv` records variability/error frequency across seeds. No patient was excluded for harming a score.

## Interpretation and limitations

The 400-iteration model has much greater fitting capacity than the approximately 193-row outer training folds can reliably support. Continued loss reduction on training data while validation loss rises is consistent with excess probability confidence even when ranking metrics plateau. Fixed 400 iterations, no stopping, model selection by ranking alone, and class-weighted fitting all merit examination; none of these observations alone proves causal responsibility. The controlled comparisons quantify the net effects. Better log loss alone cannot offset clinically important sensitivity/specificity deterioration; use the full table and paired intervals, and do not claim universal improvement.

This is internal validation in a small, high-prevalence, single-source dataset. No clinical validation, prospective utility, general-population prevalence, or temporal/site transportability is established. Missing patient IDs/timestamps and the discordant target record require provenance review. The experimental CAD candidate has not replaced the serving CAD or vessel models.

## Reproduction and artifacts

From repository root (existing pinned dependencies):

```bash
MPLCONFIGDIR=/tmp/cardisoft-mpl-cache OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 training/train.py --protocol nested --config training/configs/cad_nested.json
MPLCONFIGDIR=/tmp/cardisoft-mpl-cache python3 training/experiment_report.py --run {directory}
MPLCONFIGDIR=/tmp/cardisoft-mpl-cache OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 -m unittest discover -s training/tests -v
```

Use a new `--output` directory for each training run. `--dataset` and `--group-column` support explicit patient metadata; grouped splitting changes historical row allocation when required to prevent overlap. Exact executed configuration: `config.json`; code/environment/data fingerprints: `source/`, `provenance.json`.

- `model/cad/`: selected `model.joblib`, `preprocessor.joblib`, complete raw-DataFrame `pipeline.joblib`, `feature_schema.json`, threshold/configuration in `metadata.json`, explanation background.
- `outer_predictions.csv`, `outer_fold_metrics.csv`, `repeat_metrics.csv`, `cv_summary.csv`, `comparison.csv`, `bootstrap_ci.json`: independent outer predictions/metrics and conditional uncertainty.
- `outer_threshold_metrics.csv`, `threshold_summary.csv`: operating points and confusion counts at each fold/threshold.
- `folds/seed_42_fold_1/learning_curves/` and `final_selection/learning_curves/`: actual per-iteration train/inner-validation metrics CSVs, seven-panel PNGs including F2, row provenance.
- `plots/`: ROC/PR, calibration, count/normalized confusion matrices, confusion matrices per seed, fold variability, threshold trade-offs, permutation importance, inner iteration comparison.
- `historical_holdout_metrics.json`, `historical_holdout_predictions.csv`, `plots/historical_holdout/`: secondary evaluation.

Load the saved pipeline with `PYTHONPATH=training` so joblib can resolve the project's modules. It cleans and orders the same raw feature columns used during training; the separate preprocessor/model files retain the existing serving contract. No deployment is implied.

Learning curves describe the underlying booster before post-fit calibration; a calibrator has no boosting epochs. Native CatBoost history files retain the metric names/weighting used by CatBoost, while the seven-panel exported curves use unweighted sklearn metrics. `analysis_source/` records the report/metric implementation actually used to generate this report if postprocessing was updated after training began.

## Method references

- [scikit-learn 1.7 nested CV](https://scikit-learn.org/1.7/auto_examples/model_selection/plot_nested_cross_validation_iris.html): separating selection from generalization estimation.
- [CatBoost tuning parameters](https://catboost.ai/docs/en/concepts/parameter-tuning) and [fit](https://catboost.ai/docs/en/concepts/python-reference_catboostclassifier_fit): stopping and supported tree constraints.
- [scikit-learn 1.7 calibration](https://scikit-learn.org/1.7/modules/calibration.html): independent calibration data, isotonic small-sample risk, and limitations of Brier as a calibration diagnostic.

AP is `sklearn.metrics.average_precision_score`, a recall-increment-weighted average of precision, **not trapezoidal area under a PR interpolation**. ROC-AUC uses `roc_auc_score`; precision/recall/F1/F2 use binary positive class 1 and `>= threshold` (zero division -> 0). F2 = 5TP/(5TP + FP + 4FN). Accuracy = (TP+TN)/N; specificity = TN/(TN+FP); log loss and Brier are unweighted sklearn binary losses. Confusion rows are actual [0,1], columns predicted [0,1].
"""
    (directory / "report.md").write_text(report)
    import hashlib
    import shutil
    from datetime import datetime, timezone
    analysis_source = directory / "analysis_source"
    analysis_source.mkdir(exist_ok=True)
    for name in ["experiment_report.py", "clinical_metrics.py", "evaluation_plots.py"]:
        shutil.copy2(Path(__file__).resolve().parent / name, analysis_source / name)
    save_json(directory / "analysis_provenance.json", {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "source_sha256": {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                          for p in analysis_source.iterdir()},
        "outer_predictions_sha256": hashlib.sha256((directory / "outer_predictions.csv").read_bytes()).hexdigest(),
        "note": "Postprocessing only; does not change model fitting or selection",
    })
    return uncertainty


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    generate_report(parser.parse_args().run)
