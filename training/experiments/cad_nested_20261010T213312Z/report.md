# SUPERSEDED PILOT — NOT THE FINAL COMPARISON

Iteration-count verification found that CatBoost prefixes differ from independent fixed-count fits. This pilot is retained for audit only. The authoritative replacement is `../cad_nested_verified_20261010/report.md`. `SUPERSEDED.json` records the reason. Its outer predictions describe the archived pilot procedure, not the corrected selection/calibration pipeline.

# CAD nested validation experiment

Run: `cad_nested_20261010T213312Z`. Final model: `slower`, **199 iterations**, calibration **sigmoid**, threshold **0.5** (fixed_0.5). Selected using development-only inner CV, not outer/holdout outcomes. Existing serving models are unchanged.

Outer-fold mean log loss changes **0.3392 → 0.3122**; the mean validation-minus-training loss gap changes **0.3223 → 0.2012**. Sensitivity changes **0.9010 → 0.9212**, and specificity **0.7880 → 0.7375**. The conditional paired log-loss interval includes zero; a probability-quality improvement remains uncertain. These results describe a probability/sensitivity/specificity trade-off, not universal clinical superiority.

## Audit and baseline

The existing CAD model is CatBoost 1.2.10, with native integer-coded categoricals; 400 iterations, depth 4, learning rate .05, L2=3, balanced class weights. Saved CatBoost resolves to Plain boosting and symmetric trees, not Ordered boosting. Its threshold is .5. The historical search selected from 32 configurations by mean ROC-AUC then F1 on repeated 5-fold CV. It did not maximize CAD F2 or select a stopping iteration. Reusing those folds to report the winning score introduces selection optimism. The previously plotted "outer" fold was part of that selection procedure; it was not an independent outer test of the complete search.

`baseline_snapshot/` preserves the previous model/configuration and available metrics; the initial audit includes an exact prediction-matching refit. New paired baseline results below refit the fixed legacy winner on exactly the improved pipeline's outer training rows. This is a fixed-model comparator, not an unbiased rerun of the historical 32-model selection procedure. The winner and proposed search were informed by prior views of this same cohort, so nesting cannot erase historical analyst adaptation.

Data: 303 rows, 54 unchanged predictors, prevalence 0.7129, zero exact duplicates in this dataset. `Cath == CAD` remains class 1. `Cath/LAD/LCX/RCA` never enter predictors. Cath versus any-stenotic disagreement rows: [93]; these are flagged, never relabeled. `data_audit.json` and `feature_audit.csv` contain the full schema and findings.

There is no patient identifier or timing metadata in the supplied CSV. The specification includes ECG/echo/laboratory predictors but cannot establish that each measurement precedes the intended decision. Repeated-patient independence and prediction-time availability therefore remain unverified. An explicit/recognized patient-ID column activates stratified grouped splits at every level; exact duplicate predictors are also grouped. No legitimate predictor was removed for correlation. BMI/weight/height/obesity, Lymph/Neut and rare categories warrant stability review. Imputation, scaling, categorical vocabularies and all calibrators fit within training partitions. No resampling or learned feature selection is performed. A legacy XGBoost class-weight ratio was computed from the whole development partition; the new CatBoost path computes automatic weights only in its fitting partition.

## Protocol and controlled experiments

The original 242/61 development/historical-holdout split (seed 42) is retained for the supplied ungrouped data. Outer seeds: [42, 43, 44, 45, 46, 47, 48, 49, 50, 51]; 5 outer folds, 3 inner folds. Folds, raw row indices and sub-calibration partitions are recorded. The 61-row historical holdout has already been viewed in project development; its secondary result is not pristine external validation.

Primary objective: unweighted log loss for probability estimation. Six small, prespecified candidate configurations isolate stopping, removal of class weighting, lower depth, increased L2, and slower learning; the last is an explicit combined leaf/sampling intervention. Full parameters: `config.json`. CatBoost supports L2, depth, sampling and Depthwise minimum leaf sample constraints; its SymmetricTree policy does not honor that leaf constraint. No unsupported L1/minimum split-gain parameter is invented. The combined arm uses Depthwise, minimum leaf samples 15, Bernoulli row sampling .8 and feature sampling .8.

