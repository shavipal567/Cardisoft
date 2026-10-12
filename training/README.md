# Training and inference

This directory owns feature engineering, model fitting, evaluation and frozen
inference for CAD and the three vessel targets. The backend loads its artifacts;
HTTP requests never fit models or choose a feature set.

## Implementation and saved-model status

The engineered pipeline is implemented for new runs. Existing artifacts in
`training/artifacts/` still use baseline features: CatBoost for CAD and Random
Forest for LAD, LCX and RCA. Their stored metrics have not been replaced with
results from the feature-analysis notebook.

The raw schema remains 54 inputs from `dataset/dataset.csv` (303 rows × 59
columns). `split_features_target()` removes all four diagnosis columns and
constant `Exertional CP`, then applies the input allow-list.

| Target | Label column | Positive label |
|---|---|---|
| `cad` | `Cath` | `CAD` |
| `lad` | `LAD` | `Stenotic` |
| `lcx` | `LCX` | `Stenotic` |
| `rca` | `RCA` | `Stenotic` |

## Reproduce a serving-model training run

Commands in this guide start at the repository root. Install the pinned training
dependencies with Python 3.10+:

```bash
python3 -m pip install -r training/requirements.txt
python3 training/train.py --feature-set auto
python3 training/evaluate.py
python3 training/model_info.py --output frontend/public/model-info.json
```

The training command replaces the requested serving artifacts. Evaluation scores
all four saved targets and writes metrics/confusion matrices. The metadata export
refreshes the frontend's offline snapshot. Restart the backend after updating the
complete bundle. Avoid serving the directory while files are being replaced.

Useful variants:

```bash
python3 training/train.py --targets cad --feature-set logs
python3 training/train.py --targets cad --feature-set baseline
python3 training/train.py --targets lad lcx --feature-set ratios_counts
python3 training/train.py --targets cad --feature-set ratios_counts_logs --repeats 2
```

A reduced-repeat command still writes serving artifacts; it is not a dry run.
`evaluate.py` uses the repository's fixed seed-42, 80/20 split and default artifact
location. `ARTIFACTS_DIR` is an inference/backend override, not a training or
legacy evaluation output flag.

## Feature-set policy

`--feature-set auto` resolves once per target, before model selection:

| Target | Resolved set | Change from original inputs |
|---|---|---|
| CAD | `logs` | Replace TG/FBS/ESR with `log1p` values |
| LAD | `counts` | Add risk-factor count and ECG-finding count |
| LCX | `ratios_counts` | Add three ratios and both counts |
| RCA | `baseline` | Use original inputs |

Available explicit sets are `baseline`, `ratios`, `counts`, `logs`,
`ratios_counts` and `ratios_counts_logs`. One explicit set applies to every target
named in that command.

The counts are `DM + HTN + Current Smoker + FH + 1[DLP = Y]` and
`Q Wave + St Elevation + St Depression + Tinversion`. Ratios are LDL/HDL, TG/HDL
and Neut/Lymph. Counts and ratios retain their original component inputs. Logs
replace their three source columns. These are experimental representations, not
validated clinical scores. Total cholesterol is absent, so no non-HDL feature is
computed.

Defaults follow exploratory accuracy results from
`dataset/engineered-feature-analysis.ipynb`: three repeats of five-fold CV on
242 development records per target. The defaults were chosen after inspecting
those results. The training search fixes that feature choice and still selects
**models by ROC-AUC, breaking ties with F1**. It does not independently validate
feature selection or optimise accuracy.

See [feature engineering](../docs/feature-engineering.md) for the full evidence,
[preprocessing](../docs/preprocessing.md) for dimensions and transform order, and
[the analysis guide](../dataset/README.md) for exported results.

## Shared preprocessing

```text
54 raw fields → cleaning → numeric feature engineering
                         → fold-fitted imputation/encoding/scaling → model
```

`clean_dataframe()` normalises `Fmale` to `Female` and treats `Region RWMA` as a
categorical code. `NumericFeatureEngineer` performs fixed row-wise calculations
inside the numeric branch, before median imputation and `RobustScaler`.

