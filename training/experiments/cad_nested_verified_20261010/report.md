# CAD nested validation experiment

Run: `cad_nested_verified_20261010`. Final model: `stopping_only`, **150 iterations**, calibration **sigmoid**, threshold **0.5** (fixed_0.5). Selected using development-only inner CV, not outer/holdout outcomes. Existing serving models are unchanged.

Outer-fold mean log loss changes **0.3392 → 0.3137**; the mean validation-minus-training loss gap changes **0.3223 → 0.2044**. Sensitivity changes **0.9010 → 0.9201**, and specificity **0.7880 → 0.7316**. The conditional paired log-loss interval includes zero; a probability-quality improvement remains uncertain. These results describe a probability/sensitivity/specificity trade-off, not universal clinical superiority.

## Audit and baseline

The existing CAD model is CatBoost 1.2.10, with native integer-coded categoricals; 400 iterations, depth 4, learning rate .05, L2=3, balanced class weights. Saved CatBoost resolves to Plain boosting and symmetric trees, not Ordered boosting. Its threshold is .5. The historical search selected from 32 configurations by mean ROC-AUC then F1 on repeated 5-fold CV. It did not maximize CAD F2 or select a stopping iteration. Reusing those folds to report the winning score introduces selection optimism. The previously plotted "outer" fold was part of that selection procedure; it was not an independent outer test of the complete search.

`baseline_snapshot/` preserves the previous model/configuration and available metrics; the initial audit includes an exact prediction-matching refit. New paired baseline results below refit the fixed legacy winner on exactly the improved pipeline's outer training rows. This is a fixed-model comparator, not an unbiased rerun of the historical 32-model selection procedure. The winner and proposed search were informed by prior views of this same cohort, so nesting cannot erase historical analyst adaptation.

Data: 303 rows, 54 unchanged predictors, prevalence 0.7129, exact duplicate full/input rows 0/0. `Cath == CAD` remains class 1. `Cath/LAD/LCX/RCA` never enter predictors. Cath versus any-stenotic disagreement rows: [93]; these are flagged, never relabeled. `data_audit.json` and `feature_audit.csv` contain the full schema and findings.

There is no patient identifier or timing metadata in the supplied CSV. The specification includes ECG/echo/laboratory predictors but cannot establish that each measurement precedes the intended decision. Repeated-patient independence and prediction-time availability therefore remain unverified. An explicit/recognized patient-ID column activates stratified grouped splits at every level; exact duplicate predictors are also grouped. No legitimate predictor was removed for correlation. BMI/weight/height/obesity, Lymph/Neut and rare categories warrant stability review. Imputation, scaling, categorical vocabularies and all calibrators fit within training partitions. No resampling or learned feature selection is performed. A legacy XGBoost class-weight ratio was computed from the whole development partition; the new CatBoost path computes automatic weights only in its fitting partition.

## Protocol and controlled experiments

Development/historical-holdout sizes are 242/61 (split seed 42). The supplied ungrouped 303-row dataset retains the original 242/61 allocation; grouped datasets can require a different allocation. Outer seeds: [42, 43, 44, 45, 46, 47, 48, 49, 50, 51]; 5 outer folds, 3 inner folds. Folds, raw row indices and sub-calibration partitions are recorded. The 61-row historical holdout has already been viewed in project development; its secondary result is not pristine external validation.

Primary objective: unweighted log loss for probability estimation. Six small, prespecified candidate configurations isolate stopping, removal of class weighting, lower depth, increased L2, and slower learning; the last is an explicit combined leaf/sampling intervention. Full parameters: `config.json`. CatBoost supports L2, depth, sampling and Depthwise minimum leaf sample constraints; its SymmetricTree policy does not honor that leaf constraint. No unsupported L1/minimum split-gain parameter is invented. The combined arm uses Depthwise, minimum leaf samples 15, Bernoulli row sampling .8 and feature sampling .8.

