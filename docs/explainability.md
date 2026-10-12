# Explainability

`backend/services/explainer.py` estimates patient-specific permutation Shapley
contributions in probability units. `/explain` uses the same target-specific
frozen model and preprocessor as prediction. It requires no SHAP/numba runtime.

## Two explanation paths

| Model inputs | Saved background | What changes along a path |
|---|---|---|
| Baseline | Transformed rows in `shap_background.npz` | All encoded columns for one original feature move together |
| Engineered | Raw rows in `shap_raw_background.joblib` | One original field changes, then frozen preprocessing recalculates every model input |

The path is determined from the fitted preprocessor's output names, not the
current training defaults. The checked-in serving models use the baseline path.
New models with any of the eight engineered columns use the raw-input path.

For example, in a ratios-and-logs model, changing TG must change both TG/HDL and
log1p(TG). `RawPredictionModel` constructs each raw row, cleans it and applies the
saved preprocessor before prediction. A risk-factor count changes when its
constituents change. Generated columns are never treated as independent patient
measurements or assigned to an arbitrary source input.

Both paths return contributions named after the original 54 raw fields, matching
the form and explanation chart. A generated feature is not an additional form
field or a separately counted supplied measurement.

## Algorithm

1. Select up to 16 reference rows reproducibly from the saved training background
   using seed 42. New serving exports save up to 100 development rows.
2. For each reference, draw four random input orders and their reverses: eight
   complete paths per reference.
3. Start each path at the reference and replace one raw feature, or its entire
   baseline transformed group, with the patient's value at each step.
4. Evaluate positive-class probabilities for every step in a batch. Engineered
   paths rerun preprocessing for these rows without fitting anything.
5. Average each feature's marginal probability changes across paths/references.
6. Return the largest `top_k` absolute contributions and the sum of the omitted
   contributions as `remaining_contribution`.

The base value is the mean prediction for the sampled reference rows. It is not
necessarily the dataset prevalence or a prediction for an average patient.

## Additivity and response

```text
base_value + sum(features[].contribution) + remaining_contribution = probability
```

Each complete path telescopes from a reference prediction to the patient's
prediction. Averaging preserves additivity within floating-point tolerance;
top-k truncation is accounted for by the residual. With the current 54-input
schema and `top_k=60`, all raw features are returned.

| Field | Meaning |
|---|---|
| `method` | `permutation_shapley` |
| `signed`, `approximate` | Both true |
| `output_space` | `probability` |
| `base_value` | Mean prediction over sampled reference rows |
| `probability` | This patient's model prediction |
| `features` | Raw input names, values and signed contributions |
| `remaining_contribution` | Sum of contributions omitted by top-k selection |
| `background_rows`, `permutations_per_background` | Actual sampling sizes |
| `model_version` | Model/preprocessor fingerprint added by the HTTP endpoint |
| `input_signature` | Fingerprint of validated effective inputs and explicitly supplied field names |
| `output_value`, `explained_class` | Additive model output and positive class (`1`) |
| `total_features`, `baseline_definition`, `additivity_tolerance` | Full contribution count, reference definition and backend numeric tolerance |
| `features[].provenance` | `status`, `method`, and description derived from validated request fields |
| `reliability` | Saved evaluation metadata for this artifact; absent metrics remain unavailable |

A contribution of +0.12 is an upward change of 12 probability percentage points
under this explanation method and reference population. It is not a clinical
risk ratio or causal effect. The frontend identifies defaulted fields using the
assessment's input provenance; a default value is not a measured patient value.

## Interactive dashboard

The compact summary uses `/predict`'s classification and `threshold`, including
the exact backend fallback when artifact metadata does not specify a threshold.
The frontend never supplies its own classification. The margin is
`100 * (probability - threshold)` percentage points.

`ExplainabilityCard.tsx` retains the horizontal diverging chart and top-eight
absolute-contribution ranking. Native button rows provide keyboard activation,
expandable feature details, signed numeric labels and readable raw-feature names.
The bars use a shared CSS scale so labels, source badges and focus targets can
wrap on narrow screens without SVG label clipping. Show all features replaces
the former separate values table; every returned feature can be inspected there.
Escape and Close dismiss details and restore focus. New assessments or targets
reset details; input/model/probability mismatches suppress the explanation.

The server distinguishes `recorded` (explicit request fields, including zero and
values equal to defaults) from `default` (`schema_default`). It does not certify
measurement acquisition. Explicit nulls are rejected. These serving defaults
are inserted before preprocessing, so missing raw API fields are not labeled
as training-fitted median imputation. The UI also supports `measured`, `imputed`
and `unavailable` when explicitly supplied by a source pipeline; it never derives
provenance from a feature's value or contribution sign.

The waterfall verifies the response identity and checks additivity within
`1e-6` output units before rendering. It combines hidden and top-k-omitted
contributions, even when they cancel, and displays intermediate cumulative sums
in the documented output space. Intermediate sums are not additional patient
predictions. Missing space, baseline, invalid data or a failed sum produces an
unavailable message. Legacy/demo responses do not acquire invented units,
thresholds, patient provenance or an additive waterfall.

Reliability comes from `metrics.json` and target `metadata.json` in the serving
artifact directory. AUROC, sensitivity and specificity use the saved held-out
evaluation; specificity is `tn / (tn + fp)`. The CV Brier score is explicitly
labeled as a **model-selection** score. Missing calibration assessment, external
validation, validation-population description and local attribution stability
remain unavailable. `stability_top10_jaccard` measures global gain-importance
overlap and is not patient-specific Shapley stability. The existing optional
artery cutaway remains separate and carries a permanently visible illustrative
plaque disclaimer.

## Consistency checks

Backend tests verify agreement with prediction, full/top-k additivity, repeatable
sampling, patient dependence, grouped one-hot columns and known synthetic linear
attributions. `test_engineered_explanations.py` also verifies that changing a raw
lab updates its dependent ratio and log value and that all returned names remain
raw input names.

The metadata fingerprint lets the frontend detect explanations from a different
loaded model than the completed assessment. Restart the backend after replacing
models or backgrounds because both are cached.

## Interpretation limits

Finite order/reference sampling makes these approximate attributions. Exact
additivity does not establish exact Shapley values, causal validity or attribution
stability. A correlated-feature path can still combine measurements from different
patients in unrealistic ways. Recomputing engineered features preserves their
arithmetic relationships; it does not establish a realistic joint distribution
for every raw-field combination.

The form exposes all 54 optional inputs. Explanations include the effects of any
server defaults used to complete them. They explain the model's completed input,
not just the measurements actually supplied. They provide no lesion coordinates
and should not be interpreted as anatomical localisation.

## Artifact requirements and errors

Missing prediction artifacts produce HTTP 503. Explanation computation or
background-loading failures are returned as HTTP 422 by the current handler.
There is no global-importance fallback. In particular, engineered models require
`shap_raw_background.joblib`; a transformed background cannot substitute for it.

`/health` checks whether prediction models load. It does not certify that
explanation backgrounds or evaluation metadata are available. Keep the model,
preprocessor and both backgrounds from the same training export together.

See the [backend API reference](api-reference/backend.md#servicesexplainerpy)
for helper signatures and the [HTTP contract](api.md#post-explain) for examples.