Inner-only early stopping uses patience 40, maximum 400, and `Logloss:use_weights=false`; categorical counters exclude validation data (`SkipTest`). Fixed counts [60, 80, 100, 120, 150] and each candidate's median inner best iteration are compared by mean inner loss. A separate fixed-count fit evaluates counts beyond an early-stopped fit. Final refits use the chosen count with no outer eval_set. All stage metrics, including F2, are saved; full-path diagnostic plots deliberately show later overfitting after the selected count. A minimum on one plotted fold is not the selection rule.

Calibration compares raw, Platt sigmoid (smoothed targets on raw log odds, monotone nonnegative slope), and isotonic. For each inner validation fold, a further 3-fold training-only OOF fit supplies calibrator training data. Inner validation labels never enter those base/calibrator fits. Calibration method is chosen by mean inner log loss, then fitted to development-side OOF predictions. Hyperparameters were already inner-selected, so inner calibration scores are selection diagnostics; outer results estimate the whole procedure. Isotonic is evaluated as a small-sample diagnostic and may overfit. All calibration transforms clip probabilities to [1e-06, 0.999999].

The final threshold policy stays at .5 absent a justified clinical utility/constraint. Exploratory F2 and sensitivity/specificity operating points use cross-calibrated inner OOF labels exclusively. They do not select on outer-test labels. Balanced weights are a candidate choice, not an assumption that CAD is the minority class (it is the majority).

## Outer-fold comparison (mean ± sample SD)

Columns labeled training describe resubstitution on the outer training rows. Every other performance column describes outer-test evaluation. The `raw/sigmoid/isotonic` arms share the inner-selected base model; `selected` additionally selects calibration within training. Rows are not models selected by outer performance. `prevalence` uses each outer training partition's prevalence and predicts everybody positive at .5.

| variant | iterations | training_log_loss | log_loss | roc_auc | average_precision | sensitivity | specificity | precision | f1 | f2 | accuracy | brier | calibration_slope | calibration_intercept | ece_quantile_5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 400.0000 ± 0.0000 | 0.0169 ± 0.0023 | 0.3392 ± 0.0976 | 0.9273 ± 0.0304 | 0.9702 ± 0.0138 | 0.9010 ± 0.0469 | 0.7880 ± 0.0970 | 0.9157 ± 0.0348 | 0.9074 ± 0.0302 | 0.9033 ± 0.0388 | 0.8690 ± 0.0414 | 0.1020 ± 0.0296 | 0.7607 ± 0.2812 | 0.2308 ± 0.4751 | 0.0727 ± 0.0276 |
| raw | 189.2000 ± 59.8488 | 0.1122 ± 0.0388 | 0.3136 ± 0.0528 | 0.9278 ± 0.0317 | 0.9703 ± 0.0148 | 0.9166 ± 0.0452 | 0.7359 ± 0.0986 | 0.8984 ± 0.0333 | 0.9065 ± 0.0269 | 0.9123 ± 0.0362 | 0.8653 ± 0.0377 | 0.0973 ± 0.0205 | 1.6310 ± 2.3725 | -0.1735 ± 0.7616 | 0.0736 ± 0.0253 |
| sigmoid | 189.2000 ± 59.8488 | 0.1083 ± 0.0334 | 0.3110 ± 0.0552 | 0.9278 ± 0.0317 | 0.9703 ± 0.0148 | 0.9166 ± 0.0447 | 0.7578 ± 0.0970 | 0.9058 ± 0.0340 | 0.9104 ± 0.0300 | 0.9139 ± 0.0374 | 0.8715 ± 0.0422 | 0.0959 ± 0.0216 | 1.6043 ± 2.3996 | -0.0509 ± 0.4893 | 0.0706 ± 0.0215 |
| isotonic | 189.2000 ± 59.8488 | 0.0920 ± 0.0376 | 0.3982 ± 0.1504 | 0.9206 ± 0.0339 | 0.9570 ± 0.0205 | 0.9078 ± 0.0538 | 0.7718 ± 0.1030 | 0.9106 ± 0.0371 | 0.9081 ± 0.0336 | 0.9077 ± 0.0443 | 0.8694 ± 0.0452 | 0.0992 ± 0.0248 | 1.5812 ± 5.1628 | 0.7179 ± 4.2846 | 0.0659 ± 0.0253 |
| selected | 189.2000 ± 59.8488 | 0.1110 ± 0.0370 | 0.3122 ± 0.0535 | 0.9280 ± 0.0317 | 0.9702 ± 0.0148 | 0.9212 ± 0.0439 | 0.7375 ± 0.0996 | 0.8992 ± 0.0337 | 0.9093 ± 0.0288 | 0.9162 ± 0.0362 | 0.8690 ± 0.0408 | 0.0969 ± 0.0208 | 1.6223 ± 2.3708 | -0.1961 ± 0.6663 | 0.0717 ± 0.0233 |
| prevalence | 0.0000 ± 0.0000 | 0.5977 ± 0.0017 | 0.5978 ± 0.0070 | 0.5000 ± 0.0000 | 0.7149 ± 0.0077 | 1.0000 ± 0.0000 | 0.0000 ± 0.0000 | 0.7149 ± 0.0077 | 0.8337 ± 0.0052 | 0.9261 ± 0.0026 | 0.7149 ± 0.0077 | 0.2039 ± 0.0033 | nan ± nan | nan ± nan | 0.0071 ± 0.0064 |