Inner-only early stopping uses patience 40, maximum 400, and `Logloss:use_weights=false`; categorical counters exclude validation data (`SkipTest`). Fixed counts [60, 80, 100, 120, 150] and each candidate's median inner best iteration are compared by mean inner loss. Every candidate count is evaluated with an independent fixed-count fit: CatBoost prefixes of longer fits need not reproduce a model trained for that exact count. An explicit check verifies selected-count OOF predictions against independent refits. Final refits use the chosen count with no outer eval_set. All stage metrics, including F2, are saved; full-path diagnostic plots deliberately show later overfitting after the selected count. A minimum on one plotted fold is not the selection rule.

Calibration compares raw, Platt sigmoid (smoothed targets on raw log odds, monotone nonnegative slope), and isotonic. For each inner validation fold, a further 3-fold training-only OOF fit supplies calibrator training data. Inner validation labels never enter those base/calibrator fits. Calibration method is chosen by mean inner log loss, then fitted to development-side OOF predictions. Hyperparameters were already inner-selected, so inner calibration scores are selection diagnostics; outer results estimate the whole procedure. Isotonic is evaluated as a small-sample diagnostic and may overfit. All calibration transforms clip probabilities to [1e-06, 0.999999].

The final threshold policy stays at .5 absent a justified clinical utility/constraint. Exploratory F2 and sensitivity/specificity operating points use cross-calibrated inner OOF labels exclusively. They do not select on outer-test labels. Balanced weights are a candidate choice, not an assumption that CAD is the minority class (it is the majority).

## Outer-fold comparison (mean ± sample SD)

Columns labeled training describe resubstitution on the outer training rows. Every other performance column describes outer-test evaluation. The `raw/sigmoid/isotonic` arms share the inner-selected base model; `selected` additionally selects calibration within training. Rows are not models selected by outer performance. `prevalence` uses each outer training partition's prevalence and predicts everybody positive at .5.

| variant | iterations | training_log_loss | log_loss | roc_auc | average_precision | sensitivity | specificity | precision | f1 | f2 | accuracy | brier | calibration_slope | calibration_intercept | ece_quantile_5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 400.0000 ± 0.0000 | 0.0169 ± 0.0023 | 0.3392 ± 0.0976 | 0.9273 ± 0.0304 | 0.9702 ± 0.0138 | 0.9010 ± 0.0469 | 0.7880 ± 0.0970 | 0.9157 ± 0.0348 | 0.9074 ± 0.0302 | 0.9033 ± 0.0388 | 0.8690 ± 0.0414 | 0.1020 ± 0.0296 | 0.7607 ± 0.2812 | 0.2308 ± 0.4751 | 0.0727 ± 0.0276 |
| raw | 196.7400 ± 60.4931 | 0.1113 ± 0.0323 | 0.3153 ± 0.0571 | 0.9282 ± 0.0327 | 0.9707 ± 0.0147 | 0.9212 ± 0.0525 | 0.7245 ± 0.1085 | 0.8953 ± 0.0374 | 0.9068 ± 0.0312 | 0.9151 ± 0.0426 | 0.8653 ± 0.0431 | 0.0980 ± 0.0220 | 1.6588 ± 2.3947 | -0.2737 ± 0.7689 | 0.0761 ± 0.0262 |
| sigmoid | 196.7400 ± 60.4931 | 0.1078 ± 0.0272 | 0.3117 ± 0.0559 | 0.9282 ± 0.0327 | 0.9707 ± 0.0147 | 0.9189 ± 0.0437 | 0.7463 ± 0.0986 | 0.9021 ± 0.0347 | 0.9096 ± 0.0288 | 0.9150 ± 0.0361 | 0.8698 ± 0.0405 | 0.0961 ± 0.0218 | 1.6348 ± 2.4086 | -0.1138 ± 0.5594 | 0.0717 ± 0.0248 |
| isotonic | 196.7400 ± 60.4931 | 0.0913 ± 0.0300 | 0.3922 ± 0.1613 | 0.9213 ± 0.0354 | 0.9577 ± 0.0212 | 0.9073 ± 0.0557 | 0.7620 ± 0.1098 | 0.9070 ± 0.0396 | 0.9059 ± 0.0356 | 0.9064 ± 0.0462 | 0.8661 ± 0.0475 | 0.0990 ± 0.0251 | 0.9013 ± 0.6989 | 0.0958 ± 0.4636 | 0.0690 ± 0.0292 |
| selected | 196.7400 ± 60.4931 | 0.1094 ± 0.0296 | 0.3137 ± 0.0573 | 0.9280 ± 0.0328 | 0.9704 ± 0.0149 | 0.9201 ± 0.0513 | 0.7316 ± 0.1021 | 0.8974 ± 0.0354 | 0.9074 ± 0.0310 | 0.9147 ± 0.0420 | 0.8665 ± 0.0425 | 0.0973 ± 0.0222 | 1.6281 ± 2.3729 | -0.2225 ± 0.7255 | 0.0736 ± 0.0249 |
| prevalence | 0.0000 ± 0.0000 | 0.5977 ± 0.0017 | 0.5978 ± 0.0070 | 0.5000 ± 0.0000 | 0.7149 ± 0.0077 | 1.0000 ± 0.0000 | 0.0000 ± 0.0000 | 0.7149 ± 0.0077 | 0.8337 ± 0.0052 | 0.9261 ± 0.0026 | 0.7149 ± 0.0077 | 0.2039 ± 0.0033 | undefined | undefined | 0.0071 ± 0.0064 |

