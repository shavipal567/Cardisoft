# API

FastAPI serves frozen saved models. See `backend/README.md` for run instructions
and `backend/schemas.py` or `/openapi.json` for the complete validation schema.

| Method | Path | Purpose |
|---|---|---|
| GET | /health | Availability and disclaimer; always 200 |
| GET | /model-info | Saved model names and held-out evaluation metadata |
| POST | /predict | Four binary predictions and probabilities |
| POST | /explain | Signed, approximate patient-specific Shapley contributions |

Prediction accepts any subset of the 54 clinical inputs using CSV aliases.
Omitted inputs use explicit defaults. Explicit nulls, unknown keys (including
leakage labels), invalid categories, non-finite numbers and out-of-range values
return 422. Binary flags require integer 0/1. An empty object remains valid.

Explanation request:

```json
{"features":{"Age":66,"Typical Chest Pain":1},"target":"cad","top_k":10}
```

Targets are cad/lad/lcx/rca; top_k is 1–60. See
[explainability](explainability.md) for method, units and additivity.

Missing prediction artifacts return 503. `/model-info` also returns 503 if
saved evaluation metadata is missing or inconsistent. Execution errors return
422. Models and backgrounds are cached; restart after replacing artifacts.
`ARTIFACTS_DIR` overrides their location.

The frontend defaults to live calls through `/api` (Vite development proxy).
Production needs a reverse proxy or an explicitly configured API origin.
Mock mode is opt-in and visibly labelled; failed live requests never return mock results.
CORS is open for the local prototype; auth, persistence and rate limiting are absent.
