# Cardisoft

Research prototype for CAD and LAD/LCX/RCA prediction from structured clinical
measurements, with patient-specific explanations and an interactive schematic heart.

Built for the Multimodal AI Hackathon 2026 (Track A). This is a decision-support
prototype — **not a medical diagnosis tool**.

## Quick start

### Prerequisites

- Python 3.10+ (backend + training)
- Node.js 20+ (frontend)
- ~500 MB disk for model artifacts (already committed)

### 1. Start the backend

```bash
pip install -r backend/requirements.txt
cd backend
uvicorn main:app --host 127.0.0.1 --port 8000
```

The API is now available at `http://127.0.0.1:8000`. Interactive OpenAPI docs at
`http://127.0.0.1:8000/docs`.

### 2. Start the frontend

In a new terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open the Vite URL printed in the terminal (typically `http://localhost:5173`).
Live inference is the default; Vite proxies `/api` to `http://127.0.0.1:8000`.

### 3. Try it

1. Fill in patient measurements in the grouped form (all 54 fields are optional)
2. Click **Analyze** to get four predictions (CAD, LAD, LCX, RCA)
3. Select a vessel in the 3D heart or risk cards to see its explanation
4. Toggle between **Clinician** and **Patient** views
5. Use **Download PDF report** to export the full assessment

### Offline demo mode

Copy `frontend/.env.example` to `frontend/.env` and set `VITE_USE_MOCK=true`.
This uses fixed prediction/explanation fixtures with a visible banner. No backend
is required. Restart Vite after changing environment variables.

For production deployment, route `/api/*` to the API with `/api` stripped, or set
`VITE_API_URL` to the API origin when building. Vite's development proxy is not
part of `npm run preview` or the production build. Restrict CORS to your frontend
origin before deployment; authentication and persistence are not implemented.

## What's in the box

| Component | Location | Description |
|---|---|---|
| **Frontend** | `frontend/` | React 19 + TypeScript + Vite, Recharts, React Three Fiber, PDF parsing |
| **Backend** | `backend/` | FastAPI with validated `/health`, `/predict`, `/explain`, `/model-info` |
| **Training** | `training/` | Preprocessing, repeated-CV model selection, frozen inference, saved artifacts |
| **Dataset** | `dataset/` | 303-row, 59-column clinical dataset with per-column metadata |
| **Docs** | `docs/` | MkDocs technical documentation site |
| **Challenge spec** | `PROBLEM.md` | Full hackathon requirements (35 sections) |

## Repository structure

```
Cardisoft/
├── frontend/                  # React dashboard
│   ├── src/
│   │   ├── components/        # HeartViewer, AssessmentTools, CarePlan, etc.
│   │   ├── anatomy/           # Coronary registration + path utilities
│   │   ├── pdf/               # PDF text extraction + report generation
│   │   ├── fields.ts          # 54 field definitions (8 sections)
│   │   ├── api.ts             # API client
│   │   ├── assessment.ts      # Assessment state/logic
│   │   └── careplan.ts        # Care plan logic
│   └── public/
│       ├── heart.glb          # 3D heart model (CC BY 4.0, Pigcraft)
│       └── model-info.json    # Offline metrics snapshot
├── backend/                   # FastAPI prediction API
│   ├── main.py                # App factory + lifespan
│   ├── schemas.py             # Pydantic input validation (54 fields)
│   ├── routes/                # predict, explain, model_info endpoints
│   ├── services/              # predictor + explainer
│   └── tests/                 # Integration tests
├── training/                  # ML training pipeline
│   ├── preprocessing.py       # Constants, cleaning, preprocessor builders
│   ├── train.py               # Repeated-CV model selection (32 configs)
│   ├── inference.py           # Frozen artifact loading + prediction
│   ├── evaluate.py            # Held-out test evaluation
│   └── artifacts/             # Saved models (tracked in git)
│       ├── cad/               # CatBoost model + preprocessor + background
│       ├── lad/               # Random Forest model + preprocessor + background
│       ├── lcx/               # Random Forest model + preprocessor + background
│       ├── rca/               # Random Forest model + preprocessor + background
│       └── metrics.json       # Held-out test metrics
├── dataset/
│   ├── dataset.csv            # 303 rows × 59 columns
│   └── columns.metadata.md    # Per-column documentation
├── docs/                      # MkDocs site sources
└── PROBLEM.md                 # Challenge specification
```

## Model performance

Current saved models: **CatBoost** for CAD, **Random Forest** for all three vessels.

| Target | Model | CV ROC-AUC | Test ROC-AUC | Test F1 |
|---|---|---:|---:|---:|
| CAD | CatBoost (depth 4, lr .05, L2 3) | .9273 | .8928 | .899 |
| LAD | RF (400 trees, unlimited depth, leaf 2) | .8428 | .8433 | .827 |
| LCX | RF (400 trees, unlimited depth, leaf 2) | .7400 | .7106 | .524 |
| RCA | RF (400 trees, depth 8, leaf 2) | .7067 | .7483 | .474 |

Test set: 61 patients (stratified 80/20 split, seed 42). See
`training/artifacts/metrics.json` for precise scores and confusion counts.
Model Info reads these artifacts through the backend, rather than mock metrics.

## Explanations

Explanations are **approximate grouped permutation Shapley values** in probability
units. They use the same saved model as prediction, retain categorical groups,
and report a residual when only top-k contributions are returned. There is no
silent global-importance fallback and no SHAP/numba runtime dependency.

Key properties:
- **Additive**: `base_value + sum(contributions) + residual = probability`
- **Patient-specific**: contributions vary per patient based on their feature values
- **Grouped**: one-hot encoded categories move together as a single unit
- **Approximate**: uses 16 reference rows × 4 forward/reverse order pairs

## Important caveats

- Predictions are **uncalibrated model estimates**, not medically validated risk percentages
- The 3D heart is **schematic context**, not a reconstruction or lesion locator
- The form accepts all 54 inputs optionally; omitted fields use documented server defaults
- LCX and RCA models have weak recall (~0.46 and ~0.39) — reported honestly, not tuned away
- The dataset is small (n=303) and single-source; no external validation has been performed
- Explanations describe **model behavior**, never medical causality

## Verify

```bash
# Backend tests
pip install -r backend/requirements-test.txt
python -m unittest discover -s backend/tests -v

# Frontend build + lint
cd frontend
npm run build
npm run lint
```

## Documentation

Full technical documentation is in `docs/` (MkDocs site). Build with:

```bash
pip install -r docs/requirements-docs.txt
mkdocs build --strict   # or: mkdocs serve
```

Key pages: [Problem formulation](docs/problem-formulation.md) ·
[Dataset](docs/dataset.md) · [Models](docs/models.md) ·
[API](docs/api.md) · [Explainability](docs/explainability.md) ·
[Visualization](docs/visualization.md) · [Engineering decisions](docs/engineering-decisions.md)