Selected-pipeline log loss improved in **32/50 outer folds**. This count is descriptive, not a significance test; folds/repeats share patients and training data. `repeat_metrics.csv` reports each seed's full OOF performance. `selection_frequency.csv` records configuration/stopping/calibration variability. `inner_search.csv`, `inner_calibration.csv` and `early_stopping.csv` are explicitly separate inner diagnostics.

## Paired uncertainty

| metric | baseline | selected | difference | difference_95%_CI |
| --- | --- | --- | --- | --- |
| log_loss | 0.3390 | 0.3136 | -0.0254 | [-0.0639, 0.0123] |
| roc_auc | 0.9253 | 0.9240 | -0.0012 | [-0.0071, 0.004] |
| average_precision | 0.9688 | 0.9676 | -0.0012 | [-0.0054, 0.0019] |
| sensitivity | 0.9012 | 0.9202 | 0.0191 | [0.0075, 0.0318] |
| specificity | 0.7884 | 0.7319 | -0.0565 | [-0.0966, -0.0282] |
| precision | 0.9145 | 0.8960 | -0.0185 | [-0.0337, -0.0073] |
| f1 | 0.9077 | 0.9079 | 0.0002 | [-0.0097, 0.0095] |
| f2 | 0.9038 | 0.9152 | 0.0115 | [0.0013, 0.0225] |
| accuracy | 0.8690 | 0.8665 | -0.0025 | [-0.0174, 0.0107] |
| brier | 0.1020 | 0.0973 | -0.0046 | [-0.0134, 0.0039] |

Intervals use 1000 paired cluster-bootstrap draws, resampling each patient/group with all repeat predictions together. Estimates here are mean complete-OOF-repeat metrics, which differ slightly from mean per-fold metrics above. Intervals are conditional on fitted models/splits and this cohort; they do not capture refitting uncertainty, historical analyst choices, or external-site shift. Fold SD is not a confidence interval. Calibration intercept/slope are noisy diagnostics without a reported interval; a constant predictor or complete separation gives an undefined slope rather than an invented number.

## Calibration and probability quality

Calibration diagnostics below are averaged over complete OOF repeats (one prediction per patient per repeat), which are more stable than regressions on individual approximately 49-row folds. The main comparison also preserves fold-level calibration values for audit; large fold-level slopes should not be mistaken for precise estimates.

