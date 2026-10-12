# Evaluation

`training/evaluate.py` evaluates frozen artifacts on each target's 61-row
stratified test split (seed 42) and writes `training/artifacts/metrics.json`.
Model selection uses 10 repeats of 5-fold CV on the separate 242-row training set.
The checked-in metrics describe baseline models. Engineered features are now
supported in training, but no replacement serving scores are claimed.

| Evidence | Data and purpose | Feature status |
|---|---|---|
| Saved serving metrics | Historical 61-row holdout per target | Baseline artifacts |
| Feature comparison | Three repeats of five-fold development CV | Six fixed sets; exploratory choice |
| Nested CAD experiment | Inner selection, paired outer evaluation | One fixed candidate set per run; baseline comparator |

New CAD experiments use [nested validation](cad-nested-validation.md), invoked
with `python training/train.py --protocol nested`. The historical CV winner
was selected and reported on the same folds; those scores are not an unbiased
estimate of the complete search. The new experiment compares a fixed legacy
baseline and an inner-selected pipeline on matched outer folds. It stores
its own predictions, comprehensive metrics, confidence intervals and plots in
`training/experiments/`, without changing the serving results below.

## Probability and threshold contract

Every saved binary classifier, including `VotingClassifier`, returns
`predict_proba(X)` with shape `(n_samples, 2)` in class order `[0, 1]`.
Evaluation reads column 1 for ROC-AUC and thresholds it for binary metrics.
The threshold comes from the target's `metadata.json`, defaulting to 0.5;
a voting winner saves the threshold tuned during its final training refit.
All currently saved winners use 0.5.

During outer CV, voting F1 uses the threshold tuned within that outer training
fold. Other candidates use 0.5. ROC-AUC, PR-AUC and Brier depend on probabilities,
not the chosen threshold. Tuning voting weights and thresholds for F2 does
not change the overall selection rule: mean CV ROC-AUC, with mean F1 as a tie-break.

## Held-out test results (v2)

| Target | Accuracy | Precision | Recall | F1 | ROC-AUC | TN/FP/FN/TP |
|---|---:|---:|---:|---:|---:|---|
| CAD | .852 | .870 | .930 | .899 | .893 | 12/6/3/40 |
| LAD | .787 | .795 | .861 | .827 | .843 | 17/8/5/31 |
| LCX | .672 | .611 | .458 | .524 | .711 | 30/7/13/11 |
| RCA | .672 | .600 | .391 | .474 | .748 | 32/6/14/9 |

CV ROC-AUC is .9273/.8428/.7400/.7067 respectively.
The API's `/model-info` endpoint reads the actual saved metadata and metrics.
Frontend baselines use test prevalence so they refer to the same cohort.

## Engineered feature comparison

`dataset/engineered-feature-analysis.ipynb` compares six feature sets using the
saved winners' **configurations**, fitting fresh models in every fold. Each
target uses its own seed-42 80/20 split; only the 242 development rows enter
three repeats of five-fold CV (seeds 42, 43 and 44). Across four targets and six
sets this produces 360 fits and 17,424 out-of-fold probability rows. Models are
not retuned and the reserved 61 rows are not scored by this experiment.

Accuracy below was calculated afterward from the exported OOF probabilities
at threshold 0.5, averaging the three complete-repeat accuracies:

| Target | Baseline accuracy | Current auto choice | Accuracy with choice | Change |
|---|---:|---|---:|---:|
| CAD | 86.36% | `logs` | 87.60% | +1.24 percentage points |
| LAD | 77.41% | `counts` | 78.24% | +0.83 percentage points |
| LCX | 66.53% | `ratios_counts` | 67.91% | +1.38 percentage points |
| RCA | 65.70% | `baseline` | 65.70% | 0.00 percentage points |

LAD counts tied the full combined set. No engineered set exceeded RCA's
baseline accuracy. The defaults use the simpler LAD choice and retain RCA's
baseline. They do not imply that adding every generated column is beneficial.

