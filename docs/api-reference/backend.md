# Backend API reference

Rendered from docstrings in `backend/`. HTTP contract (endpoints, schemas,
errors): [API](../api.md). Explainability design:
[Explainability](../explainability.md).

## Module overview

| Module | Purpose | Key exports |
|---|---|---|
| `main.py` | FastAPI app factory, CORS, route mounting | `app`, `DISCLAIMER` |
| `schemas.py` | Pydantic input validation (54 fields) | `PatientInput`, `ExplainRequest` |
| `routes/predict.py` | `POST /predict` endpoint | `predict()` |
| `routes/explain.py` | `POST /explain` endpoint | `explain()` |
| `routes/model_info.py` | `GET /model-info`, `GET /input-defaults` | `get_model_info()`, `get_input_defaults()` |
| `services/predictor.py` | Thin re-export of training/inference | `available()`, `predict_patient()` |
| `services/input_validation.py` | Frozen-model accuracy with the submitted fields available | `input_validation()`, `wilson_interval()` |
| `services/explainer.py` | Permutation Shapley implementation | `explain_patient()`, `permutation_contributions()`, `feature_groups()` |

## main.py

### App factory

Creates the FastAPI application with:
- CORS middleware (`allow_origins=["*"]` for local development)
- Custom `RequestValidationError` handler (strips NaN/Infinity from error responses)
- Route mounting for predict, explain, and model-info routers

### `GET /health`

Returns service status, artifact availability, supported targets, and the medical disclaimer:

```json
{
  "status": "ok",
  "artifacts_loaded": true,
  "targets": ["cad", "lad", "lcx", "rca"],
  "disclaimer": "Clinical Safety Notice: this system is a machine-learning research..."
}
```

## schemas.py

### `PatientInput(BaseModel)`

54-field Pydantic model with CSV aliases. All fields are optional with explicit defaults.

**Configuration:**
- `populate_by_name=True` — accepts both Python field names and CSV aliases
- `extra="forbid"` — rejects unknown keys (including leakage labels)
- `allow_inf_nan=False` — rejects NaN/Infinity
- `validate_default=True` — validates default values too

**Field categories:**

| Category | Fields | Types |
|---|---|---|
| Demographic | Age, Weight, Length, Sex, BMI | float, Literal, float |
| History (binary) | DM, HTN, Current Smoker, EX-Smoker, FH | int (0/1) |
| History (Y/N) | Obesity, CRF, CVA, Airway disease, Thyroid Disease, CHF, DLP | Literal["Y","N"] |
| Exam | BP, PR, Edema, Weak Peripheral Pulse, Lung rales, Systolic/Diastolic Murmur | float, int, Y/N |
| Symptoms | Typical Chest Pain, Dyspnea, Function Class, Atypical, Nonanginal, LowTH Ang | int, Y/N, int (0-3) |
| ECG | Q Wave, St Elevation, St Depression, Tinversion, LVH, Poor R Progression, BBB | int, Y/N, Literal |
| Labs | FBS, CR, TG, LDL, HDL, BUN, ESR, HB, K, Na, WBC, Lymph, Neut, PLT | float/int |
| Echo | EF-TTE, Region RWMA, VHD | float, int (0-4), Literal |

**Validators:**
- `Sex`: normalizes `"Fmale"` → `"Female"` (mode="before")

**Methods:**
- `to_feature_dict() -> dict` — dumps using CSV aliases

### `ExplainRequest(BaseModel)`

| Field | Type | Default | Description |
|---|---|---|---|
| `features` | `PatientInput` | `PatientInput()` | Clinical measurements |
| `target` | `Literal["cad","lad","lcx","rca"]` | `"cad"` | Prediction target |
| `top_k` | `int` (1–60) | `10` | Number of top contributions |

## routes/predict.py

### `POST /predict`

**Input:** `PatientInput` (any subset of 54 fields)