| variant | calibration_intercept_mean | calibration_slope_mean | calibration_in_large_mean | ece_quantile_5_mean | ece_uniform_10_mean |
| --- | --- | --- | --- | --- | --- |
| baseline | 0.2622 | 0.6652 | 0.2325 | 0.0475 | 0.0697 |
| isotonic | 0.1865 | 0.6124 | 0.0519 | 0.0242 | 0.0484 |
| prevalence | 4.6756 | -4.0862 | -0.0000 | 0.0071 | 0.0000 |
| raw | -0.1097 | 1.1168 | -0.0496 | 0.0246 | 0.0468 |
| selected | -0.0846 | 1.1126 | -0.0329 | 0.0251 | 0.0458 |
| sigmoid | -0.0096 | 1.1155 | 0.0363 | 0.0201 | 0.0449 |

`cv_summary.csv` and `repeat_metrics.csv` include joint logistic calibration intercept (ideal 0), slope (ideal 1), calibration-in-the-large with slope fixed at 1, ECE with 5 quantile bins and 10 equal-width bins, log loss and Brier. Calibration regression is evaluation-only and is never used to alter outer predictions. ECE depends strongly on binning/sample size; ties can reduce quantile bin count. Brier mixes calibration and discrimination and does not prove calibration by itself. Compare against the prevalence probability baseline, not zero. `plots/calibration.png` shows seed 42 once per patient; it does not pool dependent repetitions as extra patients.

Complete and quasi-complete separation (including isotonic boundary ties) have no finite unpenalized slope and are reported as undefined. The prevalence predictor is constant within each fitted fold; tiny training-prevalence differences across folds can produce unstable pooled regression slopes and should not be interpreted as evidence of poor probability quality. Its log loss/Brier and calibration-in-the-large are the useful comparisons here. Isotonic's binned ECE must also be read alongside its log loss, which exposes confidently wrong predictions.

## Sensitivity, specificity and false-positive burden

| policy | sensitivity_mean | specificity_mean | precision_mean | f2_mean | false_positives_per_100_mean |
| --- | --- | --- | --- | --- | --- |
| f2_max | 0.9727 | 0.3674 | 0.7982 | 0.9306 | 18.0476 |
| fixed_0.3 | 0.9559 | 0.5173 | 0.8343 | 0.9283 | 13.7500 |
| fixed_0.4 | 0.9427 | 0.6505 | 0.8729 | 0.9273 | 9.9524 |
| fixed_0.5 | 0.9201 | 0.7316 | 0.8974 | 0.9147 | 7.6412 |
| fixed_0.6 | 0.8964 | 0.7952 | 0.9185 | 0.8998 | 5.8248 |
| fixed_0.7 | 0.8535 | 0.8541 | 0.9381 | 0.8682 | 4.1344 |
| sensitivity_0.9 | 0.9085 | 0.7749 | 0.9113 | 0.9085 | 6.4073 |
| sensitivity_0.95 | 0.9525 | 0.5784 | 0.8528 | 0.9300 | 12.0196 |
| specificity_0.8 | 0.8871 | 0.8224 | 0.9283 | 0.8942 | 5.0425 |
| specificity_0.9 | 0.7815 | 0.9167 | 0.9612 | 0.8108 | 2.3614 |

Rows show **outer** mean results using thresholds fixed or selected exclusively inside training. Sensitivity/specificity labels denote exploratory training targets and are not guaranteed on outer patients. F2 can be high for an all-positive classifier in this high-prevalence cohort; inspect the prevalence row, specificity, precision, and false positives per 100 patients before interpreting recall-weighted scores. No operating point is clinically justified merely by these internal results.

## Historical holdout (secondary, previously inspected)

