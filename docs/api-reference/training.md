# Training API reference

Rendered from docstrings in `training/`. Prose documentation:
[Models](../models.md), [Preprocessing](../preprocessing.md),
[Evaluation](../evaluation.md).

## Module overview

| Module | Purpose | Key exports |
|---|---|---|
| `preprocessing.py` | Constants, cleaning, preprocessor builders | `LEAKAGE_COLUMNS`, `ALL_INPUT_FEATURES`, `NumericFeatureEngineer`, `resolve_feature_set()`, `engineer_features()`, `clean_dataframe()`, `build_preprocessor()`, `build_native_preprocessor()`, `build_voting_preprocessor()`, `split_features_target()` |
| `train.py` | Repeated-CV model selection + artifact saving | `train_target()`, `repeated_cv_scores()`, `make_configs()`, `build_estimator()`, `fit_voting()`, `fit_with_track()` |

| `calibration.py` | Calibration and frozen inference | `ProbabilityCalibrator`, `CalibratedBinaryModel`, `FeatureSchema` |
| `clinical_metrics.py` | Clinical/calibration metrics and training-OOF thresholds | `binary_metrics()`, `calibration_metrics()`, `operating_thresholds()` |
| `experiment_report.py` | Saved-prediction evaluation and uncertainty | `generate_report()`, `paired_bootstrap()` |
| `learning_curves.py` | Per-stage metrics and persistent PNG/CSV export | `staged_probabilities()`, `save_learning_curves()` |
| `evaluate.py` | Held-out test evaluation | `evaluate_target()` |
| `evaluation_plots.py` | Count and row-normalised confusion-matrix PNGs | `save_confusion_matrix_plots()` |
| `inference.py` | Frozen artifact loading + prediction | `predict_patient()`, `transformed_row()`, `get_artifact()`, `available()` |
| `model_info.py` | Metrics/metadata export for API | `model_info()` |
| `stacking.py` | Stacked ensemble (OOF + LogReg meta) | `StackedModel` |
| `ensemble_cv.py` | Inner-fold preprocessing and ensemble predictions | `out_of_fold_probabilities()` |
| `voting.py` | Soft voting ensemble with weight/threshold optimization | `VotingClassifier`, `build_voting_estimators()`, `optimize_voting_weights_and_threshold()` |
| `native_models.py` | Integer categorical I/O and LightGBM feature-name handling | `CatBoostNative`, `LGBMArrayClassifier` |

## preprocessing.py

### Constants

```python
LEAKAGE_COLUMNS = ["LAD", "LCX", "RCA", "Cath"]
DROP_COLUMNS = ["Exertional CP"]

TARGETS = {
    "cad": {"column": "Cath", "positive": "CAD"},
    "lad": {"column": "LAD", "positive": "Stenotic"},
    "lcx": {"column": "LCX", "positive": "Stenotic"},
    "rca": {"column": "RCA", "positive": "Stenotic"},
}

NUMERIC_FEATURES = [...]   # 33 columns: Age, Weight, Length, BMI, binaries, labs, EF-TTE
YN_FEATURES = [...]        # 17 Y/N flags: Obesity, CRF, CVA, ..., LVH, Poor R Progression
NOMINAL_FEATURES = ["Sex", "BBB", "VHD", "Region RWMA"]

ALL_INPUT_FEATURES = NUMERIC_FEATURES + YN_FEATURES + NOMINAL_FEATURES  # 54 total
NATIVE_CAT_FEATURES = YN_FEATURES + NOMINAL_FEATURES  # 21 total
```

### `clean_dataframe(df: pd.DataFrame) -> pd.DataFrame`

Normalizes known data quirks. Idempotent; safe for train and inference.

- `Sex`: replaces `"Fmale"` with `"Female"` (dataset typo, 127 rows)
- `Region RWMA`: casts int codes to strings for categorical encoding

### Feature-set constants and resolution

