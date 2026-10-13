# Engineering decisions

## Separate training and serving

`training/` owns fitting and frozen inference; `backend/` validates requests
and serves those artifacts. Shared transformation code reduces drift, while
API defaults remain distinct from fitted imputation. Run the backend from its
own directory; services bootstrap the sibling training directory on sys.path.

**Why**: Fitting and request handling have different lifecycles. The service
loads frozen artifacts and never starts training in response to a request. It
still needs compatible ML dependencies and custom transformer classes to load
and execute those artifacts.

**Trade-off**: Two dependency files (`training/requirements.txt` and
`backend/requirements.txt`) must stay version-matched for artifact compatibility.

## Four independent models

The saved v2 winners are CatBoost-native for CAD and Random Forest for all
vessels, selected among seven families and 32 configurations per target using
10×5-fold CV. Classifier chains and vessel calibration remain future work;
CAD calibration is evaluated in the separate nested experiment.

**Why**: Independent models are simpler to train, evaluate, and explain. Each
target gets its best model without compromise.

**Trade-off**: Ignores vessel co-occurrence structure (LCX→LAD 81%, RCA→LAD 76%).
Classifier chains could capture this but add complexity and are backlogged.

## Nested CAD selection before model replacement

New CAD research runs preserve the raw input schema and compare the legacy
configuration with an inner-selected pipeline on paired outer folds. A run may
fix an engineered feature set for the candidate; its comparator always uses
baseline features. Historical configurations keep both branches on baseline.
Inner log loss selects actual fixed-count CatBoost fits, followed by
training-only calibration and exploratory operating points. Longer-fit
CatBoost prefixes are diagnostic curves, not substitutes for count-specific
refits. Tests verify that selected OOF predictions match independent refits.

**Why**: The historical winner was chosen and reported on the same CV folds.
Outer evaluation is needed for the complete selection/calibration procedure,
and probability quality and false-positive burden matter alongside ranking.

**Trade-off**: More fits and uncertainty on this small dataset. Experiments
save separate models, row-level predictions, provenance, paired uncertainty
and reports. The serving bundle is not replaced automatically. Historical
data inspection and missing patient IDs/timestamps still limit conclusions.
See [CAD nested validation](cad-nested-validation.md).

## Three preprocessing tracks

The current baseline artifacts have 81 one-hot vessel columns and 54 native
CAD columns. New output widths depend on the engineered feature set and fitted
category vocabulary. Native categorical positions are derived from numeric
width; CatBoostNative preserves their integer types.
Voting adds `StandardScaler(with_mean=False)` after one-hot encoding to
condition its ElasticNet member. All tracks exclude the four target labels
and fit transformations on training data.

**Why**: Different models have different optimal input representations. RF/XGB
benefit from one-hot (no ordinal assumption); CatBoost/LGBM handle native
categoricals efficiently.

**Trade-off**: Three tracks to maintain. Shared builders in `preprocessing.py`
keep the transforms consistent; voting composes the existing one-hot builder.

## Feature engineering inside frozen preprocessing

`NumericFeatureEngineer` computes three ratios, two unweighted counts and three
log transforms in the numeric branch before fold-fitted imputation/scaling.
Ratios/counts augment raw inputs; logs replace their three source lab columns.
The API retains 54 fields. New legacy training resolves target-specific defaults
once, then uses the same set for every candidate and the final refit.

**Why**: Persisting the calculation inside the preprocessor makes training and
inference use the same formulas. Invalid constituents become missing before
imputation. A schema records the resulting names and width; explicit baseline
builder defaults preserve old calling behaviour.

**Trade-off**: The automatic choices came from an exploratory accuracy comparison
on development data. Their small gains need further validation; the legacy
model search does not select feature sets inside folds. The current serving
models retain baseline features. See [Feature engineering](feature-engineering.md).

## A shared probability contract

All saved classifiers return `(n_samples, 2)` probabilities in class order
`[0, 1]`, including the custom voting ensemble. CV, evaluation, inference and
explanations consume the positive-class column. Voting CV uses each fold's
tuned threshold; evaluation and inference use the saved threshold, defaulting
to 0.5.

`LGBMArrayClassifier` preserves LightGBM's fitted feature names when predicting
from transformed NumPy arrays. This resolves the feature-name warning at the
estimator boundary without global warning suppression or changes to consumers.

