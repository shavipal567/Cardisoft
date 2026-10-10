# Training API reference

Rendered from docstrings in `training/`. Prose documentation:
[Models](../models.md), [Preprocessing](../preprocessing.md),
[Evaluation](../evaluation.md).

## Module overview

| Module | Purpose | Key exports |
|---|---|---|
| `preprocessing.py` | Constants, cleaning, preprocessor builders | `LEAKAGE_COLUMNS`, `ALL_INPUT_FEATURES`, `clean_dataframe()`, `build_preprocessor()`, `build_native_preprocessor()`, `split_features_target()` |
| `train.py` | Repeated-CV model selection + artifact saving | `train_target()`, `repeated_cv_scores()`, `make_configs()`, `build_estimator()` |
| `evaluate.py` | Held-out test evaluation | `evaluate_target()` |
| `inference.py` | Frozen artifact loading + prediction | `predict_patient()`, `transformed_row()`, `get_artifact()`, `available()` |
| `model_info.py` | Metrics/metadata export for API | `model_info()` |
| `stacking.py` | Stacked ensemble (OOF + LogReg meta) | `StackedModel` |
| `voting.py` | Soft voting ensemble with weight/threshold optimization | `VotingClassifier`, `build_voting_estimators()`, `optimize_voting_weights_and_threshold()` |
| `native_models.py` | CatBoost adapter with int-cast I/O | `CatBoostNative` |

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

### `build_preprocessor() -> ColumnTransformer`

One-hot track for RF/XGB/HGB/Stack. Returns a `ColumnTransformer` producing **81 output columns**:

- `num` (33 cols): `SimpleImputer(median)` → `RobustScaler`
- `cat` (21 cols): `SimpleImputer(most_frequent)` → `OneHotEncoder(handle_unknown="ignore")`

### `build_native_preprocessor() -> ColumnTransformer`

Native-categorical track for LightGBM/CatBoost. Returns a `ColumnTransformer` producing **54 output columns**:

- `num` (33 cols): same as one-hot track
- `cat` (21 cols): `SimpleImputer(most_frequent)` → `OrdinalEncoder(unknown=-1)`

Output order: `[NUMERIC_FEATURES..., NATIVE_CAT_FEATURES...]`

### `native_cat_indices() -> list[int]`

Returns `[33, 34, ..., 53]` — column positions of categorical codes in native-track output. Passed as `categorical_feature` (LGBM) or `cat_features` (CatBoost).

### `encode_target(series: pd.Series, positive: str) -> pd.Series`

Converts labels to binary: `(series == positive).astype(int)`

### `split_features_target(df, target_column, positive) -> (X, y)`

Drops leakage columns + target + zero-variance columns, keeps only `ALL_INPUT_FEATURES`, returns `(X, y)`.

### `get_output_feature_names(preprocessor) -> list[str]`

Returns transformed column names via `preprocessor.get_feature_names_out()`.

## train.py

### `make_configs(y_train) -> (configs, scale_pos)`

Builds all 32 configurations for a target. `scale_pos` is the `scale_pos_weight` ratio for XGBoost.

| Model | Track | Grid |
|---|---|---|
| RF | onehot | `n_estimators` × `max_depth` × `min_samples_leaf` = 2×2×2 = 8 |
| XGB | onehot | `n_estimators` × `max_depth` × `learning_rate` = 2×2×2 = 8 |
| HGB | onehot | `max_leaf_nodes` × `min_samples_leaf` = 2×2 = 4 |
| LGBM | native | `num_leaves` × `min_child_samples` = 3×2 = 6 |
| CatBoost | native | `depth` × `l2_leaf_reg` = 2×2 = 4 |
| Stack | onehot | 1 (RF+XGB+HGB → LogReg) |
| Vote | voting | 1 (RF+XGB+HGB+LGBM+CatBoost+ElasticNet → soft vote) |

### `build_estimator(kind, params, scale_pos) -> classifier`

Factory that constructs the appropriate sklearn/LGBM/CatBoost estimator with the given hyperparameters.

### `repeated_cv_scores(cfg, X_train, y_train, scale_pos, seeds) -> dict`

Runs repeated stratified 5-fold CV. Returns:

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

### `stability_jaccard(kind, params, scale_pos, prep, X_train, y_train, seeds, k=10) -> float`

Mean pairwise Jaccard similarity of top-k feature importance sets across repeat seeds. Returns NaN if the estimator lacks `feature_importances_`.

### `train_target(key, df, repeats) -> dict`

Full training pipeline for one target:

1. `split_features_target()` → stratified 80/20 split (seed 42)
2. `make_configs()` → 32 configs
3. `repeated_cv_scores()` for each config (10 repeats × 5 folds)
4. Select winner by mean CV ROC-AUC (tie-break F1)
5. `stability_jaccard()` for the winner
6. Refit winner on full 242-row train split
7. Save artifacts: `preprocessor.joblib`, `model.joblib`, `shap_background.npz`, `metadata.json`

### `main(targets, repeats)`

Entry point. Reads `dataset/dataset.csv`, calls `train_target()` for each target.

```bash
python training/train.py                              # all 4 targets, 10 repeats (~2h CPU)
python training/train.py --targets cad --repeats 2    # fast smoke test
```

## evaluate.py

### `evaluate_target(key, df) -> dict`

Rebuilds the identical stratified split (same seed) and scores frozen artifacts:

```python
{
    "target": "cad",
    "n_test": 61,
    "pos_rate": 0.689,
    "accuracy": 0.852,
    "precision": 0.870,
    "recall": 0.930,
    "f1": 0.899,
    "roc_auc": 0.893,
    "confusion_matrix": {"tn": 12, "fp": 6, "fn": 3, "tp": 40},
}
```

### `main()`

Evaluates all four targets and writes `training/artifacts/metrics.json`.

```bash
python training/evaluate.py
```

## inference.py

### `artifacts_dir() -> Path`

Returns `ARTIFACTS_DIR` env var or default `training/artifacts/`.

### `available() -> bool`

Returns `True` iff all four artifact directories load successfully.

### `get_artifact(target: str) -> dict`

Returns the cached frozen preprocessor/model for one target:

```python
{
    "prep": ColumnTransformer,       # fitted preprocessor
    "model": classifier,             # fitted model
    "version": "sha256:...",        # fingerprint of prep + model bytes
    "training_git_hash": "abc123",   # git hash from training time
    "model_kind": "cat",              # model family key
}
```

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

Returns the transformed feature vector and column names for a single patient. Used by the explainer.

## model_info.py

### `model_info(directory: Path | None = None) -> dict`

Reads `metrics.json` and per-target `metadata.json` from the artifacts directory. Returns a consolidated metadata dict for the `/model-info` endpoint.

Raises `ValueError` if metrics and metadata disagree on test set size.

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
