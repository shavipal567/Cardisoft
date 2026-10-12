# CAD nested validation

Use this protocol to investigate the CAD model's generalization and probability
quality. It extends the existing training code and native preprocessor. It does
not alter the `Cath == CAD` target, the 54-field raw input schema, or serving
models. Candidate feature engineering is optional and fixed before each run.

## Repository audit

The saved CAD model is CatBoost 1.2.10, wrapped by `CatBoostNative`. Resolved
parameters: 400 iterations, depth 4, learning rate .05, L2=3, balanced class
weights, Plain boosting, symmetric trees, MVS bootstrap, seed 42. There is no
early stopping; the label threshold is .5. The legacy 32-configuration search
selects mean ROC-AUC, breaking ties with F1. Only voting candidates optimize
F2 internally; the saved CAD model does not.

The baseline snapshot reproduced saved probabilities exactly. Training log
loss is .0190, versus .4350 on the historical 61-row holdout. Training AUC is
1.0, versus .8928 on that holdout. These results and the supplied curves are
consistent with excessive fitting capacity and increasing probability
confidence after useful ranking gains have plateaued.

There are 303 rows and 54 predictors after dropping diagnosis columns
`Cath/LAD/LCX/RCA` and constant `Exertional CP`. CAD prevalence is 216/303
(71.3%). No exact duplicate rows or exact binary target proxies were found.
CSV row index 93 says `Cath=Normal` and `LAD=Stenotic`; its original label is
retained and flagged. Numeric redundancy and rare categories are recorded.

The specification includes symptoms, ECG, labs and echo measurements. It has
no acquisition timestamps or patient identifier file, so pre-decision
availability and independence of repeated patients cannot be verified. These
are unresolved provenance questions, not reasons to discard correlated but
potentially legitimate clinical predictors. The complete feature list is in
`preprocessing.py`, every run's `data_audit.json`, and the saved feature schema.

The old learning curves label their validation data "outer CV". Those folds
also selected the winning configuration, so the reported winning CV score is
subject to selection optimism. New nested curves explicitly use inner folds.
Historical knowledge of this cohort still limits claims: nesting cannot erase
earlier analyst decisions informed by these data.

## Reproduce training

Historical configurations without `feature_set` retain original inputs. To use
engineered CAD inputs, add `--feature-set logs` (or `--feature-set auto`) to the
command below. The candidate uses that fixed feature set in every inner/outer
fit; the baseline always keeps original inputs. Schemas, metadata and learning
curves record the choice. This option does not select among feature sets inside
inner CV, so prior exploratory feature choices remain a source of optimism.

From repository root, using the existing installed/pinned dependencies:

```bash
MPLCONFIGDIR=/tmp/cardisoft-mpl-cache OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 training/train.py --protocol nested --config training/configs/cad_nested.json
```

The default configuration retains the original stratified 80/20 split, seed
42, outer seeds 42–51, and five outer folds. Three inner folds select each
outer model. Output is a unique `training/experiments/cad_nested_<UTC>/`.
Pass `--output <new-directory>` to name it. Existing experiment directories
cannot be silently overwritten.

For a dataset containing a verified patient identifier:

```bash
python3 training/train.py --protocol nested --dataset <csv> --group-column patient_id
```

Patient groups and exact duplicate predictors stay together through holdout,
outer, inner and calibration subfold splits. A recognized `patient_id` or
`subject_id` column is detected automatically; ambiguous identifiers require
an explicit column. Group-aware holdout allocation can differ from the legacy
split to prevent overlap. An ordinary row index is not evidence of patient
independence. No ID column enters the model feature allow-list.

## Selection, stopping and regularization

Probability estimation is the prespecified objective, scored with unweighted
log loss. `configs/cad_nested.json` defines six configurations: stopping only,
unweighted fitting, shallower trees, higher L2, slower learning, and a combined
minimum-leaf/row-sampling/feature-sampling intervention. Candidate counts are
60, 80, 100, 120 and 150, plus each configuration's median inner stopping count.
They are starting points rather than assumed optimal values.