| variant | log_loss | roc_auc | average_precision | sensitivity | specificity | precision | f1 | f2 | accuracy | brier | calibration_slope | calibration_intercept | ece_quantile_5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | 0.4350 | 0.8928 | 0.9501 | 0.9302 | 0.6667 | 0.8696 | 0.8989 | 0.9174 | 0.8525 | 0.1150 | 0.5786 | -0.2301 | 0.0517 |
| isotonic | 0.5676 | 0.8766 | 0.9217 | 0.9767 | 0.5556 | 0.8400 | 0.9032 | 0.9459 | 0.8525 | 0.1210 | 0.3312 | -0.1010 | 0.0661 |
| prevalence | 0.6069 | 0.5000 | 0.7049 | 1.0000 | 0.0000 | 0.7049 | 0.8269 | 0.9227 | 0.7049 | 0.2081 | NA | NA | 0.0100 |
| raw | 0.3708 | 0.8953 | 0.9541 | 0.9302 | 0.6667 | 0.8696 | 0.8989 | 0.9174 | 0.8525 | 0.1152 | 0.9193 | -0.0545 | 0.0220 |
| selected | 0.3782 | 0.8953 | 0.9541 | 0.9535 | 0.6667 | 0.8723 | 0.9111 | 0.9361 | 0.8689 | 0.1175 | 0.9647 | -0.3629 | 0.0471 |
| sigmoid | 0.3782 | 0.8953 | 0.9541 | 0.9535 | 0.6667 | 0.8723 | 0.9111 | 0.9361 | 0.8689 | 0.1175 | 0.9647 | -0.3629 | 0.0471 |

These scores are computed only after freezing final hyperparameters/calibration/threshold, but this cohort was already inspected historically. They must not be used for another selection round or claimed as new independent validation.

## Feature and robustness diagnostics

Selected full-repeat log loss ranges **0.2962–0.3352** and ROC-AUC **0.9117–0.9330** across seeds. Mean per-patient probability SD across repeats is **0.0574**; **27** development rows are misclassified in at least 80% of repeats. These are diagnostics of consistently difficult cases, not grounds for removing them.

| variant | subgroup | n | prevalence | roc_auc | log_loss | sensitivity | specificity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | age_60_plus | 107.0000 | 0.8785 | 0.8847 | 0.2859 | 0.9319 | 0.5231 |
| baseline | age_under_60 | 135.0000 | 0.5852 | 0.9196 | 0.3811 | 0.8646 | 0.8500 |
| baseline | sex_female | 102.0000 | 0.6863 | 0.9611 | 0.2404 | 0.9400 | 0.8438 |
| baseline | sex_male | 140.0000 | 0.7357 | 0.8962 | 0.4109 | 0.8748 | 0.7405 |
| selected | age_60_plus | 107.0000 | 0.8785 | 0.8745 | 0.2583 | 0.9543 | 0.4154 |
| selected | age_under_60 | 135.0000 | 0.5852 | 0.9203 | 0.3575 | 0.8797 | 0.8054 |
| selected | sex_female | 102.0000 | 0.6863 | 0.9579 | 0.2600 | 0.9557 | 0.7719 |
| selected | sex_male | 140.0000 | 0.7357 | 0.8962 | 0.3527 | 0.8961 | 0.6973 |

Age and sex groups differ in prevalence and sample size. In particular, high-prevalence groups have few negative cases, so specificity is uncertain. Examine deterioration as well as improvement; aggregate probability gains do not establish benefit in every subgroup.

Top feature diagnostics (increase in outer log loss; fold SD, not a confidence interval):

| feature | mean | std | positive_fold_fraction |
| --- | --- | --- | --- |
| Typical Chest Pain | 0.2136 | 0.0726 | 1.0000 |
| EF-TTE | 0.0384 | 0.0227 | 0.9800 |
| Age | 0.0319 | 0.0238 | 0.9400 |
| Region RWMA | 0.0311 | 0.0214 | 1.0000 |
| TG | 0.0164 | 0.0156 | 0.8600 |
| ESR | 0.0115 | 0.0117 | 0.8000 |
| FBS | 0.0083 | 0.0218 | 0.7800 |
| Tinversion | 0.0060 | 0.0073 | 0.8600 |
| BP | 0.0057 | 0.0142 | 0.8400 |
| HTN | 0.0052 | 0.0109 | 0.8400 |

`patient_loss_contributions.csv` attributes the paired mean log-loss difference to individual rows without excluding any. The previously flagged Cath/vessel-disagreement rows account for **25.3% of the net loss reduction** in this run (a descriptive ratio, unstable when the net change is small). This strengthens the need to review original diagnostic provenance; it is not permission to relabel those records. All primary results retain every recorded target unchanged.

