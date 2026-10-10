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
3. Builds `context` with `effective_inputs`, `defaulted_inputs`, and model identities
4. Returns the prediction result

**Error handling:**
- 503: Model artifacts not found
- 422: Inference failed (with error detail)

**Response context:**
```json
{
  "context": {
    "effective_inputs": {"Age": 66, "DM": 1, ...},
    "defaulted_inputs": ["Weight", "Length", ...],
    "models": {
      "CAD": {"name": "CatBoost", "version": "sha256:abc123...", "training_revision": "def456"},
      "LAD": {"name": "Random Forest", "version": "sha256:...", "training_revision": "def456"}
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

## services/explainer.py

### Constants

```python
BACKGROUND_ROWS = 16      # reference rows from training background
ORDER_PAIRS = 4           # forward/reverse order pairs per reference
SEED = 42                 # reproducible sampling
```

### `feature_groups(names: list[str]) -> dict[str, list[int]]`

Maps transformed column names to whole original features. One-hot columns are grouped back to their source categorical input.

Example: `["Sex_Male", "Sex_Female"]` → `{"Sex": [0, 1]}`

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

1. Load the target's frozen model
2. Transform the patient's features
3. Load and sample the background
4. Compute feature groups
5. Run `permutation_contributions()`
6. Select top-k by absolute contribution
7. Build the response dict with additivity contract

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
| `features` | list[dict] | Top-k features with values and contributions |

## Auto-generated API (mkdocstrings)

::: backend.main

::: backend.schemas

::: backend.services.predictor

::: backend.services.explainer

::: backend.routes.predict

::: backend.routes.explain

::: backend.routes.model_info
