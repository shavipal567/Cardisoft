# API

FastAPI serves frozen saved models. See `backend/README.md` for run instructions
and `backend/schemas.py` or `/openapi.json` for the complete validation schema.

## Base URL

Development: `http://127.0.0.1:8000` (proxied through Vite at `/api`).
Production: configure via reverse proxy or `VITE_API_URL` build-time variable.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Availability and disclaimer; always 200 |
| GET | `/model-info` | Saved model names and held-out evaluation metadata |
| GET | `/input-defaults` | All 54 input defaults using CSV aliases |
| POST | `/predict` | Four predictions, input provenance and measured accuracy for the supplied fields |
| POST | `/explain` | Signed, approximate patient-specific Shapley contributions |

## POST /predict

Accepts any subset of the 54 raw clinical inputs using CSV aliases. Derived
ratios, counts and logs are computed inside the saved preprocessor and are not
request fields. Omitted inputs use explicit defaults. An empty object `{}` is valid.

### Request

```json
{
  "Age": 66,
  "Weight": 80,
  "Sex": "Male",
  "Typical Chest Pain": 1,
  "DM": 1,
  "HTN": 0,
  "FBS": 120,
  "EF-TTE": 55,
  "Region RWMA": 0
}
```

### Response

Abbreviated example; probabilities illustrate the shape. Comments identify
omitted entries. The actual response includes all 54 effective inputs, every
defaulted key, and all four model identities.

Each target now also includes `threshold`, the exact probability cutoff used by
inference (`prediction = int(probability >= threshold)`). Existing prediction
fields are unchanged. `context.input_signature` fingerprints the effective
inputs and supplied field names; `context.feature_provenance` maps each raw
feature to `{status, method, detail}`. Current statuses are `recorded` with
`explicit_input` and `default` with `schema_default`. Neither asserts that a
measurement was clinically verified.

```jsonc
{
  "cad": {"prediction": 1, "probability": 0.87},
  "vessels": {
    "LAD": {"prediction": 1, "probability": 0.72},
    "LCX": {"prediction": 0, "probability": 0.31},
    "RCA": {"prediction": 0, "probability": 0.28}
  },
  "context": {
    "effective_inputs": {
      "Age": 66,
      "DM": 1,
      "PR": 70
      // Remaining supplied values and server defaults omitted.
    },
    "defaulted_inputs": [
      "PR", "BMI"
      // Remaining omitted input keys omitted from this example.
    ],
    "models": {
      "CAD": {
        "name": "CatBoost",
        "version": "<64-character SHA-256 hex digest>",
        "training_revision": "<saved training revision>"
      }
      // LAD, LCX and RCA identities omitted.
    },
    "input_validation": {
      "supplied_count": 9,
      "total_features": 54,
      "status": "available",
      "method": "held_out_default_substitution",
      "targets": {
        // CAD, LAD, LCX and RCA each contain the metric fields below.
      }
    }
  }
}
```

### Validation rules

- **Explicit nulls, unknown keys (including leakage labels), invalid categories,
  non-finite numbers, and out-of-range values** return 422
