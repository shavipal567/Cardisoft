# Backend — Cardisoft prediction API

FastAPI service exposing the frozen models trained in `training/`.
This folder **never trains or fits anything**: it loads
`training/artifacts/*/` (preprocessor + model per target) and serves
predictions + explanations over REST/JSON (PROBLEM.md §§22–23).

Related docs: `../PROBLEM.md`, `../training/README.md` (artifact contract),
`./requirements.txt` (`fastapi==0.141.1`, `uvicorn==0.53.0`,
`pydantic==2.13.5`, plus `scikit-learn==1.7.2` / `xgboost==3.2.0` /
`lightgbm==4.6.0` / `catboost==1.2.10` / `pandas==2.2.3` / `numpy==1.26.4` /
`joblib==1.5.3` — must match training's pins so `model.joblib` unpickles,
including the `CatBoostNative` adapter in `training/native_models.py`, which
resolves via the existing `sys.path` bootstrap).

## 1. Layout

```text
backend/
├── main.py              # FastAPI app, CORS (*), GET /health, router wiring, DISCLAIMER
├── schemas.py           # PatientInput (54 fields, CSV aliases, defaults), ExplainRequest
├── routes/
│   ├── __init__.py
│   ├── predict.py       # POST /predict -> 503 if artifacts missing, 422 on inference error
│   └── explain.py       # POST /explain -> same error contract
├── services/
│   ├── __init__.py
│   ├── predictor.py     # thin re-export of training/inference.py (predict_patient, available)
│   └── explainer.py     # SHAP TreeExplainer w/ gain-importance fallback
├── requirements.txt
└── README.md
```

Data flow:

```text
HTTP JSON -> PatientInput (validate/coerce/defaults) -> to_feature_dict()
  -> training/inference.predict_patient() [frozen prep+model per target]
  -> {cad, vessels{LAD,LCX,RCA}}  (+ explainer for /explain)
```

## 2. Endpoints

### `GET /health`

Liveness + artifact status + safety text. Always 200, even without artifacts.

```json
{
  "status": "ok",
  "artifacts_loaded": true,
  "targets": ["cad", "lad", "lcx", "rca"],
  "disclaimer": "Clinical Safety Notice: ..."
}
```

### `POST /predict`

Accepts any subset of the 54 input fields (see §3); missing fields fall back to
per-field defaults and the frozen preprocessor's median/most-frequent
imputation. Unknown leakage keys (`LAD/LCX/RCA/Cath`) are silently ignored —
the preprocessor has no such inputs. Threshold is 0.5 for all four heads.

Request (partial is fine):

```json
{"Age": 66, "Sex": "Female", "BP": 100, "Typical Chest Pain": 0, "EF-TTE": 55}
```

Response (PROBLEM.md §23 schema):

```json
{
  "cad": {"prediction": 1, "probability": 0.73},
  "vessels": {
    "LAD": {"prediction": 1, "probability": 0.81},
    "LCX": {"prediction": 0, "probability": 0.34},
    "RCA": {"prediction": 1, "probability": 0.56}
  }
}
```

Observed examples (v2 artifacts): empty body `{}` (schema defaults) → CAD 0.124 /
LAD 0.493 / LCX 0.296 / RCA 0.391; a real CAD dataset row → CAD **0.945**, a
real Normal row → CAD **0.011**. (Calling `predict_patient({})` in-process
with all-`None` inputs is a different input — imputer medians/modes rather
than schema defaults — and scores higher; the API path above is the
reference behavior.)

### `POST /explain`

```json
{"features": {"Age": 66, "Typical Chest Pain": 1}, "target": "cad", "top_k": 10}
```

- `target`: `cad | lad | lcx | rca` (validated by regex; anything else → 422
  from request validation).
- `top_k`: 1–60, default 10.

Response (PROBLEM.md §23 `/explain` shape, plus `method`/`note`/`probability`):

```json
{
  "target": "CAD",
  "base_value": 0.7148,
  "probability": 0.545,
  "method": "gain_importance_fallback",
  "note": "SHAP unavailable ... (model behavior, not causality).",
  "features": [
    {"name": "num__Typical Chest Pain", "value": -1.0, "contribution": 0.1199, "raw_value": 0}
  ]
}
```

Field semantics:

- `base_value` — SHAP mode: model's expected value over the background sample;
  fallback mode: train positive rate (e.g. CAD 0.7149).
- `features[].name` — post-transform name (`num__Age`, `cat__Sex_Male`, …; 81
  total). Fallback entries also carry `raw_value` (pre-transform patient value).
- `contribution` — SHAP mode: additive shift of this patient's output (sums to
  `probability − base_value`); fallback mode: normalized `feature_importances_`
  weight (sums to 1, **not** additive — read it as ranking, not attribution).
- `method` tells you which you got: `shap_tree` or
  `gain_importance_fallback`. Either way, contributions describe the **model**,
  never a diagnosis or a cause (PROBLEM.md §§20–21 wording enforced in `note`).

## 3. Input schema (`schemas.py`)

`PatientInput`: all 54 usable CSV columns, every field optional with a
median/mode default, so `{}` is a valid body. Pydantic aliases preserve the
exact CSV spellings — when calling with `curl`, use the alias:

