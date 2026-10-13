# Cardisoft

Cardisoft predicts CAD and LAD/LCX/RCA stenosis from structured clinical
measurements. It combines a FastAPI prediction service, a React dashboard,
patient-specific explanations and a schematic 3D heart.

Built for the Multimodal AI Hackathon 2026, Track A. This is a research prototype;
its predictions are not a medical diagnosis or lesion-location estimate.

## Current implementation

| Area | Current state |
|---|---|
| Data | 303 records, 59 source columns, 54 permitted raw predictors |
| New training runs | Target-specific ratios, counts and log transforms, computed inside saved preprocessing |
| Checked-in serving models | Baseline features: CatBoost for CAD; Random Forest for LAD, LCX and RCA |
| Evaluation | Historical held-out metrics, exploratory feature comparisons and a separate nested CAD experiment |
| API and form | The same 54 raw fields; generated features require no additional user input |

**The feature pipeline is implemented, but the checked-in models have not been
retrained with it.** Published serving-model scores below still describe the
baseline artifacts. The feature-analysis results describe a separate experiment.

## Run the application

Use Python 3.10+ and a Node.js version supported by the installed Vite: 20.19+
on the 20.x line, or 22.12+. Commands start in the repository root unless a
`cd` command changes the directory.

Start the backend:

```bash
python3 -m pip install -r backend/requirements.txt
cd backend
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000
```

OpenAPI documentation is at `http://127.0.0.1:8000/docs`. In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. Its development
proxy forwards `/api` requests to port 8000.

1. Enter measurements or import a text PDF or report image, then review the values.
2. Select **Analyze patient** for the four predictions.
3. Review **Accuracy with available inputs**, the vessel cards and explanations.
4. Explore the schematic heart or download the assessment as a PDF.

