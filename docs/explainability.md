# Explainability

`backend/services/explainer.py` computes **approximate patient-specific grouped
permutation Shapley values**, served by `/explain`. All four targets use the
same algorithm and their own frozen model/preprocessor/background.

## Algorithm

The implementation follows the
[SHAP permutation explainer](https://shap.readthedocs.io/en/stable/generated/shap.PermutationExplainer.html)
approach, using NumPy and `predict_proba` directly — no SHAP/numba dependency.

### Step-by-step walkthrough

1. **Select reference rows**: 16 reproducible reference rows from each target's
   100-row saved training background, using seed 42. These represent "typical"
   patients in the transformed feature space.

2. **Group transformed columns by original input**: One-hot encoded columns are
   grouped back to their source categorical input. The algorithm never replaces
   part of a categorical encoding on its own — all one-hot columns for a single
   categorical input move together as one unit.

3. **Sample feature orders**: For each reference row, sample 4 random feature
   orderings and their reverses (8 total orderings per reference). This creates
   diverse "paths" from the reference patient to the target patient.

4. **Walk from reference to patient**: For each ordering, start at the reference
   row and replace one feature group at a time with the patient's value. Record
   the model's positive-class probability at every step.

5. **Average marginal changes**: For each feature, compute the marginal probability
   change when that feature is added to the ordering. Average over all paths and
   all reference rows to get the final Shapley value.

### Concrete example

Given a 5-feature patient (A, B, C, D, E) and a reference row:

```
Ordering 1: A → C → B → E → D
  Step 0: reference            → P = 0.42
  Step 1: replace A             → P = 0.48  (A's marginal: +0.06)
  Step 2: replace C             → P = 0.55  (C's marginal: +0.07)
  Step 3: replace B             → P = 0.61  (B's marginal: +0.06)
  Step 4: replace E             → P = 0.65  (E's marginal: +0.04)
  Step 5: replace D             → P = 0.70  (D's marginal: +0.05)
```

Each feature's marginal contribution is averaged across all sampled orderings
and all 16 reference rows. The base value is the mean prediction over the
reference rows.

## Interpretation and response

| Field | Value | Meaning |
|---|---|---|
| `method` | `permutation_shapley` | Algorithm identifier |
| `signed` | `true` | Contributions can be positive or negative |
| `approximate` | `true` | Not exact TreeSHAP; uses finite sampling |
| `output_space` | `probability` | Contributions in probability units |
| `base_value` | float | Mean prediction over reference rows |
| `probability` | float | Final model prediction for this patient |

### Reading contributions

- **Positive contribution** (e.g., +0.12): this feature pushes the model's
  prediction **upward** by 12 percentage points
- **Negative contribution** (e.g., -0.03): this feature pushes the model's
  prediction **downward** by 3 percentage points
- **Defaulted features** (`"defaulted": true`): the value was not provided by
  the user; the server default was used. The contribution reflects the default
  value's effect, not a measured patient value.

### Additivity contract

```text
base_value + sum(features[].contribution) + remaining_contribution = probability
```

Complete paths telescope exactly. The residual accounts for top-k truncation.
At `top_k=60` all 54 original features are returned and the residual is zero.
The chart displays only eight of those.

## Why permutation Shapley (not TreeSHAP)

- **No fragile optional runtime**: SHAP's TreeExplainer has a broken numba import
  path in some environments. Permutation Shapley uses only NumPy and `predict_proba`.
- **Works with CatBoostNative**: CatBoost's custom adapter doesn't integrate
  cleanly with SHAP's tree-specific optimizations.
- **Grouped categories**: one-hot blocks move together naturally since the
  algorithm operates on the transformed feature space.
- **Trade-off**: Slower than TreeSHAP (requires multiple forward passes), but
  the 16-reference × 4-ordering design keeps it fast enough for interactive use.

## Quality guarantees

Regression tests in `backend/tests/test_system.py` verify:
- **Additivity**: `base_value + contributions + residual = probability` holds
- **Known linear attributions**: exact match on a synthetic linear model
- **Grouped categoricals**: one-hot columns always move together
- **Repeatability**: same patient → same explanation (seeded sampling)
- **Patient dependence**: different patients → different explanations
- **Agreement with /predict**: explanation probability matches prediction endpoint

## Limitations

- **Approximate**: Finite sampling (16 references × 4 orderings) affects
  attribution precision. Exact TreeSHAP would require more computation.
- **Correlated features**: When features are correlated, the algorithm may
  attribute importance differently than a clinician would expect. Correlated-feature
  combinations in the permutation paths need not represent realistic patients.
- **Model behavior, not causality**: A high Shapley value means the model relies
  on that feature heavily — it does **not** prove the feature causes the outcome.
- **Defaulted inputs**: When 45 of 54 fields use server defaults (as with the
  frontend's 19-field form), the explanation describes the completed model input,
  not exclusively measured patient values.
- **No lesion location**: Explanations are in probability units, not anatomical
  coordinates. They cannot and do not identify where plaque is located.

## Response failures

Failures are surfaced as errors (HTTP 422 or 503), never silently replaced
by global importance rankings. If the model or background artifacts are
missing, the endpoint returns 503 with a descriptive error message.