```python
FEATURE_SETS = (
    "baseline", "ratios", "counts", "logs", "ratios_counts", "ratios_counts_logs"
)
DEFAULT_FEATURE_SETS = {
    "cad": "logs", "lad": "counts", "lcx": "ratios_counts", "rca": "baseline"
}
```

`resolve_feature_set(feature_set="auto", target=None)` resolves `auto` for a
valid target, or validates an explicit set. Invalid choices and `auto` without
a valid target raise `ValueError`. Low-level builders default to `baseline`;
the legacy training entry point defaults to `auto`.

`engineered_feature_names(feature_set)` returns the generated names for that
set. `numeric_feature_names(feature_set="baseline")` returns the numeric branch's
output order, removing raw TG/FBS/ESR when logs replace them. The constants
`RATIO_FEATURES`, `COUNT_FEATURES`, `LOG_SOURCES`, `LOG_FEATURES` and
`ENGINEERED_FEATURES` describe these names.

### `engineer_features(X, feature_set="ratios_counts_logs") -> DataFrame`

Computes only the selected derived columns, preserving the row index. Formulas
are deterministic and use no labels or learned population statistics. Invalid
operands become missing values; counts require complete binary constituents.
See [Feature engineering](../feature-engineering.md) for formulas and rules.
This helper does not impute, scale, or fit a model.

### `NumericFeatureEngineer(feature_set="baseline")`

Cloneable, serializable sklearn transformer for the numeric branch. It retains
original numeric columns, adds selected ratios/counts, and replaces lab columns
when logs are selected. `fit()` validates the set;
`get_feature_names_out()` describes the output columns. The count branch also
receives raw DLP, which remains independently encoded by the categorical branch.

### `build_preprocessor(feature_set="baseline") -> ColumnTransformer`

One-hot track for RF/XGB/HGB/stack. The numeric branch applies feature engineering
for non-baseline sets, median imputation, then `RobustScaler`. Engineered sets
preserve entirely missing numeric outputs. The categorical branch applies mode
imputation and `OneHotEncoder(handle_unknown="ignore", sparse_output=False)`.

The baseline full-vocabulary width is 81; selected features and fold-specific
category vocabularies determine the actual width. Inspect fitted names instead
of assuming a fixed dimension.

### `build_native_preprocessor(feature_set="baseline") -> ColumnTransformer`

LightGBM/CatBoost track, with the same numeric branch. Categorical fields use
mode imputation followed by ordinal encoding; unseen levels map to −1. Output
order is `[numeric_feature_names(feature_set)..., NATIVE_CAT_FEATURES...]`.
The 21 categorical columns follow 33–38 numeric outputs, depending on the set.

### `build_voting_preprocessor(feature_set="baseline") -> Pipeline`

Composes `build_preprocessor(feature_set)` and
`StandardScaler(with_mean=False)`. All six voting members receive the same
scaled one-hot matrix, including members whose standalone track is native.

### `native_cat_indices(feature_set="baseline") -> list[int]`

Returns categorical positions based on the selected numeric output width.
Baseline uses `[33, ..., 53]`; counts use `[35, ..., 55]`; ratios/counts use
`[38, ..., 58]`. These are passed as `categorical_feature` for LightGBM or
`cat_features` for CatBoost.

### `encode_target(series: pd.Series, positive: str) -> pd.Series`

Converts labels to binary: `(series == positive).astype(int)`

### `split_features_target(df, target_column, positive) -> (X, y)`

Cleans the frame and selects `ALL_INPUT_FEATURES`, excluding all four targets
and constant `Exertional CP`. Returns the raw 54-column `X` and encoded `y`;
it does not select features by measuring variance on the current partition.

### `get_output_feature_names(preprocessor) -> list[str]`

Returns transformed column names via `preprocessor.get_feature_names_out()`.

## train.py

### `make_configs(y_train) -> (configs, scale_pos)`