Selected-pipeline log loss improved in **34/50 outer folds**. This count is descriptive, not a significance test; folds/repeats share patients and training data. `repeat_metrics.csv` reports each seed's full OOF performance. `selection_frequency.csv` records configuration/stopping/calibration variability. `inner_search.csv`, `inner_calibration.csv` and `early_stopping.csv` are explicitly separate inner diagnostics.

## Paired uncertainty

| metric | baseline | selected | difference | difference_95%_CI |
| --- | --- | --- | --- | --- |
| log_loss | 0.3390 | 0.3121 | -0.0269 | [-0.0683, 0.0098] |
| roc_auc | 0.9253 | 0.9250 | -0.0003 | [-0.0069, 0.0057] |
| average_precision | 0.9688 | 0.9676 | -0.0011 | [-0.0068, 0.0028] |
| sensitivity | 0.9012 | 0.9214 | 0.0202 | [0.0077, 0.0341] |
| specificity | 0.7884 | 0.7377 | -0.0507 | [-0.0863, -0.0246] |
| precision | 0.9145 | 0.8982 | -0.0163 | [-0.0296, -0.0067] |
| f1 | 0.9077 | 0.9096 | 0.0018 | [-0.0075, 0.0108] |
| f2 | 0.9038 | 0.9166 | 0.0128 | [0.0022, 0.0243] |
| accuracy | 0.8690 | 0.8690 | 0.0000 | [-0.0136, 0.0124] |
| brier | 0.1020 | 0.0969 | -0.0051 | [-0.0135, 0.0032] |

Intervals use 1000 paired cluster-bootstrap draws, resampling each patient/group with all repeat predictions together. Estimates here are mean complete-OOF-repeat metrics, which differ slightly from mean per-fold metrics above. Intervals are conditional on fitted models/splits and this cohort; they do not capture refitting uncertainty, historical analyst choices, or external-site shift. Fold SD is not a confidence interval. Calibration intercept/slope are noisy diagnostics without a reported interval; a constant predictor or complete separation gives an undefined slope rather than an invented number.

## Calibration and probability quality

Calibration diagnostics below are averaged over complete OOF repeats (one prediction per patient per repeat), which are more stable than regressions on individual approximately 49-row folds. The main comparison also preserves fold-level calibration values for audit; large fold-level slopes should not be mistaken for precise estimates.

| variant | calibration_intercept_mean | calibration_slope_mean | calibration_in_large_mean | ece_quantile_5_mean | ece_uniform_10_mean |
| --- | --- | --- | --- | --- | --- |
| baseline | 0.2622 | 0.6652 | 0.2325 | 0.0475 | 0.0697 |
| isotonic | 0.1934 | 0.5904 | 0.0619 | 0.0244 | 0.0462 |
| prevalence | 4.6756 | -4.0862 | -0.0000 | 0.0071 | 0.0000 |
| raw | -0.0703 | 1.1211 | -0.0168 | 0.0277 | 0.0517 |
| selected | -0.0826 | 1.1237 | -0.0301 | 0.0282 | 0.0532 |
| sigmoid | 0.0206 | 1.1073 | 0.0573 | 0.0218 | 0.0517 |