- A ratio with a missing/invalid operand or nonpositive denominator is missing.
- A log needs a finite, nonnegative source value.
- Counts require all binary constituents; missing fields do not count as zero.
- Derived missing values are imputed using the current training fold. Engineered
  numeric branches retain all-missing outputs to preserve column positions.
- All preprocessing is cloned/fitted within each CV fold, including the inner
  folds used by stacking and voting.

| Track | Models | Categorical handling |
|---|---|---|
| `onehot` | RF, XGBoost, HistGradientBoosting, stacking | Mode imputation and one-hot encoding |
| `native` | LightGBM, CatBoost | Mode imputation and integer codes; unseen categories map to −1 |
| `voting` | Soft-voting ensemble | One-hot track followed by `StandardScaler(with_mean=False)` |

There are 33 baseline numeric columns and 21 categorical input fields. Ratios add
three numeric outputs; counts add two; logs keep the numeric width unchanged.
Native positions come from `native_cat_indices(feature_set)`. One-hot width also
depends on the categories observed in that fold; do not hard-code 81 columns.

Low-level builders default to `feature_set="baseline"` for compatibility.
`train_target()` resolves the target policy and passes it through CV, stability
checks, ensemble fitting and final refitting. Inference uses the saved
preprocessor, never the current `auto` policy.

## Model selection

Each target uses its own stratified 80/20 split with seed 42: 242 development and
61 holdout records. By default, 10 seeds (42–51) each produce five development CV
folds. Fold membership is stratified by that target, so holdout rows differ
between targets.

| Family | Configurations | Main settings searched |
|---|---:|---|
| Random Forest | 8 | 200/400 trees; depth 8/unlimited; leaf minimum 1/2 |
| XGBoost | 8 | 200/400 trees; depth 3/4; learning rate .05/.1 |
| HistGradientBoosting | 4 | 15/31 leaves; minimum leaf size 10/20 |
| LightGBM | 6 | 7/15/31 leaves; minimum child samples 10/20 |
| CatBoost | 4 | Depth 4/6; L2 3/10; 400 iterations |
| Stacking | 1 | RF/XGB/HGB predictions with a logistic-regression meta-model |
| Voting | 1 | RF/XGB/HGB/LGBM/CatBoost/ElasticNet with tuned weights and threshold |

The 32-configuration search records ROC-AUC, F1, average precision and Brier score.
Mean ROC-AUC selects a winner, then mean F1 breaks ties. Voting chooses its weights
and threshold on inner OOF predictions using F2; other candidates use threshold
0.5. Native categorical indices are supplied to LightGBM/CatBoost at every fit.

Winning CV scores reuse the selection folds and can be optimistic. The legacy
XGBoost class-weight ratio is computed from the full development partition;
this is a known limitation. Historical ensemble scores predate the inner-fold
preprocessing correction and have not been regenerated. Neither ensemble won
an existing serving target.

## Saved artifacts

New `train_target()` runs write these files under `training/artifacts/<target>/`:

| File | Contents |
|---|---|
| `preprocessor.joblib` | Fitted encoding, feature engineering, imputation and scaling |
| `model.joblib` | Fitted classifier consuming transformed inputs |
| `metadata.json` | Model/configuration, resolved feature set, split, CV results, thresholds and revision |
| `feature_schema.json` | Raw inputs, transformed output names and engineered features |
| `shap_background.npz` | Up to 100 transformed development rows under key `background` |
| `shap_raw_background.joblib` | The corresponding raw development rows for engineered-model explanations |

`experiments.csv` records each configuration and feature set. When an old log is
extended, existing rows are labelled `baseline`. No labels enter the backgrounds'
input columns. The backend still accepts only the 54 raw measurements.

`inference.py` loads and caches preprocessors/models, returns positive-class
probabilities and applies each saved threshold. It fingerprints model and
preprocessor bytes for prediction/explanation version matching. Old artifacts
without feature-set metadata keep their existing baseline transforms.