**Behavior:**
1. Checks `available()` — returns 503 if artifacts missing
2. Calls `predict_patient()` with the feature dict
3. Identifies supplied fields from `PatientInput.model_fields_set`, using CSV aliases
4. Calls `input_validation()` with that field set, independently of patient values
5. Builds `context` with `effective_inputs`, `defaulted_inputs`, `input_validation`, and model identities
6. Returns the prediction result

**Error handling:**
- 503: Model artifacts not found
- 422: Inference failed (with error detail)
- Validation dataset/metadata failure: prediction can succeed with `input_validation.status = "unavailable"`

**Response context (abbreviated, with comments marking omitted entries):**

```jsonc
{
  "context": {
    "effective_inputs": {
      "Age": 66, "DM": 1
      // All 54 effective values are returned.
    },
    "defaulted_inputs": [
      "Weight", "Length"
      // All omitted input keys are returned.
    ],
    "input_validation": {
      "supplied_count": 2,
      "total_features": 54,
      "status": "available",
      "method": "held_out_default_substitution",
      "targets": {
        // CAD, LAD, LCX and RCA contain the metrics documented in API.
      }
    },
    "models": {
      "CAD": {"name": "CatBoost", "version": "<64-character SHA-256 hex digest>", "training_revision": "<saved revision>"}
      // LAD, LCX and RCA identities omitted.
    }
  }
}
```

## routes/explain.py

### `POST /explain`

**Input:** `ExplainRequest`

**Behavior:**
1. Checks `available()` — returns 503 if artifacts missing
2. Calls `explain_patient()` with features, target, and top_k
3. Adds `model_version` fingerprint to the response
4. Returns the explanation

**Error handling:**
- 503: Model artifacts not found
- 422: Explanation failed (with error detail)

## routes/model_info.py

### `GET /model-info`

Returns saved model identities, CV protocol, and held-out evaluation metrics.
Reads actual `metrics.json` and per-target `metadata.json` files.

**Error handling:**
- 503: Artifacts unavailable or metadata inconsistent

### `GET /input-defaults`

Returns all 54 input defaults using CSV aliases. Does not require model artifacts.

```json
{
  "Age": 58,
  "Weight": 74,
  "Sex": "Male",
  "DM": 0,
  ...
}
```

## services/predictor.py

Thin re-export module. Adds `training/` to `sys.path` and re-exports:

```python
from inference import available, predict_patient
```

This ensures there is exactly one implementation of cleaning, transformation,
and thresholding — the backend and training share the same code path.

## services/input_validation.py

### `input_validation(supplied: set[str]) -> dict`

Accepts supplied CSV feature names, not patient values. Restricts them to the
54 input allow-list and uses the current `PatientInput` defaults. For each target
it reconstructs the stratified holdout from cached artifact metadata, retains the
supplied columns' recorded values and defaults the remainder. Frozen inference
and the saved threshold produce classifications for comparison with known labels.