- Binary flags require integer `0` or `1`
- `Sex` accepts `Male`/`Female` (and normalizes legacy `Fmale`)
- Y/N fields, BBB, and VHD have enumerated values
- Function Class accepts 0–3; Region RWMA accepts 0–4
- LDL accepts 10–300 mg/dL (including the dataset's value of 18)
- Numeric acceptance limits are software input limits, not clinical reference ranges

### Accuracy with available inputs

`context.input_validation` contains `supplied_count`, `total_features`, and a
`status` of `available` or `unavailable`. Available results use method
`held_out_default_substitution`. The keys in `targets` are `CAD`, `LAD`, `LCX`
and `RCA`. Each target contains:

| Field | Type | Meaning |
|---|---|---|
| `accuracy` | number, 0–1 | `correct / n_test` after defaulting omitted fields |
| `correct` | integer | Number of correct positive or negative classifications |
| `n_test` | integer | Held-out records for this target; currently 61 |
| `accuracy_interval` | `{low: number, high: number}` | 95% Wilson limits as fractions |
| `recall` | number or null | Detected positives / known positives; null if there are none |
| `full_input_accuracy` | number, 0–1 | Accuracy on the same records with all recorded fields available |
| `majority_baseline` | number, 0–1 | Fraction correctly classified by always predicting the more common class |
| `model_version` | string | Same fingerprint as `context.models[TARGET].version` |

Scores retain the same supplied fields on held-out cohort records and substitute
server defaults for omitted fields. They depend on the field set, not the current
patient's values, and do not estimate whether an individual prediction is correct.
No training or threshold selection occurs. Missing validation resources return
`status: unavailable` plus `reason`; the prediction itself remains available.

For example, this is a complete unavailable validation object for a submission
with two supplied fields:

```json
{
  "supplied_count": 2,
  "total_features": 54,
  "status": "unavailable",
  "reason": "Accuracy could not be evaluated for the loaded models and validation dataset."
}
```

`method` and `targets` are absent in this state. This does not turn an otherwise
successful prediction into an HTTP error. Clients must also handle older servers
that omit `input_validation` entirely. Demo fixtures have no live validation score.
See [calculation and limitations](evaluation.md#accuracy-with-available-inputs).

### curl example

```bash
curl -X POST localhost:8000/predict \
  -H 'Content-Type: application/json' \
  -d '{"Age": 66, "Typical Chest Pain": 1, "DM": 1}'
```

## POST /explain

Computes approximate grouped permutation Shapley values for a specific patient
and target. Engineered models vary raw inputs and recompute all dependent
features on each permutation step. Baseline models use grouped transformed
inputs. Both paths return contributions for the original clinical fields.

Compatible explanation extensions include `input_signature`, per-feature
`provenance`, `output_value`, `explained_class`, `total_features`,
`baseline_definition`, `additivity_tolerance`, and optional saved `reliability`
metadata. `model_version` and `input_signature` should match the corresponding
prediction context. Contributions remain in `output_space: "probability"`;
clients multiply them by 100 only when displaying percentage points. Reliability
includes only available saved metrics and explicitly distinguishes selection-CV
Brier scores from held-out results. See [the explanation guide](explainability.md).

### Request

```json
{
  "features": {"Age": 66, "Typical Chest Pain": 1, "DM": 1},
  "target": "cad",
  "top_k": 10
}
```

| Field | Type | Description |
|---|---|---|
| `features` | object | Any subset of the 54 clinical inputs |
| `target` | string | One of: `cad`, `lad`, `lcx`, `rca` |
| `top_k` | integer | Number of top contributions to return (1–60) |

### Response

```json
{
  "target": "CAD",
  "method": "permutation_shapley",
  "signed": true,
  "approximate": true,
  "output_space": "probability",
  "base_value": 0.65,
  "probability": 0.87,
  "features": [
    {"name": "Typical Chest Pain", "value": 1, "raw_value": 1, "contribution": 0.12},
    {"name": "DM", "value": 1, "raw_value": 1, "contribution": 0.08},
    {"name": "Age", "value": 66, "raw_value": 66, "contribution": 0.05},
    {"name": "BMI", "value": 26.8, "raw_value": 26.8, "contribution": -0.03}
  ],
  "remaining_contribution": 0.0,
  "background_rows": 16,
  "permutations_per_background": 8,
  "model_version": "<64 hexadecimal characters>",
  "note": "Grouped permutation Shapley approximation. Contributions are in probability units."
}
```

Numbers above are illustrative. `value` and `raw_value` contain the effective
raw value passed to the explainer, including defaults applied by the HTTP
schema. The response does not include a `defaulted` flag; the frontend marks
defaulted contributions using the assessment input context.

### Additivity contract

```text
base_value + sum(features[].contribution) + remaining_contribution = probability
```

At `top_k=60` all 54 original features are returned and the residual is zero.
The chart displays only eight of those. Additivity holds within numerical
precision. `base_value` is the mean prediction on sampled training references,
not the disease prevalence.

### curl example

```bash
curl -X POST localhost:8000/explain \
  -H 'Content-Type: application/json' \
  -d '{"target":"cad","features":{"Age":66,"Typical Chest Pain":1},"top_k":10}'
```

## GET /model-info

Returns saved model identities, CV protocol, and held-out evaluation metrics
from the configured artifact directory. Reads actual `metrics.json` and
per-target `metadata.json` files — no demo values are substituted.

New training metadata adds `feature_set` and `engineered_features` to each
target. Historical artifacts omit those fields and retain their original
response shape. This endpoint describes saved artifacts, not current training
defaults. Missing artifacts or evaluation metadata produce 503.

### curl example

```bash
curl localhost:8000/model-info
```

## GET /health

Returns service status, artifact availability, supported targets, and the
medical disclaimer. Always returns 200 when the service is up. Artifact
availability checks that model/preprocessor pairs load; it does not verify
explanation backgrounds or the evaluation dataset.

## Error codes

| Code | Meaning |
|---|---|
| 422 | Invalid request, or explanation failure such as a missing required background |
| 503 | Missing model artifacts or evaluation metadata |

## CORS and deployment

CORS is open for the local prototype. Before deployment:
- Restrict CORS to your frontend origin
- Route `/api/*` to FastAPI with `/api` stripped, or set `VITE_API_URL`
- Authentication, persistence, and rate limiting are not implemented

The frontend defaults to live calls through `/api` (Vite development proxy).
Production needs a reverse proxy or an explicitly configured API origin.
Mock mode is opt-in and visibly labelled; failed live requests never return mock results.
`ARTIFACTS_DIR` overrides artifact location.
