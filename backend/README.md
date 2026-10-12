# Prediction API

FastAPI serves the frozen model bundles from `training/artifacts/`. The shared
`training/inference.py` loads preprocessors/models and applies their saved
thresholds. HTTP handlers do not fit models or select features.

## Start the service

From the repository root:

```bash
python3 -m pip install -r backend/requirements.txt
cd backend
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Interactive API documentation: `http://127.0.0.1:8000/docs`.
`ARTIFACTS_DIR` can point inference to another complete, compatible four-target
bundle. Restart the service after replacing artifacts; models and explanation
backgrounds are cached. The source CSV for input-dependent accuracy remains
`dataset/dataset.csv` regardless of that setting.

## Inputs and engineered features

Requests contain the same **54 raw measurements** as before. Ratios, counts and
log transforms are computed by the loaded preprocessor, so clients should not
send generated feature names. Extra fields, including all four target labels,
are rejected.

The checked-in bundles still use baseline preprocessing. After retraining, the
standard `auto` policy produces CAD logs, LAD counts, LCX ratios/counts and RCA
baseline features. The API does not choose that policy at request time: it uses
whatever feature set was fitted and saved with each model.

`PatientInput` accepts CSV aliases such as `Current Smoker` and `EF-TTE`, as well
as Python field names. Omitted fields receive explicit schema defaults; `{}` is
valid. Explicit nulls, nonfinite numbers, extra keys and invalid categories
return 422. Binary flags require integer 0/1; explicit zero counts as supplied.
Sex accepts Male/Female and normalises the legacy spelling Fmale. Numeric limits
and categorical choices are published in OpenAPI; they are software acceptance
limits, not clinical reference ranges.

API defaults and model imputation are different. Defaults complete an omitted
HTTP input before feature calculation. Direct inference can encounter missing
values, which the fitted preprocessor handles. For example, HDL=0 is an invalid
ratio denominator: the ratio becomes missing and uses its fitted imputation.

## Endpoints

| Endpoint | Behaviour |
|---|---|
| `GET /health` | Liveness and prediction-artifact availability; always 200 |
| `GET /input-defaults` | Defaults for all 54 raw fields; works without model files |
| `POST /predict` | Validated measurements → CAD/vessel probabilities, labels and assessment context |
| `POST /explain` | Raw measurements plus target/top-k → signed patient-specific contributions |
| `GET /model-info` | Saved model names, CV information and evaluation metrics |

```bash
curl http://localhost:8000/health
curl http://localhost:8000/input-defaults
curl -X POST http://localhost:8000/predict -H 'Content-Type: application/json' -d '{}'
curl -X POST http://localhost:8000/explain -H 'Content-Type: application/json' \
  -d '{"target":"cad","features":{"Age":66,"Typical Chest Pain":1},"top_k":10}'
```

Prediction context records effective/defaulted inputs and a SHA-256 fingerprint
of each loaded preprocessor/model pair. The explanation endpoint returns the same
model identity so the frontend can associate it with the completed prediction.
See [the API contract](../docs/api.md) for full request/response examples.

## Accuracy with available inputs

`context.input_validation` evaluates each frozen model on its historical holdout
using the submitted field pattern. It keeps cohort measurements for supplied
fields and substitutes `PatientInput` defaults into omitted fields. The loaded
preprocessor then calculates any derived features from those completed rows.

The response includes accuracy (`correct / n_test`), counts, 95% Wilson intervals,
recall, full-input accuracy and a majority-class baseline. Fractions are returned
by the API and formatted as percentages by the frontend. The current holdouts
contain 61 records per target, with potentially different membership.

Changing a patient's values without changing the field pattern leaves these
cohort scores unchanged. Generated features do not increase coverage beyond the
54 raw inputs. These scores are not confidence that an individual prediction is
correct, and they do not retrain models or tune thresholds.

This service needs the original CSV rows/order and the saved split metadata.
Missing or inconsistent resources produce `status: unavailable` while prediction
can still succeed. Checks validate label definitions and split sizes, not a
training-time dataset content hash. Results are cached by field mask, defaults,
model identity/threshold/split and dataset revision.

[Calculation and limitations](../docs/evaluation.md#accuracy-with-available-inputs).

## Explanation paths and required artifacts

Both paths compute approximate permutation Shapley contributions in probability
units with up to 16 reference rows and four forward/reverse order pairs per row.

| Loaded model | Background | Perturbation |
|---|---|---|
| Baseline features | `shap_background.npz` | Move all transformed columns for one raw input together |
| Engineered features | `shap_raw_background.joblib` | Change one raw field and rerun frozen preprocessing |

The engineered path recalculates dependent values. Changing TG updates TG/HDL and
log1p(TG) whenever those features are enabled. Ratios and counts are not perturbed
independently or attributed to an arbitrary source field.

`/explain` accepts targets cad/lad/lcx/rca and `top_k` from 1 to 60. It returns
original input names/values, signed contributions, base probability, predicted
probability, the remaining contribution, sampling details and model version.

```text
base_value + sum(returned contributions) + remaining_contribution = probability
```

Contributions describe model behaviour, not medical causes. Errors are surfaced
rather than replaced with global feature importance. Missing prediction artifacts
produce 503; a missing explanation background produces 422 from the explanation
handler. `/health` does not verify background or evaluation files.
[Algorithm and limitations](../docs/explainability.md).

## Refreshing a serving bundle

Run the train → evaluate → metadata-export commands in the
[training guide](../training/README.md), then restart this service. Keep each
preprocessor, model, metadata, schema and background from the same run together.
`metrics.json` must describe the models being served.

`/model-info` includes `feature_set` and `engineered_features` for metadata that
records them. Historical metadata preserves the old response shape. A CAD-only
nested experiment is not a complete application bundle and its metadata differs
from the serving dashboard schema.

## Verification and runtime limits

From the repository root:

```bash
python3 -m pip install -r backend/requirements-test.txt
python3 -m unittest discover -s backend/tests -v
```

Tests cover input validation, saved-model compatibility, measured field-pattern
accuracy, HTTP contracts, explanation additivity and recomputation of derived
features. ML versions must match training for serialization compatibility.
Explanations do not require SHAP or numba.

CORS is open for local development. Authentication, rate limiting and persistence
are not implemented. This is a research service, not a clinical deployment.
