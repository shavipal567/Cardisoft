# Cardisoft

Research prototype for CAD and LAD/LCX/RCA prediction from structured clinical
measurements, with patient-specific explanations and an interactive schematic heart.

## Run the live application

From the repository root, install the backend dependencies (preferably in a virtual environment):

```bash
pip install -r backend/requirements.txt
```

Start the API in one terminal:

```bash
cd backend
uvicorn main:app --host 127.0.0.1 --port 8000
```

Start the dashboard in another:

```bash
cd frontend
npm ci
npm run dev
```

Open the Vite URL printed in the terminal. Live inference is the default;
Vite proxies `/api` to `http://127.0.0.1:8000`. The committed model artifacts
allow inference without retraining. Patient names stay in browser memory;
in live mode the clinical measurements are sent to the API. PDF text extraction
runs locally in the browser.

For configuration, copy `frontend/.env.example` to `frontend/.env`. Explicitly
set `VITE_USE_MOCK=true` only for an offline demonstration: a visible banner
identifies the fixed prediction/explanation fixtures. Environment changes
require restarting Vite or rebuilding the production bundle.

For deployment, route `/api/*` to the API with `/api` stripped, or set
`VITE_API_URL` to the API origin when building. Vite's development proxy is
not part of `npm run preview` or the production build. Restrict CORS to your
frontend origin before deployment; authentication and persistence are not implemented.

## Repository

- `frontend/`: React, TypeScript, PDF parsing, Recharts, React Three Fiber.
- `backend/`: validated FastAPI `/health`, `/predict`, `/explain`, `/model-info`.
- `training/`: preprocessing, repeated-CV model selection, frozen inference,
  saved artifacts, evaluation and model-info snapshot export.
- `dataset/`: 303-row, 59-column dataset and column notes.
- `docs/`: MkDocs technical documentation; `PROBLEM.md` is the challenge specification.
- Notebooks are exploratory references, not the production training pipeline.

## Verify

```bash
pip install -r backend/requirements-test.txt
python -m unittest discover -s backend/tests -v
cd frontend
npm run build
npm run lint
```

Current saved models: CatBoost for CAD, Random Forest for all three vessels.
Saved test ROC-AUC: CAD 0.893, LAD 0.843, LCX 0.711, RCA 0.748 (61 patients).
See `training/artifacts/metrics.json` for precise scores and confusion counts.
Model Info reads these artifacts through the backend, rather than mock metrics.

Explanations are approximate grouped permutation Shapley values in probability
units. They use the same saved model as prediction, retain categorical groups,
and report a residual when only top-k contributions are returned. There is no
silent global-importance fallback and no SHAP/numba runtime dependency.

Predictions are uncalibrated model estimates, not a diagnosis. The heart is
schematic context, not a reconstruction or lesion locator. The form accepts
all 54 inputs optionally; omitted fields use documented server defaults and are
identified as defaulted in live explanations.
