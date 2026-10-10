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
| POST | `/predict` | Four binary predictions and probabilities |
| POST | `/explain` | Signed, approximate patient-specific Shapley contributions |

## POST /predict

Accepts any subset of the 54 clinical inputs using CSV aliases. Omitted inputs
use explicit defaults. An empty object `{}` is valid.

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

```json
{
  "cad": {"prediction": 1, "probability": 0.87},
  "vessels": {
    "LAD": {"prediction": 1, "probability": 0.72},
    "LCX": {"prediction": 0, "probability": 0.31},
    "RCA": {"prediction": 0, "probability": 0.28}
  },
  "context": {
    "effective_inputs": 9,
    "defaulted_inputs": 45,
    "models": {
      "cad": {"name": "CatBoostNative", "version": "sha256:abc123..."},
      "lad": {"name": "RandomForestClassifier", "version": "sha256:def456..."}
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

### curl example

```bash
curl -X POST localhost:8000/predict \
  -H 'Content-Type: application/json' \
  -d '{"Age": 66, "Typical Chest Pain": 1, "DM": 1}'
```

## POST /explain

Computes approximate grouped permutation Shapley values for a specific patient
and target.

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
  "method": "permutation_shapley",
  "signed": true,
  "approximate": true,
  "output_space": "probability",
  "base_value": 0.65,
  "probability": 0.87,
  "features": [
    {"feature": "Typical Chest Pain", "value": 1, "contribution": 0.12},
    {"feature": "DM", "value": 1, "contribution": 0.08},
    {"feature": "Age", "value": 66, "contribution": 0.05},
    {"feature": "BMI", "value": null, "defaulted": true, "contribution": -0.03}
  ],
  "remaining_contribution": 0.0,
  "background_rows": 16,
  "permutations_per_background": 4,
  "model_version": "sha256:abc123...",
  "note": "Grouped permutation Shapley approximation. Contributions are in probability units."
}
```

### Additivity contract

```text
base_value + sum(features[].contribution) + remaining_contribution = probability
```

At `top_k=60` all 54 original features are returned and the residual is zero.
The chart displays only eight of those.

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

Missing artifacts or evaluation metadata produce 503.

### curl example

```bash
curl localhost:8000/model-info
```

## GET /health

Returns service status, artifact availability, supported targets, and the
medical disclaimer. Always returns 200 when the service is up.

## Error codes

| Code | Meaning |
|---|---|
| 422 | Validation error (invalid input, unknown key, out-of-range value) |
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