The original notebook ranks **log loss**, which gives different winners:

| Target | Lowest-log-loss feature set | Baseline log loss | Variant log loss |
|---|---|---:|---:|
| CAD | `counts` | .33368 | .32556 |
| LAD | `ratios_counts_logs` | .51957 | .51236 |
| LCX | `counts` | .61068 | .60565 |
| RCA | `ratios_counts` | .60816 | .60123 |

These small differences describe this experiment. Defaults were chosen after
inspecting development results, so these scores are not independent estimates
of their future performance. Repeats reuse patients, and their variability is
not a confidence interval for improvement. Model selection in the legacy
training pipeline still uses ROC-AUC with F1 as a tie-break, not this accuracy
ranking or the notebook's log-loss ranking.

The nested protocol can evaluate a fixed engineered candidate against a raw
baseline, but does not nest selection among feature sets. Testing the complete
feature-selection procedure would require making that choice within inner
folds. New external data would also help assess generalisation after the
existing development cohort has been inspected.

See [Feature engineering](feature-engineering.md) for formulas. The dataset
README documents the notebook and the CSV/plot exports under
`dataset/engineered_feature_analysis/`.

## Confusion-matrix plots

Run `python training/evaluate.py` to evaluate the saved models and write:

- `training/artifacts/confusion_matrices.png`: all four count matrices in one
  overview, using a shared colour scale.
- `training/artifacts/<target>/confusion_matrix.png`: counts and row-normalised
  percentages for each of `cad`, `lad`, `lcx` and `rca`.

Rows show the **actual** class and columns show the **predicted** class, both
ordered negative (0), positive (1). Cells are arranged as `[[TN, FP], [FN, TP]]`.
The positive label is CAD for the overall target and Stenotic for each vessel.
The plots include the held-out sample size and saved decision threshold.

Each percentage is divided by the number of patients in that actual class;
each nonempty row therefore sums to 100%. An actual class with no observations
is labelled N/A. Counts come directly from the evaluation results stored in
`metrics.json`. These plots use each target's held-out test set, while the
learning curves below use the first outer CV fold. Evaluation refreshes the
plots alongside `metrics.json` without fitting or tuning models.

## v1 vs v2 comparison

| Target | v1 Test AUC | v2 Test AUC | Change |
|---|---:|---:|---:|
| CAD | 0.877 | 0.893 | +0.016 |
| LAD | 0.839 | 0.843 | +0.004 |
| LCX | 0.693 | 0.711 | +0.018 |
| RCA | 0.735 | 0.748 | +0.013 |

v1 used single 5-fold CV with RF/XGB only. v2 added 10 repeats, five more model
families, CatBoost-native, stacking, soft voting ensemble, PR-AUC/Brier metrics,
and the experiments log.

## Reading the results honestly

**CAD and LAD have stronger scores on this held-out cohort.** CAD achieves
0.893 AUC with 93% recall, identifying 40 of 43 positive patients. LAD achieves
0.843 AUC with 86% recall. These single-source results do not establish external
generalisation or clinical usefulness.

**LCX and RCA miss more than half of positive test cases at threshold 0.5.**
LCX recall is 0.458 (detects 11 of 24 positives) and RCA recall is 0.391
(detects 9 of 23 positives). The scores alone do not establish why these models
miss these cases.

**Probabilities remain uncalibrated.** The models output raw `predict_proba`
values without Platt or isotonic scaling. A probability of 0.7 does not mean
a 70% chance of disease in a validated clinical sense.

**Small test set uncertainty.** With n=61, small score differences should not be
treated as reliable improvements without uncertainty estimates and further
validation. The accuracy intervals below do not quantify ROC-AUC uncertainty.

## Leakage prevention

The evaluation pipeline enforces:
- Outer-fold preprocessing excludes validation data
- Stacking/voting inner-fold preprocessing excludes inner validation rows
- Target labels are excluded from every head
- Selection uses CV rather than the test scores
- The 61 test patients are never used in fitting