Outer-test permutation importance measures increase in log loss and is used only for explanation, after all choices. `feature_importance_summary.csv` aggregates permutation repetitions within folds before reporting fold spread and positive-effect frequency; correlated predictors can mask each other's importance. No feature was removed based on this analysis. `subgroup_metrics.csv` covers sex and age (<60/≥60), with sample sizes and class counts. These small, repeated subgroups are descriptive; they neither establish fairness nor justify subgroup retuning. `patient_stability.csv` records variability/error frequency across seeds. No patient was excluded for harming a score.

## Interpretation and limitations

The 400-iteration model has much greater fitting capacity than the approximately 193-row outer training folds can reliably support. Continued loss reduction on training data while validation loss rises is consistent with excess probability confidence even when ranking metrics plateau. Fixed 400 iterations, no stopping, model selection by ranking alone, and class-weighted fitting all merit examination; none of these observations alone proves causal responsibility. The controlled comparisons quantify the net effects. Better log loss alone cannot offset clinically important sensitivity/specificity deterioration; use the full table and paired intervals, and do not claim universal improvement.

This is internal validation in a small, high-prevalence, single-source dataset. No clinical validation, prospective utility, general-population prevalence, or temporal/site transportability is established. Missing patient IDs/timestamps and the discordant target record require provenance review. The experimental CAD candidate has not replaced the serving CAD or vessel models.

## Reproduction and artifacts

From repository root (existing pinned dependencies):

```bash
MPLCONFIGDIR=/tmp/cardisoft-mpl-cache OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 training/train.py --protocol nested --config training/configs/cad_nested.json
MPLCONFIGDIR=/tmp/cardisoft-mpl-cache python3 training/experiment_report.py --run training/experiments/cad_nested_verified_20261010
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

Learning curves describe the underlying booster before post-fit calibration; a calibrator has no boosting epochs. `selected_fixed_count/model.png` shows an actual fit for the chosen count, whose probabilities are checked against the recorded inner OOF predictions. `selected/model.png` is a separate full-400 diagnostic path and its prefixes must not be treated as that fixed-count fit. Native CatBoost history files retain the metric names/weighting used by CatBoost, while the seven-panel exported curves use unweighted sklearn metrics. `analysis_source/` records the report/metric implementation actually used to generate this report if postprocessing was updated after training began.

## Method references

- [scikit-learn 1.7 nested CV](https://scikit-learn.org/1.7/auto_examples/model_selection/plot_nested_cross_validation_iris.html): separating selection from generalization estimation.
- [CatBoost tuning parameters](https://catboost.ai/docs/en/concepts/parameter-tuning) and [fit](https://catboost.ai/docs/en/concepts/python-reference_catboostclassifier_fit): stopping and supported tree constraints.
- [scikit-learn 1.7 calibration](https://scikit-learn.org/1.7/modules/calibration.html): independent calibration data, isotonic small-sample risk, and limitations of Brier as a calibration diagnostic.

AP is `sklearn.metrics.average_precision_score`, a recall-increment-weighted average of precision, **not trapezoidal area under a PR interpolation**. ROC-AUC uses `roc_auc_score`; precision/recall/F1/F2 use binary positive class 1 and `>= threshold` (zero division -> 0). F2 = 5TP/(5TP + FP + 4FN). Accuracy = (TP+TN)/N; specificity = TN/(TN+FP); log loss and Brier are unweighted sklearn binary losses. Confusion rows are actual [0,1], columns predicted [0,1].

## Executed verification

All 25 training tests passed. The strict MkDocs build passed. Independent artifact verification passed for all 50 outer folds and 14,520 prediction rows: split/calibration isolation, metric reconstruction, exact baseline CV reproduction, saved threshold/tree count, input-order invariance, and pipeline-versus-saved-prediction equality. Dataset and serving CAD artifacts are unchanged. See `execution_checks.json`, `verification.json`, and the runnable `verify_saved_results.py`. Actual chosen-count learning curves were independently reconstructed and matched their recorded inner OOF probabilities to 1e-12.
