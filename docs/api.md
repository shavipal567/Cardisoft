# API

Service: `backend/` (FastAPI). Stateless inference over frozen artifacts from
`training/artifacts/`. Full reference in `backend/README.md`; this page is the
short contract.

## Endpoints

| Method + path | Purpose | Errors |
|---|---|---|
| `GET /health` | liveness, `artifacts_loaded`, targets, disclaimer (always 200) | — |
| `POST /predict` | 4-head probabilities (`{cad, vessels{LAD,LCX,RCA}}`), threshold 0.5 | 503 no artifacts; 422 inference failure |
| `POST /explain` | per-head attribution (`{target, base_value, probability, method, features[]}`) | 503 no artifacts; 422 bad target/explain failure |

## Requests

- `/predict` body: any subset of the 54 CSV-aliased fields (`"Current Smoker"`,
  `"EF-TTE"`, `"Region RWMA"`, …). `{}` is valid — defaults + frozen
  imputation fill the rest. Leakage keys are ignored.
- `/explain` body: `{"features": {...}, "target": "cad|lad|lcx|rca", "top_k": 1–60}`.

## Examples

```bash
cd backend && uvicorn main:app --host 0.0.0.0 --port 8000
curl localhost:8000/health
curl -X POST localhost:8000/predict -H 'Content-Type: application/json' -d '{}'
curl -X POST localhost:8000/predict -H 'Content-Type: application/json' \
  -d '{"Age": 66, "BP": 100, "Typical Chest Pain": 0}'
curl -X POST localhost:8000/explain -H 'Content-Type: application/json' \
  -d '{"target":"cad","top_k":3}'
```

Observed: `{}` → CAD 0.545 / LAD 0.485 / LCX 0.345 / RCA 0.389; a real dataset
CAD row → CAD 0.73.

## Ops notes

- `ARTIFACTS_DIR` overrides artifact location; without artifacts,
  predict/explain 503 while `/health` reports `"artifacts_loaded": false`.
- ML pins must match training's (`scikit-learn==1.7.2`, `xgboost==3.2.0`, …)
  or unpickling fails. `shap` is optional (fallback covers its absence).
- CORS is wide-open for demo; auth/rate-limiting/persistence are absent by
  design (stateless prototype).