Builds 32 model configurations. `train_target()` adds the resolved feature set
to each configuration. `scale_pos` is the negative/positive ratio for XGBoost;
the legacy implementation computes it from the full development partition
and reuses it in selection folds, a limitation of its fold isolation.

| Model | Track | Grid |
|---|---|---|
| RF | onehot | `n_estimators` × `max_depth` × `min_samples_leaf` = 2×2×2 = 8 |
| XGB | onehot | `n_estimators` × `max_depth` × `learning_rate` = 2×2×2 = 8 |
| HGB | onehot | `max_leaf_nodes` × `min_samples_leaf` = 2×2 = 4 |
| LGBM | native | `num_leaves` × `min_child_samples` = 3×2 = 6 |
| CatBoost | native | `depth` × `l2_leaf_reg` = 2×2 = 4 |
| Stack | onehot | 1 (RF+XGB+HGB → LogReg) |
| Vote | voting | 1 (RF+XGB+HGB+LGBM+CatBoost+ElasticNet → soft vote) |

### `build_prep(prep, feature_set="baseline")`

Selects `onehot`, `native` or `voting` preprocessing and forwards the resolved
feature set. See [Preprocessing](../preprocessing.md) for dimensions.

### `build_estimator(kind, params, scale_pos) -> classifier`

Factory that constructs the appropriate sklearn/LGBM/CatBoost estimator with
the given hyperparameters. `kind="lgbm"` returns `LGBMArrayClassifier`;
`kind="cat"` returns `CatBoostNative`. Stacking and voting are fitted through
`fit_with_track()` rather than this factory.

### `fit_voting(scale_pos, X, y, cv=5, seed=42, *, preprocessor) -> VotingClassifier`

Builds all six voting members with the supplied seed, optimises weights and
threshold from inner out-of-fold predictions using raw `X` and a fresh
preprocessor clone inside each fold. It then fits the supplied preprocessor on
all `X` and fits the ensemble on the transformed matrix. The caller saves that
preprocessor separately; the returned model accepts transformed inputs.
The same seed controls the member estimators and the inner stratified split.

Outer CV calls this with `cv=3` and the repeat seed. Winner stability uses
`cv=5` for each repeat seed; the final refit uses `cv=5, seed=42`.

### `fit_with_track(kind, params, scale_pos, prep, X_tr, y_tr, *, seed=42, voting_cv=5, feature_set="baseline") -> (preprocessor, classifier)`

Fits the selected preprocessor and classifier on the supplied training
partition. `feature_set` controls every track and its numeric output width.
Native LightGBM/CatBoost fits receive the corresponding categorical indices;
voting delegates to `fit_voting()`. Both ensembles receive raw training rows
and an unfitted preprocessor for isolated inner-fold fitting. Outer scoring,
stability checks, and final refitting share this path.

### `repeated_cv_scores(cfg, X_train, y_train, scale_pos, seeds, *, first_fold_callback=None) -> dict`

Runs repeated stratified 5-fold CV with `cfg["feature_set"]` (baseline if absent).
These are selection folds, not an independent outer evaluation of the search.
Voting F1 uses the threshold tuned within
each outer training fold; other classifiers use 0.5. ROC-AUC, PR-AUC and Brier
use `predict_proba(X)[:, 1]`. Returns:

```python
{
    "cv_roc_auc": float,       # mean ROC-AUC across all folds
    "cv_roc_auc_std": float,   # standard deviation
    "cv_f1": float,            # mean F1
    "cv_pr_auc": float,        # mean PR-AUC (average_precision)
    "cv_brier": float,         # mean Brier score
    "n_scores": int,           # total fold count (repeats × 5)
}
```

When provided, `first_fold_callback` receives one dictionary containing the
first selection fold's fitted model/preprocessor and raw train/validation features
and labels. The curve exporter retains this fit without changing CV scoring.

### `stability_jaccard(kind, params, scale_pos, prep, X_train, y_train, seeds, k=10, *, feature_set="baseline") -> float`