Historical stacking/voting scores predate the inner-fold preprocessing fix.
They require a new training run before being compared under the current
protocol; see [Models](models.md). The saved winners have not changed.

## Calibration status

The serving models remain uncalibrated. The new CAD experiment evaluates raw,
Platt sigmoid and isotonic probabilities on identical outer folds. Calibrator
fitting and method selection use training-only nested predictions; method
choice is not based on outer scores. Isotonic is explicitly a small-sample
candidate rather than a default recommendation for this 303-row dataset.

Reports include log loss, Brier, calibration intercept/slope,
calibration-in-the-large, and ECE under two binning schemes. A prevalence-only
probability baseline and probability histograms give context. Low Brier alone
does not establish calibration. Vessel calibration remains unimplemented.

## After retraining and evaluation

From the repository root, the complete serving refresh is:

```bash
python3 training/train.py --feature-set auto
python3 training/evaluate.py
python3 training/model_info.py --output frontend/public/model-info.json
```

Training replaces artifacts for the requested targets in `training/artifacts/`.
Evaluation refreshes metrics and confusion matrices for the saved models; the
last command refreshes offline frontend metadata. Restart the backend after
the bundle is complete because models and explanation backgrounds are cached.
Do not present old metrics as results for newly trained artifacts. For isolated
CAD research, use the [nested experiment](cad-nested-validation.md) instead.

## Stored learning curves

`train.py` saves training and validation curves under
`training/artifacts/<target>/learning_curves/<UTC-run>/<config>/`.
The default `--learning-curves best` exports the winning configuration;
`--learning-curves all` exports each candidate after its CV finishes, and
`--learning-curves none` disables export. Separate run directories preserve
earlier plots. Target metadata links to the winner through `best.learning_curves`.

Each directory contains `model.png`, `metrics.csv` and `metadata.json`.
The seven plotted metrics are log loss, ROC-AUC, PR-AUC (average precision),
accuracy, F1, Brier and F2. CSV rows identify the component, stage type/count,
train/validation split and decision threshold. Curve metadata records the
configuration, first-repeat seed, CV fold, row indices and sample counts. New
curve exports also record the resolved `feature_set`.

The legacy exporter uses the **first CV selection fold of the first repeat** and its
fitted preprocessor/model. It does not expose the held-out test set or average
curves across repeats. These diagnostics therefore differ from both the CV
summary and the final model fitted on the entire training partition.
Earlier plot titles call this an "outer CV fold", but it is not an independent
outer test of model selection. The nested protocol saves explicitly labeled
**inner-validation** learning curves; outer data are never supplied to early
stopping, calibration fitting, hyperparameter or threshold selection.

- XGBoost, LightGBM, CatBoost and HistGradientBoosting: every fitted boosting
  iteration, reconstructed from stage probabilities.
- Random Forest: each cumulative tree prefix, labelled as tree count.
- Stacking/voting: separate member plots and a final ensemble score point.
  Members without staged predictions, including ElasticNet, have final-fit
  points. No synthetic ensemble epochs are plotted.

Metrics are unweighted. The ensemble point uses its decision threshold;
member curves use 0.5. Log loss is a diagnostic probability metric and may
differ from the optimiser's weighted objective.
F2 uses `fbeta_score(beta=2)` with the same threshold as the other binary-label
metrics. It is recorded at every stage for both splits; adding the curve does
not change the ROC-AUC/F1 rule for selecting the winning model.

To create curves for existing saved configurations without repeating model
selection or replacing serving artifacts:

```bash
python training/train.py --curves-only
python training/train.py --targets cad --curves-only
```

This refits each saved winner on the first CV fold and writes a new run marked
`regenerated_from_saved_config`. It reconstructs curves using the current code;
it does not recover logs from the original training process. It uses the saved
feature set, falling back to `baseline` for historical metadata. An explicit
`--feature-set` override with `--curves-only` is rejected. Matplotlib is
pinned in the training dependencies and uses a headless canvas.

