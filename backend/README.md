# Backend — Cardisoft prediction API

FastAPI serves frozen preprocessors and models from `training/artifacts/`.
No model fitting occurs in HTTP handlers. `ARTIFACTS_DIR` can select another
artifact directory; restart the service after replacing artifacts because
models and explanation backgrounds are cached.

```bash
pip install -r backend/requirements.txt
cd backend
uvicorn main:app --host 127.0.0.1 --port 8000
```

## Endpoints

| Endpoint | Behavior |
|---|---|
| `GET /health` | Liveness, artifact availability, targets and disclaimer; always 200 |
| `GET /model-info` | Saved model names, CV protocol and held-out metrics from the configured artifact directory |
| `GET /input-defaults` | All 54 input defaults using CSV aliases; does not require model artifacts |
| `POST /predict` | Validated measurements → `{cad, vessels: {LAD, LCX, RCA}, context}`; each estimate has `prediction` and `probability` |
| `POST /explain` | `{features, target, top_k}` → patient-specific grouped permutation Shapley estimates |

Predict accepts CSV aliases such as `Current Smoker` and `EF-TTE`, or the
Python field names. Omitted fields receive explicit defaults from `schemas.py`.
An empty object is valid. Explicit nulls, extra keys (including target labels),
non-finite values and invalid categories return 422. This intentionally replaces
the old silent-ignore behavior for unknown keys.

Prediction `context` records `effective_inputs`, `defaulted_inputs`, and model
identities for the completed assessment. Each model identity includes its name,
training revision when available, and a SHA-256 `version` fingerprint of the
loaded preprocessor and model bytes. Explicit zero values count as supplied.

Binary flags require integer 0/1. Sex accepts Male/Female and normalizes the
legacy dataset spelling Fmale. Y/N fields, BBB and VHD have enumerated values;
Function Class accepts 0–3 and Region RWMA 0–4. Numeric acceptance limits are
published in `/docs` and `/openapi.json`. They are software input limits, not
clinical reference ranges. The nine form measurements use the same limits as
the frontend. LDL accepts 10–300 mg/dL, including the dataset's value of 18.
Other labs reject negative values; differential percentages stay within 0–100.

```bash
curl localhost:8000/health
curl localhost:8000/model-info
curl -X POST localhost:8000/predict -H 'Content-Type: application/json' -d '{}'
curl -X POST localhost:8000/explain -H 'Content-Type: application/json' \
  -d '{"target":"cad","features":{"Age":66,"Typical Chest Pain":1},"top_k":10}'
```

## Explanation contract

`target` accepts cad/lad/lcx/rca; `top_k` accepts 1–60. The response includes:

- `method: permutation_shapley`, `signed: true`, `approximate: true`.
- `output_space: probability`, `base_value`, and the patient's `probability`.
- `features`: original clinical names, raw values and signed contributions.
- `remaining_contribution`: sum of omitted contributions after top-k selection.
- `background_rows`, `permutations_per_background` and a method/limitations note.
- `model_version`: the loaded model fingerprint, allowing reports to reject
  explanations from a different model than the recorded prediction.

`base_value + sum(returned contributions) + remaining_contribution` equals
`probability` within floating-point tolerance. Contributions are approximate,
not exact TreeSHAP, and describe model behavior rather than causes. They use
16 seeded rows from the frozen training background and 4 forward/reverse order
pairs per row. One-hot columns for a categorical input always move together.
NumPy and the model's `predict_proba` are sufficient, including CatBoostNative.
Failures are reported, never replaced with global importance rankings.

## Model information

`training/model_info.py` reads `metrics.json` and each target's `metadata.json`.
`/model-info` returns the saved family for each target, held-out accuracy,
precision, recall, F1, ROC-AUC, confusion counts, CV scores and split sizes.
`positive_rate` is the test-set prevalence, matching the displayed baseline.
Missing artifacts or evaluation metadata produce 503; no demo values are substituted.

## Runtime and checks

ML versions in `requirements.txt` match training for artifact compatibility.
Explanations do not depend on shap, numba, or coverage. CORS is open for local
prototype integration; authentication, rate limiting and persistence are absent.

```bash
pip install -r backend/requirements-test.txt
python -m unittest discover -s backend/tests -v
```

Validation errors return 422; missing models return 503. Model execution failures
currently return 422 with an error detail. `/health` only verifies prediction
artifacts, not the separate explanation background or evaluation metadata.
The service is research/decision support, not clinical diagnosis.