Returns counts plus `status: available`, method `held_out_default_substitution`,
and the four target metric objects. See the
[field definitions and unavailable response](../api.md#accuracy-with-available-inputs).
The current cohort has 61 test rows per target. The service computes all-input
accuracy on that same cohort for comparison; no fitting or writes to artifacts occur.

On missing resources or validation failure, logs the error and returns counts,
`status: unavailable`, and a generic `reason`. `method` and `targets` are omitted.
This failure does not prevent the route from returning patient predictions.

### Resources, identity and caching

- CSV: fixed repository path `dataset/dataset.csv`, preserving the original row order.
- Metadata: `csv_column`, `positive_label`, `random_state`, `test_size`, `n_train`,
  and `n_test` from the loaded artifact's `metadata` dictionary.
- Checks: label definitions, reconstructed split sizes, model version and threshold.
- Caches: one dataset revision, eight target/cohort entries, and 128 field-set results.
- Result cache keys: supplied fields, defaults, model versions, thresholds, split
  metadata, and dataset path/modification time/file size.

The dataset revision is a cache key, not a training-time content fingerprint.
The implementation cannot certify cohort identity from label definitions and
row counts alone. Alternate `ARTIFACTS_DIR` bundles must be compatible with the
same CSV. Restart after replacing cached model artifacts.

### `wilson_interval(correct: int, total: int) -> dict`

Returns `{low, high}` for the 95% Wilson interval, using `z = 1.959963984540054`.
The service calls it with a positive test sample count. Limits describe sampling
uncertainty in cohort accuracy, not individual prediction confidence. See
[the evaluation method](../evaluation.md#accuracy-with-available-inputs).

## services/explainer.py

### Constants

```python
BACKGROUND_ROWS = 16      # reference rows from training background
ORDER_PAIRS = 4           # forward/reverse order pairs per reference
SEED = 42                 # reproducible sampling
```

### `feature_groups(names: list[str]) -> dict[str, list[int]]`

Maps transformed names to original inputs for the baseline explanation path,
grouping all one-hot columns of a field. It also recognises single-source
`log1p_` names. Multi-source ratios/counts are not assigned to one arbitrary
source; `explain_patient()` uses raw-input permutations for any engineered set.

Example: `["Sex_Male", "Sex_Female"]` → `{"Sex": [0, 1]}`

### `RawPredictionModel(preprocessor, model)`

Probability adapter for engineered explanations. Converts raw object arrays
into a 54-column DataFrame, applies `clean_dataframe()` and the frozen
preprocessor, then calls the classifier. Every permutation step recalculates
all derived features consistently with the changed raw fields.

### `permutation_contributions(model, x, background, groups) -> (base, probability, contributions)`

Core Shapley computation:

1. For each reference row, sample `ORDER_PAIRS` random orderings + reverses
2. Walk from reference to patient, replacing one feature group at a time
3. Evaluate `predict_proba` for every step (batched)
4. Average marginal probability changes over all paths

Returns:
- `base_value`: mean prediction over reference rows
- `probability`: mean prediction at the patient's position
- `contributions`: Shapley value for each feature group

### `explain_patient(features, target="cad", top_k=10) -> dict`

Full explanation pipeline:

1. Load the target's frozen preprocessor/model and inspect transformed names.
2. If generated names are present, load `shap_raw_background.joblib` and use
   `RawPredictionModel` with singleton groups for the 54 raw fields.
3. Otherwise, load `shap_background.npz` and group transformed columns by input.
4. Sample up to 16 reference rows with seed 42.
5. Run `permutation_contributions()` with eight paths per reference.
6. Select top-k by absolute contribution; sum omitted contributions as the residual.
7. Return probability-space contributions with raw field names and values.

A missing raw background raises `ValueError`; the route reports an explanation
failure as HTTP 422. It does not substitute a transformed background for an
engineered model. Cached backgrounds and models require a restart when replaced.

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `target` | str | Uppercase target key |
| `base_value` | float | Mean prediction over reference rows |
| `probability` | float | Final model prediction |
| `signed` | bool | Always `true` |
| `method` | str | Always `"permutation_shapley"` |
| `output_space` | str | Always `"probability"` |
| `approximate` | bool | Always `true` |
| `background_rows` | int | Number of reference rows used |
| `permutations_per_background` | int | `ORDER_PAIRS * 2` = 8 |
| `remaining_contribution` | float | Sum of omitted contributions |
| `note` | str | Method description and limitations |
| `features` | list[dict] | `name`, `value`, `raw_value`, `contribution` for each selected raw field |

The route adds `model_version`. The frontend derives default badges from the
assessment context; the explanation response does not have a `defaulted` field.

## Auto-generated API (mkdocstrings)

::: backend.main

::: backend.schemas

::: backend.services.predictor

::: backend.services.input_validation

::: backend.services.explainer

::: backend.routes.predict

::: backend.routes.explain

::: backend.routes.model_info