## Accuracy with available inputs

The dashboard and exported PDF report an exploratory missing-input check using
the frozen serving models. Its implementation is
`backend/services/input_validation.py`; the result is returned in
`POST /predict` → `context.input_validation`.

### Calculation

For each of CAD, LAD, LCX and RCA:

1. Reconstruct the target's stratified held-out split using its saved label
   definition, random seed and test size. Each current test set has 61 records;
   target-specific stratification means the records can differ between targets.
2. Keep those records' values in the fields supplied by the user. Explicit zero
   counts as supplied; an omitted field does not.
3. Replace all other fields with the explicit `PatientInput` API defaults. The
   current patient's values are not copied into the test records.
4. Apply the frozen preprocessor, including derived-feature recomputation after
   default substitution, and model, then the saved classification
   threshold (0.5 for all current winners).
5. Compare classifications with the known labels and count correct predictions.

```text
accuracy = (true positives + true negatives) / number of test records
displayed accuracy (%) = 100 × correct / n_test
```

No models, preprocessors or thresholds are fitted or selected during this check.
It does not modify `metrics.json` or replace the full-input results in Model Info.

### Worked example and interpretation

If only Age and Diabetes are supplied, retain those two columns on the held-out
records and default the other 52. For a hypothetical result of 52 correct
classifications out of 61, accuracy is `52 / 61 = 0.852459…`, displayed as 85.2%.
This illustrates the arithmetic, not the measured performance of that field pair.

| Quantity | What changes it |
|---|---|
| Patient prediction probability | The patient's supplied values, defaults and loaded model |
| Input coverage | Number of supplied fields divided by 54 |
| Accuracy with available inputs | Which fields are supplied, API defaults, frozen model and test cohort |

Changing a patient's values while preserving the same field set changes neither
the cohort nor its validation score. Two field sets of the same size may score
differently. Adding fields does not guarantee a higher score.

The panel reports correct counts, sample size, recall (true positives divided by
known positives), the majority-class baseline, and accuracy with all inputs
available. The baseline is `max(positive_count, negative_count) / n_test` and
always predicts the more common test-set class. All-input accuracy is recomputed
on the same cohort before substituting defaults.

### Uncertainty and limits

The
[95% Wilson score intervals](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm)
describe binomial sampling uncertainty in the fraction classified correctly.
They do not capture model-selection uncertainty, dataset shift or all sources
of error. The current test sets contain only 61 patients per target from one
source; these measurements do not establish clinical reliability for an individual.

Empty submissions produce constant default-based predictions whose apparent accuracy
can reflect class balance; the UI explicitly flags them as not personalized.
Fully supplied inputs reproduce the saved held-out accuracy. These exploratory
scores must not be used to select input subsets or tune models on the test set.

This check replaces missing measurements with preset values; it does not train
models that use only the supplied fields. It also does not establish robustness
under every real-world missing-data mechanism or the correctness of any one
patient's prediction. A planned robustness study and external validation remain
separate work.

### Resources and display states

The service needs the repository's `dataset/dataset.csv` in its original row order
and the loaded artifacts' split metadata. It verifies label definitions and split
sizes, but has no saved dataset content fingerprint. Matching row counts alone
does not establish cohort identity. `ARTIFACTS_DIR` does not select a different
validation CSV.

The frontend and exported report preserve the validation result associated with
the submitted assessment. Unsubmitted edits require reanalysis. Demo fixtures and
missing validation resources do not produce input-dependent accuracy scores.
Missing resources return `status: unavailable` while predictions can still
succeed. Older API responses without this field also show an unavailable message.
See the [response fields](api.md#accuracy-with-available-inputs) and
[cache/service reference](api-reference/backend.md#servicesinput_validationpy).

## Outstanding deliverables

- Calibration plots, ROC/PR curves
- External validation on a separate cohort
- The six-page submission document
- Demonstration video (3-10 minutes)
