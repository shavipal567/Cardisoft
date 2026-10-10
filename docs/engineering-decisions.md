# Engineering decisions

## Separate training and serving

`training/` owns fitting and frozen inference; `backend/` validates requests
and serves those artifacts. Shared transformation code reduces drift, while
API defaults remain distinct from fitted imputation. Run the backend from its
own directory; services bootstrap the sibling training directory on sys.path.

## Four independent models

The saved v2 winners are CatBoost-native for CAD and Random Forest for all
vessels, selected among six families and 31 configurations per target using
10×5-fold CV. Classifier chains and calibration are future work.

## Two preprocessing tracks

One-hot encoding yields 81 saved vessel inputs. Native categorical encoding
yields 54 CAD inputs; CatBoostNative preserves integer categorical types.
Both exclude all four target labels and fit transformations on training data.

## Reproducible local artifacts

Version-pinned ML dependencies and committed model/preprocessor/background/
metadata files let the demo run without retraining. ARTIFACTS_DIR supports
alternate bundles. Restart the API after replacing cached artifacts.

## Live by default, explicit demo mode

Frontend API calls default to `/api`; Vite proxies to port 8000. Only an explicit
VITE_USE_MOCK=true enables labelled static fixtures. Prediction failures do not
silently switch modes. Production needs its own API routing configuration.

## Metadata from the deployed artifacts

`/model-info` reads metrics and metadata beside the configured models. The demo
snapshot is exported by the same `training/model_info.py` function. Legacy mock
metrics are no longer a UI data source.

## Patient-specific explanations without a fragile optional runtime

The old SHAP import/global-importance fallback was replaced by seeded grouped
permutation Shapley estimates using model probabilities. All models share
probability units; one-hot categories move as complete groups. The method is
explicitly approximate, has an additive residual for top-k outputs, and exposes
failures. No shap/numba/coverage dependency is needed.

## Explicit validation and input provenance

Omitted API fields retain defaults; invalid supplied values and unknown keys
are rejected. The form still collects 19/54 features, so uncollected values are
identified in explanations. PDF imports update both the model-sex input and
visible selection, while preserving an explicit Others identity.

## Schematic visualization and honest reporting

The React dashboard and procedural 3D heart are implemented. Vessel coloring
communicates named-vessel model estimates, not lesion coordinates. LCX/RCA
limitations, uncalibrated probabilities and the research disclaimer remain visible.