Each inner fit uses a 400-iteration cap and patience 40. Weighted fits use
`Logloss:use_weights=false`; unweighted fits use equivalent `Logloss` (CatBoost
rejects the weight flag when no weights exist). Every candidate count receives
a separate fixed-count fit. A prefix of a longer CatBoost model can differ from
a model fitted for exactly that many iterations; prefixes are therefore used
only for descriptive learning curves. A regression check compares selection
OOF probabilities with independent exact-count refits. The selected
count minimizes mean inner log loss. Outer/final refits use that fixed count
without an outer evaluation set. Category counters use `SkipTest`, and learned
preprocessing is fitted only to the relevant training rows.

CatBoost's minimum leaf constraint is applied with **Depthwise**, because it
does not constrain SymmetricTree in the same way. Supported L2, depth and
sampling parameters are evaluated; unsupported L1/minimum split-gain options
are not invented. The combined configuration is documented as a bundle, so
its result does not isolate an individual parameter's causal effect.
[CatBoost parameter documentation](https://catboost.ai/docs/en/concepts/parameter-tuning).

## Calibration and operating points

For each inner validation fold, another training-side CV produces out-of-fold
base predictions for fitting Platt sigmoid and isotonic calibrators. Neither
base fitting nor calibration fitting uses that inner validation fold's rows.
Raw/sigmoid/isotonic are then compared on the inner validation fold. Model
hyperparameters were already inner-selected, so these inner scores are used
only for selection; independent outer predictions evaluate the entire method.

The final calibrator fits training-side OOF probabilities. Platt uses smoothed
binary targets on raw log odds with a monotone sigmoid; isotonic is an explicit
small-sample comparison. Raw, sigmoid and isotonic predictions are compared on
identical outer patients. Calibration choice never uses outer scores.
[scikit-learn calibration documentation](https://scikit-learn.org/1.7/modules/calibration.html).

The default decision threshold remains .5. Exploratory alternatives maximize
F2, target sensitivity .90/.95, target specificity .80/.90, or use fixed
thresholds .30–.70. All learned thresholds use training-side cross-calibrated
OOF predictions; the targets are empirical training constraints and may fail
on outer patients. No clinical operating requirement is specified in the
repository. An explicit `threshold_policy` in configuration can select a
declared operating point before a run.

F2 is not sufficient on its own: an all-positive decision can score highly
at this prevalence while having zero specificity. Reports include precision,
sensitivity, specificity, confusion counts, and false positives per 100
patients for every operating point.

## Metrics and uncertainty

Reports save ROC-AUC, average precision, accuracy, precision, sensitivity,
specificity, F1, F2, log loss, Brier and confusion counts. Average precision is
the sklearn recall-weighted precision average, not trapezoidal PR integration.
The appropriate no-skill AP reference is the evaluated positive prevalence.
The prevalence probability baseline is estimated on each training partition.

Calibration metrics include the joint logistic intercept and slope, a
calibration-in-the-large intercept with slope fixed at one, and ECE using
five quantile bins and ten equal-width bins. Constant scores or complete
separation yield undefined slope values. Small-sample estimates are unstable;
ECE depends on bins/ties, and low Brier alone does not establish calibration.

Fold means and sample SD describe variability. Confidence intervals resample
patient/group clusters with **all repeats kept together**, preserving pairing
between baseline and candidate. Their estimand is mean complete-OOF-repeat
performance, which can differ from mean fold performance. These percentile
intervals condition on fitted models/splits; they omit training-refit and
external-site uncertainty. Repeated CV does not multiply the patient count.

Permutation importance is computed only after outer model selection and is
never fed back into feature selection. Correlation can mask feature effects.
Age/sex subgroup diagnostics and per-patient prediction variability are
descriptive on small samples; no subgroup retuning or patient removal follows.

## Artifacts and evaluation

Each run contains:

| Path | Contents |
|---|---|
| `baseline_snapshot/`, `source/`, `provenance.json` | Baseline, source and data/environment fingerprints |
| `config.json`, `partitions.json`, `outer_splits.json` | Configuration and explicit split rows |
| `data_audit.json`, `feature_audit.csv` | Target, feature and leakage findings |
| `folds/seed_<seed>_fold_<fold>/` | Inner search, early stopping, native training histories, calibration subfolds and predictions |
| `outer_predictions.csv`, `outer_fold_metrics.csv` | Independent outer predictions and complete metrics |
| `comparison.csv`, `cv_summary.csv`, `repeat_metrics.csv` | Baseline/candidate comparisons and fold/seed variability |
| `bootstrap_ci.json` | Conditional patient/group intervals and paired differences |
| `outer_threshold_metrics.csv`, `threshold_summary.csv` | Operating points and false-positive burden |
| `feature_importance_summary.csv`, `subgroup_metrics.csv`, `patient_stability.csv` | Feature/subgroup/seed diagnostics |
| `final_selection/` | Final choices made only within the development partition |
| `model/cad/` | Model, preprocessor, complete pipeline, schema, threshold and transformed/raw backgrounds |
| `plots/` | ROC/PR, calibration, count/normalized confusion matrices, fold/seed and threshold plots |
| `historical_holdout_*`, `plots/historical_holdout/` | Secondary evaluation on the previously inspected 61-row split |
| `report.md` | Generated full audit, methods, results and limitations |

The first outer training partition and final development selection also save
`learning_curves/{baseline,selected}/model.png`, `metrics.csv` and metadata.
These show every fitted iteration's **training and inner-validation** log loss,
AUC, AP, accuracy, F1, F2 and Brier. Full diagnostic paths continue to 400
iterations to reveal later divergence; the selected model uses its separately
recorded stopping count. Confusion matrices use actual [0,1] rows and predicted
[0,1] columns; repeat plots never imply repeats are different patients.
These learning curves describe the booster before calibration. Native CatBoost
history files preserve their native metric names and weighting; the exported
seven-panel curves use unweighted sklearn metrics. `calibration_summary.csv`
aggregates calibration regressions over full OOF repeats, avoiding reliance on
unstable single-fold slopes. Report generation records its code separately in
`analysis_source/` and `analysis_provenance.json`.

```bash
MPLCONFIGDIR=/tmp/cardisoft-mpl-cache python3 training/experiment_report.py --run training/experiments/<run>
MPLCONFIGDIR=/tmp/cardisoft-mpl-cache OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 -m unittest discover -s training/tests -v
```

The first command regenerates evaluation tables and plots from saved
predictions, without fitting or tuning. Load the complete pipeline with
`PYTHONPATH=training`; it accepts a raw DataFrame with the existing named
features, applies training-identical cleaning/order/transforms, then outputs
`[P(0), P(1)]`. Missing columns raise a schema error. The separate preprocessor
and model retain the transform/predict contract. New exports include
`shap_raw_background.joblib` for engineered explanations. This CAD-only
experiment is not a complete `ARTIFACTS_DIR` serving bundle: its metadata and
reporting schema also differ from the legacy four-target dashboard schema.

High internal performance does not establish clinical validation. The
historical holdout has been viewed previously; results cannot be treated as
new external validation or used for further threshold/parameter selection.

## Completed comparison (2026-10-11)

The verified run is `training/experiments/cad_nested_verified_20261010/`. Both
its baseline and candidate use original inputs. These results predate
engineered-feature integration and do not measure its benefit.
It completed all 50 outer folds (10 seeds × 5 folds) on the original 242-row
development partition. The fixed baseline reproduces the historical CAD CV
AUC, F1, AP and Brier scores exactly. Means and sample SD below describe
outer folds; the training-loss row describes outer-training resubstitution.

| Metric | Fixed 400-iteration baseline | Nested candidate procedure |
|---|---:|---:|
| Training log loss | 0.0169 ± 0.0023 | 0.1094 ± 0.0296 |
| Outer log loss | 0.3392 ± 0.0976 | 0.3137 ± 0.0573 |
| ROC-AUC | 0.9273 ± 0.0304 | 0.9280 ± 0.0328 |
| Average precision | 0.9702 ± 0.0138 | 0.9704 ± 0.0149 |
| Accuracy | 0.8690 ± 0.0414 | 0.8665 ± 0.0425 |
| Precision | 0.9157 ± 0.0348 | 0.8974 ± 0.0354 |
| Sensitivity | 0.9010 ± 0.0469 | 0.9201 ± 0.0513 |
| Specificity | 0.7880 ± 0.0970 | 0.7316 ± 0.1021 |
| F1 | 0.9074 ± 0.0302 | 0.9074 ± 0.0310 |
| F2 | 0.9033 ± 0.0388 | 0.9147 ± 0.0420 |
| Brier | 0.1020 ± 0.0296 | 0.0973 ± 0.0222 |

Log loss improved in 32/50 folds, and the mean validation–training loss gap
fell from .3223 to .2044. However, the paired patient-bootstrap 95% interval
for the mean complete-OOF-repeat log-loss change is **[−.0639, +.0123]**.
It includes zero; improved generalization is not established. Sensitivity
increases while specificity and precision decrease. The serving models remain
unchanged. The earlier `cad_nested_20261010T213312Z` pilot is explicitly
superseded because it used longer-fit prefixes for count comparisons.

Final development-only selection chose **150 iterations**, depth 4, learning
rate .05, L2=3 and balanced weights, followed by **Platt sigmoid calibration**.
The threshold is **.5**. Inner raw log loss was .3114; inner sigmoid loss
was .3081. Actual fits at 60/80/100/120/150 and inner stopping proposals
were compared; the outer results did not choose this configuration.

Across complete OOF repeats, calibration slope changes from .6652 to 1.1126
and five-bin ECE from .0475 to .0251. These are noisy diagnostics, not proof
of clinical calibration. Isotonic has worse mean outer log loss (.3922).
The prevalence probability baseline has mean log loss .5978 and Brier .2039.

Exploratory F2-maximizing thresholds yield sensitivity .9727 but specificity
.3674 and about **18.05 false positives per 100 patients**, compared with
7.64 at the candidate’s default .5 threshold. The all-positive classifier
already has F2 .9261 at this prevalence. F2 therefore cannot be interpreted
without the false-positive burden.

The previously inspected 61-row holdout gives candidate log loss .3782
(baseline .4350), AUC .8953 (.8928), and confusion counts **TN=12, FP=6,
FN=2, TP=41**. Holdout Brier worsens to .1175 from .1150. This is secondary
evidence and was not used to choose calibration or thresholds.

Robustness is mixed: full-repeat candidate AUC ranges .9117–.9330. Female
patients’ mean OOF log loss worsens (.2404→.2600), while the male subgroup
improves (.4109→.3527). In patients aged 60+, specificity decreases
.5231→.4154, based on only 13 negative patients. These exploratory subgroup
estimates do not establish fairness or justify subgroup retuning.

Typical Chest Pain, EF-TTE, Age and Region RWMA have the largest permutation
effects. Their measurement timing deserves provenance review, not automatic
removal. The Cath/vessel-conflicting row 93 accounts for approximately **25.3%
of the net log-loss reduction** and is misclassified in every repeat; it is
retained unchanged in every primary result.

The run’s `report.md`, `comparison.csv`, `bootstrap_ci.json`,
`subgroup_summary.csv`, `patient_loss_contributions.csv` and `verification.json`
contain the full results and checks. `final_selection/learning_curves/selected_fixed_count/model.png` shows the actual chosen-count booster’s F2
and other learning curves; `plots/confusion_matrices.png` and
`plots/historical_holdout/confusion_matrices.png` provide confusion plots.