Mean pairwise Jaccard similarity of top-k feature importance sets across
refits on the development partition using different seeds and the same feature set. Voting is fitted through `fit_voting()` for every seed and re-tunes its
weights and threshold on the training partition. Its importance vector averages
normalised importances from members that expose usable values. With fewer than
two repeat seeds, there are no pairs to compare and the result is NaN.

### `train_target(key, df, repeats, learning_curves="best", *, feature_set="auto") -> dict`

Full training pipeline for one target:

1. `split_features_target()` → stratified 80/20 split (seed 42)
2. Resolve one feature set for this target and attach it to all 32 configurations
3. `repeated_cv_scores()` for each config (10 repeats × 5 folds)
4. Select winner by mean CV ROC-AUC (tie-break F1)
5. Save per-stage metric CSVs and PNGs from the first CV selection fold
6. `stability_jaccard()` for the winner
7. Refit winner on full 242-row train split
8. Save `preprocessor.joblib`, `model.joblib`, `metadata.json`,
   `feature_schema.json`, `shap_background.npz` and `shap_raw_background.joblib`

Metadata records the resolved feature set, generated names and transformed
width. The raw and transformed backgrounds contain the same sampled development
rows, at most 100. The raw background is required for engineered explanations.
`training/artifacts/experiments.csv` includes `feature_set`; when the log schema is extended,
old rows are labelled `baseline` while existing values are preserved.

`learning_curves` accepts `best` (default), `all`, or `none`. With `all`, each
configuration is exported after its own CV completes. The returned winner and
target metadata include a relative `learning_curves` path when export is enabled.

### `save_curves_for_saved_target(key, df) -> Path`

Reads the saved winner's metadata, reproduces its train/test split and refits
the configuration on the first CV selection fold. Writes a new diagnostic curve
run without replacing serving artifacts or target metadata. Export metadata
marks it as `regenerated_from_saved_config`. Restores the saved feature set,
falling back to `baseline` for historical metadata.

### `main(targets, repeats, learning_curves="best", *, curves_only=False, feature_set="auto")`

Legacy entry point. Reads `dataset/dataset.csv`, calls `train_target()` for
each target, and writes to `training/artifacts/`. `ARTIFACTS_DIR` does not
redirect legacy training or evaluation. `--curves-only` restores saved feature
sets and rejects an explicit non-auto override.

```bash
python3 training/train.py --feature-set auto           # all 4 targets, 10 repeats
python training/train.py --targets cad --repeats 2     # reduced run; writes CAD artifacts
python training/train.py --targets cad --learning-curves all
python training/train.py --curves-only                 # regenerate curves for saved winners
```

## Nested CV protocol

`python3 training/train.py --protocol nested` runs the nested CAD experiment
implemented in `train.py` (`run_nested`, `select_inner`, `select_calibration`,
`cv_splits`, `audit_and_groups`). The CLI accepts `--config`, `--output`,
`--dataset` and `--group-column`. Legacy `--targets`/`--repeats` flags do not
apply; folds and repeats come from the experiment configuration.

Outputs go to a new experiment directory, not the serving bundle. See
[CAD nested validation](../cad-nested-validation.md) for selection, exported
pipelines, reporting and compatibility limits.

## learning_curves.py

### `staged_probabilities(model, X)`

Yields `(step_type, step, positive_probabilities)` for each fitted iteration or
forest tree prefix. `step` is one-based. Models without staged predictions
yield one `final_fit` point; no epoch trajectory is invented.

### `save_learning_curves(directory, *, model, preprocessor, X_train, y_train, X_valid, y_valid, context) -> dict`

