# Problem formulation

Source of truth: `../PROBLEM.md` (challenge spec, 35 sections). This page is the
one-paragraph-per-question digest.

## What are we predicting?

Four binary targets from structured clinical data (dataset: 303 patients):

| Head | CSV column | Positive label | Prevalence |
|---|---|---|---|
| CAD (overall) | `Cath` → `CAD` | coronary disease (≥50% narrowing in ≥1 major vessel) | 71.3% |
| LAD stenosis | `LAD` → `Stenotic` | left anterior descending narrowing | 58.4% |
| LCX stenosis | `LCX` → `Stenotic` | left circumflex narrowing | 39.3% |
| RCA stenosis | `RCA` → `Stenotic` | right coronary artery narrowing | 37.6% |

Each head outputs `{prediction: 0/1, probability: 0.00–1.00}` at threshold 0.5.
Probabilities are model scores, **not** medically validated risk percentages
unless calibrated and validated as such (PROBLEM.md §11).

## Required pipeline

```text
Clinical data → preprocessing → leakage prevention → feature engineering
  → CAD model + vessel models (LAD/LCX/RCA) → probabilities
  → explainability + 3D mapping → clinical dashboard (FastAPI + frontend)
```

Weights: predictive performance 30%, 3D visualization 25%, interpretability
20%, system integration 15%, technical implementation 10%.

## Hard constraints

1. **Leakage**: `LAD, LCX, RCA, Cath` must never be model inputs for any head
   (§6). Enforced in `training/preprocessing.py`, verified post-training.
2. **No lesion localization**: the tabular dataset has no lesion coordinates,
   plaque geometry, or imaging. Highlighting LAD means "elevated predicted LAD
   stenosis probability" — never "plaque found here" (§15, §27).
3. **Explanations ≠ causality**: SHAP contributions describe the model, not the
   patient's biology (§20).
4. **Disclaimer visible** in the interface (§26); also carried by `GET /health`.

## Current scope status

Built: leakage-safe training (`training/`), FastAPI predict/explain
(`backend/`), evaluation + metrics, React dashboard with patient form, PDF
report scanner, risk cards, per-vessel explanations, and the schematic 3D
heart (`frontend/`). See [visualization](visualization.md) for the 3D
contract.