Report import runs in the browser. PNG/JPEG/WebP/BMP OCR supports printed English
and files up to 15 MB. Verify extracted decimals, units and findings before
analysis. See the [frontend guide](frontend/README.md#report-import) for limits,
fixtures and deployment of OCR assets.

For an offline demonstration, set `VITE_USE_MOCK=true` in `frontend/.env` using
`.env.example` as a starting point, then restart Vite. Demo predictions are fixed
fixtures and do not evaluate accuracy for submitted inputs. Production hosting
needs its own `/api` proxy or a configured `VITE_API_URL`; Vite's development proxy
is not included in the production build.

## Deploy frontend and API together on Vercel

The root `vercel.json` defines a Vercel Services deployment: the Vite app serves
the site at `/`, and FastAPI serves `/api/*` on the same deployment domain. The
backend function bundles the inference code, model artifacts, and dataset needed
for predictions and the input-coverage accuracy panel. Python dependencies are
loaded from the root `requirements.txt`, which includes `backend/requirements.txt`.

1. Import this repository in Vercel with the repository root as the project root.
2. In **Project Settings → Build and Deployment**, select **Services** as the
   framework.
3. Deploy. The Vercel configuration builds both services; no `VITE_API_URL`
   override is needed because the frontend already calls `/api` by default.
4. Check `/api/health`, then try an assessment. The API docs are at `/api/docs`.

The backend uses Vercel's Python 3.12 runtime (`.python-version`) and a
300-second function duration for model loading and explanations. Vercel Functions
are request-based and may cold-start; this is a research/demo deployment rather
than a persistent server.

## Engineered features

New multi-target training runs default to `--feature-set auto`:

| Target | Feature set | Transformation |
|---|---|---|
| CAD | `logs` | Replace TG, FBS and ESR with their `log1p` values |
| LAD | `counts` | Add risk-factor and ECG-finding counts |
| LCX | `ratios_counts` | Add LDL/HDL, TG/HDL, Neut/Lymph and both counts |
| RCA | `baseline` | Keep the original inputs |

These choices follow the exploratory accuracy comparison in the
[executed notebook](dataset/engineered-feature-analysis.ipynb). They are fixed
training defaults, not independently validated winners. See
[feature engineering](docs/feature-engineering.md) for formulas, missing-value
rules, the comparison protocol and the difference between accuracy and log loss.

All derived features are calculated from permitted raw measurements before
fold-fitted imputation and scaling. `Cath`, `LAD`, `LCX` and `RCA` never enter the
predictors. Saved preprocessors apply the same calculations during inference.

## Train, evaluate and refresh the application

From the repository root:

```bash
python3 -m pip install -r training/requirements.txt
python3 training/train.py --feature-set auto
python3 training/evaluate.py
python3 training/model_info.py --output frontend/public/model-info.json
```

Training writes to `training/artifacts/<target>/` and replaces each requested
target's serving model. Evaluation refreshes metrics and confusion matrices;
the final command refreshes the offline dashboard snapshot. Restart the backend
after the complete bundle has been updated because models and backgrounds are
cached. Avoid serving a partially updated bundle during training.

Use `--feature-set baseline` to train with original inputs, or select an explicit
set such as `ratios_counts_logs`. `--targets cad` limits the targets. The default
search compares 32 model configurations per target over 10 repeats of five-fold
CV and selects by mean ROC-AUC, with F1 as the tie-breaker. It does not search over
feature sets or select by accuracy. See the [training guide](training/README.md).

For an isolated CAD experiment with engineered features:

```bash
python3 training/train.py --protocol nested --feature-set logs
```

This writes a new directory under `training/experiments/`, leaving serving
artifacts in place. Inner folds select model settings, iteration count and
calibration; the candidate's feature set is fixed for that run. The comparator
uses original inputs. Historical nested configurations without a feature-set
override retain baseline features. See the [protocol](docs/cad-nested-validation.md).

## Checked-in model performance

These scores come from the existing **baseline-feature** artifacts. Each target
uses its own 61-record stratified holdout, seed 42.

| Target | Saved model | Holdout accuracy | Holdout ROC-AUC | Holdout recall |
|---|---|---:|---:|---:|
| CAD | CatBoost | 85.25% | .8928 | .9302 |
| LAD | Random Forest | 78.69% | .8433 | .8611 |
| LCX | Random Forest | 67.21% | .7106 | .4583 |
| RCA | Random Forest | 67.21% | .7483 | .3913 |

The source of truth is `training/artifacts/metrics.json` and per-target metadata.
These historical holdouts have already been inspected and are not new external
validation. Exploratory feature-CV accuracies must not be presented as updated
holdout or deployed-model scores. [Evaluation details](docs/evaluation.md).

## Prediction, accuracy and explanation

The form accepts 54 optional raw inputs. Omitted fields receive documented API
defaults; explicit zero counts as supplied. The dashboard distinguishes:

| Output | Meaning |
|---|---|
| Prediction probability | The loaded model's estimate for this completed input row |
| Input coverage | Number of supplied raw fields divided by 54 |
| Accuracy with available inputs | Accuracy on historical holdout records using the same supplied/defaulted field pattern |
| Explanation | Approximate contribution of each raw input to this model prediction |

For the accuracy check, the server keeps supplied columns from each holdout
record and substitutes API defaults into omitted columns. It then applies the
frozen preprocessor, including any engineered features, and the saved model.
Patient values are not copied onto the evaluation cohort. The result is a cohort
score, not a probability that one patient's prediction is correct.

Keep `dataset/dataset.csv` and split metadata available for that check. If they
are unavailable, predictions can still run and the panel reports unavailable
accuracy. See the [backend guide](backend/README.md).

Explanations use approximate grouped permutation Shapley contributions in
probability units. For engineered models, each path changes raw measurements
and recalculates the derived values, preserving their arithmetic relationships.
The response obeys `base + returned contributions + residual = probability`.
It explains model behaviour, not medical causality. [Explanation method](docs/explainability.md).

## Repository guide

| Directory | Contents |
|---|---|
| [frontend/](frontend/README.md) | Dashboard, 54-field form, report import/export and 3D viewer |
| [backend/](backend/README.md) | FastAPI routes, input validation, frozen prediction and explanations |
| [training/](training/README.md) | Feature engineering, model selection, evaluation and serving artifacts |
| [dataset/](dataset/README.md) | Source CSV, dictionary, executed feature analysis, exported tables and plots |
| [docs/](docs/README.md) | Technical site and API reference |
| [PROBLEM.md](PROBLEM.md) | Challenge specification |

## Verification and documentation

```bash
python3 -m pip install -r backend/requirements-test.txt -r training/requirements.txt
python3 -m unittest discover -s training/tests -v
python3 -m unittest discover -s backend/tests -v
```

From `frontend/`, run `npm test`, `npm run build` and `npm run lint`.
Training/backend regressions cover feature arithmetic, missing values, fold
isolation, categorical indices, saved-model reload, explanation additivity and
compatibility with baseline artifacts.

Build the documentation from the repository root:

```bash
python3 -m pip install -r docs/requirements-docs.txt
python3 -m mkdocs build --strict
```

The application remains a small-cohort, tabular research prototype. The current
serving probabilities are uncalibrated, patient independence and measurement
timing are unverified, and no external clinical validation has been performed.
The 3D heart provides schematic context rather than patient anatomy.