Transforms raw fold rows with the supplied fitted preprocessor and exports
`metrics.csv`, `metadata.json` and seven-panel PNGs, including F2 computed with
`beta=2` at each stage's decision threshold. Ensembles additionally export
member plots. `context` supplies `target`, `model`, `seed`, `fold`, `feature_set` and optional
run/configuration provenance. Callers must supply only training/validation
development training/validation rows: selection folds in the legacy protocol,
inner folds in the nested protocol. The callers exclude holdout rows.

The return value is the curve metadata, including plot filenames and source
row indices. See [Evaluation](../evaluation.md#stored-learning-curves) for the
metric definitions and interpretation.

## voting.py

### `VotingClassifier(estimators, weights=None, threshold=0.5)`

`fit(X, y)` clones and fits each binary member on the transformed matrix.
`classes_` is `[0, 1]`.

- `predict_proba(X)` returns an array of shape `(n_samples, 2)`, including for
  one input row. Column 1 is the weighted mean positive-class probability;
  column 0 is its complement. Each row sums to one. Omitted weights or a
  non-positive weight sum fall back to uniform weights.
- `predict(X)` returns `(predict_proba(X)[:, 1] >= threshold).astype(int)`.
- `feature_importances_` returns the unweighted mean of normalised member
  importances, skipping missing, empty or zero-total values. It raises
  `AttributeError` if no member has usable importances.

### `build_voting_estimators(scale_pos, random_state=42) -> list`

Returns named RF, XGB, HGB, LightGBM, CatBoost and ElasticNet members. LightGBM
uses `LGBMArrayClassifier`; CatBoost uses `CatBoostNative`. The supplied seed
is applied to every member, including CatBoost's `random_seed`.

### `optimize_voting_weights_and_threshold(estimators, X, y, cv=5, seed=42, *, preprocessor=None)`

Returns `(best, results)` from stratified out-of-fold predictions. The top four
members by individual F2 enter a weight grid of `{0, 0.5, 1, 1.5, 2}`; other
members get zero weight. Thresholds range from 0.30 to 0.70 in steps of 0.02.
The selected combination maximises F2, then accuracy, then recall. `best`
contains `weights`, `threshold`, `f2`, `accuracy` and `recall`.

When a preprocessor is supplied, `X` contains raw features and each inner fold
fits a fresh clone on its training rows. Without one, inputs must be numeric
and require no learned preprocessing. Tuning leaves the supplied preprocessor
unfitted; `fit_voting()` performs the full training refit afterward.

## ensemble_cv.py and stacking.py

`out_of_fold_probabilities(estimators, X, y, cv=3, seed=42, *, preprocessor=None)`
returns an `(n_samples, n_members)` matrix of positive-class OOF probabilities.
Each inner fold shares one freshly fitted preprocessing clone across members;
the supplied preprocessor is not modified.

`StackedModel.fit(X, y, *, preprocessor=None)` uses this helper, then fits the
supplied preprocessor on all training rows and refits its base models on the
result. The caller retains that fitted preprocessor for the separate artifact.
`predict_proba()` continues to accept transformed inputs. Omitting preprocessing
is supported for numeric inputs that require no learned transformations.

## native_models.py

### `LGBMArrayClassifier`

Subclass of `lightgbm.LGBMClassifier` used by both the native LightGBM candidate
and the voting member. For fitted models, `predict_proba()` wraps a dense
two-dimensional NumPy array in a DataFrame with the model's `feature_name_`.
Existing DataFrames pass through. Inherited `predict()` uses this same path.

LightGBM exposes feature names even after fitting on unnamed arrays; supplying
those names prevents the repeated sklearn feature-name warning. This preserves
feature order and probability values without suppressing other warnings.
Cloning, categorical fit arguments, and joblib serialisation remain supported.
It does not retrofit previously saved plain `LGBMClassifier` instances.

### `CatBoostNative(cat_features=(), **params)`

Casts designated categorical columns to integer dtype at both fit and
prediction time, while accepting the shared preprocessor's NumPy output.
Exposes `predict_proba()`, `predict()`, `feature_importances_`, `get_params()`
and `set_params()` for the training and artifact-loading paths.

## evaluate.py

### `evaluate_target(key, df) -> dict`

Rebuilds the identical stratified split (same seed) and scores frozen artifacts.
Reads positive-class probabilities from column 1 and applies the saved
`metadata.json` threshold, defaulting to 0.5 when absent:

```python
{
    "target": "cad",
    "n_test": 61,
    "pos_rate": 0.704918,
    "accuracy": 0.852,
    "precision": 0.870,
    "recall": 0.930,
    "f1": 0.899,
    "roc_auc": 0.893,
    "confusion_matrix": {"tn": 12, "fp": 6, "fn": 3, "tp": 40},
}
```

### `main()`

Evaluates all four targets and writes `training/artifacts/metrics.json`,
`training/artifacts/confusion_matrices.png` and
`training/artifacts/<target>/confusion_matrix.png` for each target.

```bash
python training/evaluate.py
```

## evaluation_plots.py

### `save_confusion_matrix_plots(results, artifacts_dir) -> list[Path]`

Uses the evaluated `tn`, `fp`, `fn` and `tp` counts to draw a combined overview
and per-target count/percentage plots. Reads saved thresholds for titles.
Rows are actual classes and columns are predictions, both ordered `[0, 1]`.
Percentage panels normalise each actual-class row; empty rows are labelled
N/A. Returns the saved PNG paths. Uses headless Matplotlib and performs no fitting.

## inference.py

### `artifacts_dir() -> Path`

Returns `ARTIFACTS_DIR` env var or default `training/artifacts/`.

### `available() -> bool`

Returns `True` iff all four artifact directories load successfully.

### `get_artifact(target: str) -> dict`

Returns the cached frozen preprocessor/model for one target:

```python
{
    "prep": fitted_preprocessor,     # ColumnTransformer or voting Pipeline
    "model": classifier,             # fitted model
    "version": "<64 hex characters>", # SHA-256 of prep + model bytes
    "training_git_hash": "abc123",   # git hash from training time
    "model_kind": "cat",              # model family key
    "threshold": 0.5,                 # saved voting threshold, or default
    "metadata": {...},                # metadata.json loaded with this artifact
}
```

The backend accuracy service uses the cached `metadata` to reconstruct each
target's held-out split. Loading artifacts alone does not verify that the local
CSV matches the training dataset. See
[input validation](backend.md#servicesinput_validationpy).

### `predict_patient(features: dict) -> dict`

Main prediction entry point. `features` is keyed by raw CSV column names.
Uses the saved threshold from `metadata.json` (default 0.5 for non-voting models).

```python
predict_patient({"Age": 66, "Typical Chest Pain": 1, "DM": 1})
# Returns:
# {
#     "cad": {"prediction": 1, "probability": 0.87},
#     "vessels": {
#         "LAD": {"prediction": 1, "probability": 0.72},
#         "LCX": {"prediction": 0, "probability": 0.31},
#         "RCA": {"prediction": 0, "probability": 0.28},
#     }
# }
```

### `transformed_row(features: dict, target="cad") -> (np.ndarray, list[str])`

Returns the transformed feature vector and column names for a single patient.
The explainer inspects these names to choose the raw-input path for engineered
models or grouped transformed-input path for baseline models.

## model_info.py

### `model_info(directory: Path | None = None) -> dict`

Reads `metrics.json` and per-target `metadata.json` from the artifacts directory. Returns a consolidated metadata dict for the `/model-info` endpoint.

Raises `ValueError` if metrics and metadata disagree on test set size. New
metadata exposes `feature_set` and `engineered_features` per target; historical
metadata without `feature_set` keeps its original response shape.

### CLI

```bash
python training/model_info.py --output frontend/public/model-info.json
```

## Auto-generated API (mkdocstrings)

::: training.preprocessing

::: training.train

::: training.evaluate

::: training.inference

::: training.model_info

::: training.voting

::: training.native_models
