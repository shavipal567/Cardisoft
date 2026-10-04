# Explainability

Requirement: patient-specific, per-head feature attribution that reads as model
behavior, never clinical causality (PROBLEM.md §§19–21). Code:
`backend/services/explainer.py`, served at `POST /explain`.

## Design: SHAP first, labeled fallback

1. **Primary — SHAP TreeExplainer** (exact for RF/XGBoost): per-patient SHAP
   values over the 81 transformed features against the 100-row background in
   `artifacts/<head>/shap_background.npz`. Contributions are additive
   (sum to `probability − base_value`); `base_value` = expected value over
   background.
2. **Fallback — normalized gain importance**: if the `shap`/`numba` stack fails
   to import (observed in this env: `numba` vs `coverage` conflict), the
   endpoint stays up and returns `feature_importances_` weights with
   `method: "gain_importance_fallback"`. These sum to 1 and are a **ranking**,
   not additive attribution — the response says so. Permitted by §19
   ("model-specific feature importance … or other defensible method").

The `method` field always declares which you received. The `note` field always
carries the non-causality wording.

## Response fields

| Field | Meaning |
|---|---|
| `target` | `CAD/LAD/LCX/RCA` (request accepts lowercase) |
| `base_value` | SHAP: background expected value; fallback: train pos rate (CAD 0.7149) |
| `probability` | current head's predicted probability for this patient |
| `method` | `shap_tree` or `gain_importance_fallback` |
| `features[]` | top-k by \|contribution\|: `{name, value, contribution}` (+ `raw_value` in fallback) |
| `note` | model-behavior disclaimer + SHAP error class if fallback |

Feature `name`s are post-transform (`num__Age`, `cat__Sex_Male`, …); `value` is
the transformed coordinate, so pair it with the patient summary for human
reading (the planned physiological breakdown table: measurement | patient value
| contribution).

## Language rules (enforced in copy, review in PRs)

- Say: "RWMA had a positive contribution to this model prediction."
- Never: "RWMA caused the patient's CAD."
- Never present contributions as diagnosis, lesion evidence, or validated risk
  drivers.