| CSV field (alias) | type | default | notes |
|---|---|---|---|
| Age / Weight / Length / BMI | float | 58 / 74 / 165 / 26.8 | medians |
| Sex | str | Male | `Fmale` auto-corrected → `Female` |
| DM / HTN / Current Smoker / EX-Smoker / FH | int 0/1 | 0 | binaries |
| Obesity | Y/N | Y (mode) | overlaps BMI; kept as-is |
| CRF / CVA / Airway disease / Thyroid Disease / CHF / DLP | Y/N | N | CHF n=1, CRF/CVA sparse |
| BP / PR | float | 130 / 70 | systolic presumed; bpm |
| Edema | int 0/1 | 0 | |
| Weak Peripheral Pulse / Lung rales / Systolic Murmur / Diastolic Murmur | Y/N | N | sparse vascular/HF signs |
| Typical Chest Pain | int 0/1 | 0 | classic angina flag |
| Dyspnea / Atypical / Nonanginal / LowTH Ang | Y/N | N | LowTH Ang n=2 |
| Function Class | int 0–3 | 0 | NYHA-like; class 1 has n=1 |
| Q Wave / St Elevation / St Depression / Tinversion | int 0/1 | 0 | ECG ischemia markers |
| LVH / Poor R Progression / BBB (N/LBBB/RBBB) | str | N | |
| FBS / CR / TG / LDL / HDL / BUN / ESR / HB / K / Na / WBC / Lymph / Neut / PLT | float | 98 / 1.0 / 122 / 100 / 39 / 16 / 15 / 13.2 / 4.2 / 141 / 7100 / 32 / 60 / 210 | lab medians |
| EF-TTE | float | 50 | echo LV function % |
| Region RWMA | int 0–4 | 0 | sent as int, treated as category |
| VHD | str | mild (mode) | N/mild/Moderate/Severe |

`to_feature_dict()` strips the Pythonic field names and returns only CSV-aliased
keys, which is what `training/inference.py` expects.

## 4. Status codes & errors

| code | when | body |
|---|---|---|
| 200 | success (`/health` always; `/predict`, `/explain` with artifacts) | payload |
| 422 | request validation fails (bad `target`, wrong types) **or** inference/explain raises | `{"detail": "Inference failed: ..."}` / `{"detail": "Explanation failed: ..."}` |
| 503 | `training/artifacts/*` missing or unloadable (train first) | `{"detail": "Model artifacts not found. Run training/train.py first."}` |

`/health.artifacts_loaded` is the pre-flight check: `false` means predict/explain
will 503.

## 5. Configuration

- `ARTIFACTS_DIR` — artifact root, default `<repo>/training/artifacts/`. Set it
  when deploying (e.g. Docker volume): `ARTIFACTS_DIR=/models uvicorn main:app`.
- CORS is fully open (`allow_origins=["*"]`) for hackathon demo purposes;
  restrict it before any networked deployment.
- No auth, no rate limiting, no persistence — stateless inference only.

## 6. Run & verify

```bash
pip install -r backend/requirements.txt
# from repo root, first (one time): python training/train.py
cd backend && uvicorn main:app --host 0.0.0.0 --port 8000
```

Smoke tests:

```bash
curl localhost:8000/health
curl -X POST localhost:8000/predict -H 'Content-Type: application/json' -d '{}'
curl -X POST localhost:8000/predict -H 'Content-Type: application/json' \
  -d '{"Age": 66, "BP": 100, "Typical Chest Pain": 0}'
curl -X POST localhost:8000/explain -H 'Content-Type: application/json' \
  -d '{"target":"cad","top_k":3}'
```

Or in-process (no server):

```python
from fastapi.testclient import TestClient
from main import app
c = TestClient(app)
c.get("/health").json()
c.post("/predict", json={}).json()
```

## 7. Troubleshooting

- **503 on predict/explain** → artifacts absent. Run `python training/train.py`
  from the repo root (or point `ARTIFACTS_DIR` at a copy). Confirm
  `training/artifacts/{cad,lad,lcx,rca}/model.joblib` exist (~7.9M total).
- **`method: gain_importance_fallback`** → the installed `shap` build fails to
  import (observed: `numba` vs `coverage` conflict, `AttributeError` on
  `coverage.types`). The API stays up and labels the fallback; to get true
  SHAP, pin a compatible `shap`/`numba`/`coverage` trio and reinstall
  (`shap` is intentionally commented out in `requirements.txt` until then).
- **`No module named 'inference'`** → only if the `sys.path` bootstrap in
  `services/*.py` is disturbed; services import training code via
  `<repo>/training` on `sys.path`, and there is intentionally no
  `backend/__init__.py`, so run uvicorn from inside `backend/`.
- **Unpickle errors after upgrading sklearn/xgboost/lightgbm/catboost** →
  artifact versions must match runtime versions; reinstall from the two
  `requirements.txt` files (both pin the same ML stack).

## 8. Safety (PROBLEM.md §§26–27)

Every `/health` response carries the disclaimer: research/decision-support
prototype for education and demonstration; predictions are not a diagnosis and
must not substitute for clinical assessment, imaging, or professional advice.
Vessel probabilities are statistical context per named vessel — never lesion
localization, severity measurement, or anatomical reconstruction. Explanations
are model attributions, not causal claims.
