# Engineering decisions

## Separate training and serving

`training/` owns fitting and frozen inference; `backend/` validates requests
and serves those artifacts. Shared transformation code reduces drift, while
API defaults remain distinct from fitted imputation. Run the backend from its
own directory; services bootstrap the sibling training directory on sys.path.

**Why**: Training code (pandas, sklearn, CatBoost) is heavy and has specific
version requirements. The backend only needs `joblib.load` + `predict_proba`.
Keeping them separate means the serving layer stays lightweight.

**Trade-off**: Two dependency files (`training/requirements.txt` and
`backend/requirements.txt`) must stay version-matched for artifact compatibility.

## Four independent models

The saved v2 winners are CatBoost-native for CAD and Random Forest for all
vessels, selected among seven families and 32 configurations per target using
10×5-fold CV. Classifier chains and calibration are future work.

**Why**: Independent models are simpler to train, evaluate, and explain. Each
target gets its best model without compromise.

**Trade-off**: Ignores vessel co-occurrence structure (LCX→LAD 81%, RCA→LAD 76%).
Classifier chains could capture this but add complexity and are backlogged.

## Two preprocessing tracks

One-hot encoding yields 81 saved vessel inputs. Native categorical encoding
yields 54 CAD inputs; CatBoostNative preserves integer categorical types.
Both exclude all four target labels and fit transformations on training data.

**Why**: Different models have different optimal input representations. RF/XGB
benefit from one-hot (no ordinal assumption); CatBoost/LGBM handle native
categoricals efficiently.

**Trade-off**: Two code paths to maintain. Mitigated by a shared `preprocessing.py`
with a single `build_preprocessor()` / `build_native_preprocessor()` interface.

## Reproducible local artifacts

Version-pinned ML dependencies and committed model/preprocessor/background/
metadata files let the demo run without retraining. ARTIFACTS_DIR supports
alternate bundles. Restart the API after replacing cached artifacts.

**Why**: The hackathon demo must work without a 2-hour training run. Committed
artifacts mean `pip install + uvicorn` is sufficient.

**Trade-off**: Binary artifacts in git bloat the repository (~8 MB). Accepted
for demo reliability. Git LFS could be a future improvement.

## Live by default, explicit demo mode

Frontend API calls default to `/api`; Vite proxies to port 8000. Only an explicit
VITE_USE_MOCK=true enables labelled static fixtures. Prediction failures do not
silently switch modes. Production needs its own API routing configuration.

**Why**: Clinicians and judges should see real model outputs, not canned results.
Demo mode exists for offline presentations but is always visibly labelled.

**Trade-off**: Requires backend running for normal use. Mitigated by clear
error messages when the API is unreachable.

## Metadata from the deployed artifacts

`/model-info` reads metrics and metadata beside the configured models. The demo
snapshot is exported by the same `training/model_info.py` function. Legacy mock
metrics are no longer a UI data source.

**Why**: Single source of truth. The displayed metrics are exactly what the
saved models produced — no copy-paste drift between training output and UI.

**Trade-off**: If artifacts are missing, `/model-info` returns 503. This is
preferred over showing stale or fabricated numbers.

## Patient-specific explanations without a fragile optional runtime

The old SHAP import/global-importance fallback was replaced by seeded grouped
permutation Shapley estimates using model probabilities. All models share
probability units; one-hot categories move as complete groups. The method is
explicitly approximate, has an additive residual for top-k outputs, and exposes
failures. No shap/numba/coverage dependency is needed.

**Why**: SHAP's TreeExplainer has a broken numba import path in some environments.
The old fallback to global importance was misleading — it presented population-level
rankings as patient-specific explanations.

**Trade-off**: Permutation Shapley is slower than TreeSHAP (multiple forward passes).
The 16-reference × 4-ordering design keeps it under ~1 second per explanation.

## Explicit validation and input provenance

Omitted API fields retain defaults; invalid supplied values and unknown keys
are rejected. The form still collects 19/54 features, so uncollected values are
identified in explanations. PDF imports update both the model-sex input and
visible selection, while preserving an explicit Others identity.

**Why**: Silent data corruption is worse than a loud error. If a user sends an
invalid value, they should know immediately rather than receiving a prediction
based on a guess.

**Trade-off**: More verbose error messages. Acceptable for a research prototype.

## Schematic visualization and honest reporting

The React dashboard and procedural 3D heart are implemented. Vessel coloring
communicates named-vessel model estimates, not lesion coordinates. LCX/RCA
limitations, uncalibrated probabilities and the research disclaimer remain visible.

**Why**: The dataset has no imaging or lesion coordinates. Any visual suggestion
of plaque location would be a fabrication. The 3D heart is explicitly labelled
as schematic context.

**Trade-off**: Less visually impressive than a "lesion locator" would be.
But it's honest and scientifically defensible.
