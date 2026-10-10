# Explainability

`backend/services/explainer.py` computes **approximate patient-specific grouped
permutation Shapley values**, served by `/explain`. All four targets use the
same algorithm and their own frozen model/preprocessor/background.

## Algorithm

1. Select 16 reproducible reference rows from each target's 100-row saved
   training background, using seed 42.
2. Group transformed columns by original input, including entire one-hot
   blocks. Never replace part of a categorical encoding on its own.
3. For each reference, sample four feature orders and their reverses. Walk
   from reference to patient by replacing one feature group at a time.
4. Evaluate the model's positive-class probability for every step in a batch.
5. Average marginal probability changes over all paths for each feature.

This follows the permutation-attribution approach described in the
[SHAP permutation explainer documentation](https://shap.readthedocs.io/en/stable/generated/shap.PermutationExplainer.html).
Our implementation uses NumPy and `predict_proba` directly, so it works with
CatBoostNative as well as Random Forest without the broken SHAP/numba import path.
It is an approximation, not exact TreeSHAP. Finite sampling affects attribution
precision; correlated-feature combinations need not represent realistic patients.

## Interpretation and response

`method` is `permutation_shapley`; `signed` and `approximate` are true;
`output_space` is probability. The base value is the mean prediction over the
selected reference rows. Positive contributions raise the model estimate;
negative contributions lower it. Contributions are in probability units
(0.01 means one percentage point), not log odds or feature-importance weights.

Complete paths telescope, so:

```text
base_value + sum(features[].contribution) + remaining_contribution = probability
```

The residual accounts for top-k truncation. At top_k=60 all 54 original features
are returned and the residual is zero. The chart displays only eight of those.
Raw feature values accompany contributions; uncollected fields use server defaults.
This explains the completed model input, not exclusively measured patient values.

Failures are surfaced as errors, not silently replaced by global importance.
Regression tests check additivity, known linear attributions, grouped categoricals,
repeatability, patient dependence and agreement with `/predict` for all four models.
Explanations describe model behavior, never medical causality or lesion location.