`cv_summary.csv` and `repeat_metrics.csv` include joint logistic calibration intercept (ideal 0), slope (ideal 1), calibration-in-the-large with slope fixed at 1, ECE with 5 quantile bins and 10 equal-width bins, log loss and Brier. Calibration regression is evaluation-only and is never used to alter outer predictions. ECE depends strongly on binning/sample size; ties can reduce quantile bin count. Brier mixes calibration and discrimination and does not prove calibration by itself. Compare against the prevalence probability baseline, not zero. `plots/calibration.png` shows seed 42 once per patient; it does not pool dependent repetitions as extra patients.

## Sensitivity, specificity and false-positive burden

| policy | sensitivity_mean | specificity_mean | precision_mean | f2_mean | false_positives_per_100_mean |
| --- | --- | --- | --- | --- | --- |
| f2_max | 0.9774 | 0.3377 | 0.7912 | 0.9323 | 18.8767 |
| fixed_0.3 | 0.9571 | 0.5057 | 0.8309 | 0.9284 | 14.0791 |
| fixed_0.4 | 0.9398 | 0.6563 | 0.8744 | 0.9255 | 9.7883 |
| fixed_0.5 | 0.9212 | 0.7375 | 0.8992 | 0.9162 | 7.4762 |
| fixed_0.6 | 0.8957 | 0.7967 | 0.9181 | 0.8996 | 5.7883 |
| fixed_0.7 | 0.8530 | 0.8540 | 0.9381 | 0.8679 | 4.1395 |
| sensitivity_0.9 | 0.9073 | 0.7721 | 0.9099 | 0.9073 | 6.4872 |
| sensitivity_0.95 | 0.9514 | 0.5886 | 0.8555 | 0.9298 | 11.7296 |
| specificity_0.8 | 0.8824 | 0.8179 | 0.9263 | 0.8900 | 5.1684 |
| specificity_0.9 | 0.7729 | 0.9164 | 0.9612 | 0.8033 | 2.3639 |

Rows show **outer** mean results using thresholds fixed or selected exclusively inside training. Sensitivity/specificity labels denote exploratory training targets and are not guaranteed on outer patients. F2 can be high for an all-positive classifier in this high-prevalence cohort; inspect the prevalence row, specificity, precision, and false positives per 100 patients before interpreting recall-weighted scores. No operating point is clinically justified merely by these internal results.

## Historical holdout (secondary, previously inspected)

| variant | log_loss | roc_auc | average_precision | sensitivity | specificity | precision | f1 | f2 | accuracy | brier | calibration_slope | calibration_intercept | ece_quantile_5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 0.4350 | 0.8928 | 0.9501 | 0.9302 | 0.6667 | 0.8696 | 0.8989 | 0.9174 | 0.8525 | 0.1150 | 0.5786 | -0.2301 | 0.0517 |
| raw | 0.4014 | 0.8786 | 0.9438 | 0.9535 | 0.5556 | 0.8367 | 0.8913 | 0.9276 | 0.8361 | 0.1281 | 1.1065 | -0.5408 | 0.0863 |
| sigmoid | 0.3951 | 0.8786 | 0.9438 | 0.9302 | 0.6111 | 0.8511 | 0.8889 | 0.9132 | 0.8361 | 0.1248 | 0.9663 | -0.3202 | 0.0675 |
| isotonic | 0.3908 | 0.8876 | 0.9357 | 0.9535 | 0.5556 | 0.8367 | 0.8913 | 0.9276 | 0.8361 | 0.1231 | 0.7182 | -0.2830 | 0.0482 |
| selected | 0.3951 | 0.8786 | 0.9438 | 0.9302 | 0.6111 | 0.8511 | 0.8889 | 0.9132 | 0.8361 | 0.1248 | 0.9663 | -0.3202 | 0.0675 |
| prevalence | 0.6069 | 0.5000 | 0.7049 | 1.0000 | 0.0000 | 0.7049 | 0.8269 | 0.9227 | 0.7049 | 0.2081 | NA | NA | 0.0100 |

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
MPLCONFIGDIR=/tmp/cardisoft-mpl-cache python3 training/experiment_report.py --run training/experiments/cad_nested_20261010T213312Z
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