For engineered models, the explainer changes raw fields and reruns the frozen
preprocessor on every path. This recalculates dependent ratios, counts and logs.
The raw background must travel with those models. Baseline models can use the
original transformed background. [Explanation contract](../docs/explainability.md).

## Separate nested CAD experiments

```bash
python3 training/train.py --protocol nested --feature-set logs
```

The nested entry point accepts `--config`, `--output`, `--dataset`,
`--group-column` and `--feature-set`; it does not accept legacy `--targets` or
`--repeats`. Repeat counts and other settings come from its JSON configuration.

Experiments go to a new `training/experiments/cad_nested_<UTC>/` directory.
They preserve the serving bundle and save source/data fingerprints, split rows,
inner searches, outer predictions, calibration/threshold diagnostics, reports
and a model under `model/cad/`.

The candidate uses one fixed feature set. Historical configurations without
`feature_set` default to `baseline`; `--feature-set auto` resolves to CAD `logs`.
The comparison baseline always uses original inputs. Inner folds choose model
settings, iteration count and calibration; outer folds evaluate that procedure.
This is not nested selection among feature sets, and prior inspection of the
cohort remains a limitation.

Experimental artifacts also include `pipeline.joblib`, accepting a raw DataFrame
through `FeatureSchema`, preprocessing and the calibrated-or-raw classifier.
A CAD-only experimental directory is not a complete four-target serving bundle;
its metadata/reporting schema also differs from the legacy dashboard schema.
Do not point the full application at it as though it were a serving export.

See [CAD nested validation](../docs/cad-nested-validation.md) for the audited
protocol, completed historical comparison and reproduction details.

## Learning curves and evaluation

`--learning-curves best` is the default; `all` exports every candidate and `none`
disables curve export. Curves are saved under each target's
`learning_curves/<UTC-run>/<config>/` directory as PNGs, metrics CSV and metadata.
They show log loss, ROC-AUC, average precision, accuracy, F1, F2 and Brier score.

Legacy curves use the first **selection CV fold**, not the holdout or an
independent outer evaluation. Nested curves use inner training/validation rows.
Feature-set identity is included in curve metadata.

```bash
python3 training/train.py --curves-only
python3 training/train.py --targets cad --curves-only
```

These commands refit the saved configuration on a CV fold for diagnostics without
replacing serving models. They restore the feature set from saved metadata,
falling back to baseline for historical models. An explicit feature-set override
is rejected in this mode.

`evaluate.py` scores the frozen serving models and writes `metrics.json`, the
combined confusion-matrix PNG and one PNG per target. It does not tune models or
thresholds. Keep this evaluation separate from the exploratory feature-CV results.
[Evaluation definitions](../docs/evaluation.md).

## Verification and module guide

```bash
MPLCONFIGDIR=/tmp/cardisoft-mpl-cache OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python3 -m unittest discover -s training/tests -v
python3 -m pip install -r backend/requirements-test.txt
python3 -m unittest discover -s backend/tests -v
```

Tests cover the original analysis formulas, invalid/missing operands, fold
isolation, all feature sets and tracks, native category positions, serialization,
training/inference parity, historical artifacts and explanation consistency.
A small nested run can check integration, but its scores are not a performance
estimate for the full protocol.

| Modules | Responsibility |
|---|---|
| `preprocessing.py` | Raw allow-list, feature formulas, set policy and three preprocessing builders |
| `train.py`, `evaluate.py`, `model_info.py` | Serving-model search, frozen evaluation and dashboard metadata |
| `calibration.py`, `clinical_metrics.py` | Calibrated inference and metrics |
| `learning_curves.py`, `evaluation_plots.py`, `experiment_report.py` | Diagnostic exports and experiment reports |
| `ensemble_cv.py`, `stacking.py`, `voting.py` | Fold-local ensemble training |
| `native_models.py`, `inference.py` | Estimator adapters and artifact loading |

Detailed signatures are in the [training API reference](../docs/api-reference/training.md).