**Trade-off**: Saved LightGBM artifacts depend on the adapter module being
available at load time, as CatBoost artifacts already depend on `CatBoostNative`.

## Reproducible local artifacts

Version-pinned ML dependencies and committed model/preprocessor/background/
metadata files let the demo run without retraining. New engineered artifacts
also require raw explanation backgrounds and preserve a feature schema.
`ARTIFACTS_DIR` selects an alternate bundle for inference/backend consumers;
it does not redirect legacy training or evaluation output. Restart the API after replacing cached artifacts.

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

## Measured accuracy for the supplied fields

The assessment reports the frozen models' accuracy on held-out records with the
same fields supplied and the remaining fields replaced by API defaults. Coverage
is shown separately as supplied fields divided by 54. The accuracy service
returns sample counts, recall, uncertainty intervals and comparison baselines.

**Why**: Field count cannot determine accuracy. Which measurements are available
affects model performance, and a missing field is substituted before prediction.
A measured cohort check describes that substitution without manufacturing a
confidence score for an individual patient.

**Trade-off**: First-time field sets require additional batch predictions and
access to the original cohort CSV and split metadata. Bounded caches reuse
results by field set and model/default/dataset identity. Missing validation
resources leave prediction available with an explicit unavailable score. The
small, single-source holdout supports an exploratory check; it must not become
a source for feature or threshold selection. See [Evaluation](evaluation.md#accuracy-with-available-inputs).

## Patient-specific explanations without a fragile optional runtime

Seeded permutation Shapley estimates explain model probabilities. Baseline
models group transformed one-hot columns by source field. Engineered models
perturb raw fields and rerun frozen preprocessing on every path, keeping
ratios, logs and counts consistent with their constituents. Both return raw
field attributions, probability units and an additive residual for top-k output.

**Why**: A ratio depends on more than one input; assigning its attribution to
one constituent would be arbitrary. Raw recomputation explains the complete
prediction pipeline. The runtime does not depend on shap/numba or fall back to
global feature rankings.

**Trade-off**: Up to 16 references and four forward/reverse pairs produce eight
paths per reference. Repeated predictions and engineered preprocessing add
latency; runtime depends on the model and environment. This remains an
approximation, and mixed-patient paths can represent unusual combinations.

## Explicit validation and input provenance

Omitted API fields retain defaults; invalid supplied values and unknown keys
are rejected. The form exposes all 54 features, with 19 supplied by the sample
patient; omitted values are identified in explanations. Report imports update both the model-sex input and
visible selection, while preserving an explicit Others identity.

**Why**: Silent data corruption is worse than a loud error. If a user sends an
invalid value, they should know immediately rather than receiving a prediction
based on a guess.

**Trade-off**: More verbose error messages. Acceptable for a research prototype.

## Local OCR for report images

PNG/JPEG/WebP/BMP report images use a browser Tesseract.js worker and feed the same
field mapper as text PDFs. The frontend serves the engine and English language
data itself; report images and recognised text are not sent to an external OCR
service. Importing fills fields for review and does not trigger prediction.

**Why**: Photos and screenshots can supply the same structured measurements as
text PDFs while preserving the existing import workflow and provenance badges.

**Trade-off**: The frontend deployment includes OCR assets, and the first image
takes longer to process. Recognition depends on image quality and printed English
text; matching rules do not cover every form field or convert units. File/image
limits, cancellation and an OCR timeout bound the work. This is multimodal input
and document text extraction: report images are transcribed into text, then
mapped to reviewed structured fields. The prediction models receive those
fields rather than report pixels or image embeddings; the importer does not
perform diagnostic image analysis.

## Schematic visualization and honest reporting

The React dashboard and procedural 3D heart are implemented. Vessel coloring
communicates named-vessel model estimates, not lesion coordinates. LCX/RCA
limitations, uncalibrated probabilities and the research disclaimer remain visible.

**Why**: The dataset has no imaging or lesion coordinates. Any visual suggestion
of plaque location would be a fabrication. The 3D heart is explicitly labelled
as schematic context.

**Trade-off**: Less visually impressive than a "lesion locator" would be.
But it's honest and scientifically defensible.
