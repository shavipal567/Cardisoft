# Evaluation

Code: `training/evaluate.py` → `training/artifacts/metrics.json`. Reports the
five required metrics (PROBLEM.md §10) per head, from the locked 61-row test
split (same seed as training, never used in fitting or selection).

## Results (v2 — repeated CV + new families)

CV: 10 repeats × 5 folds (seeds 42–51), selection on mean CV AUC, tie-break
mean CV F1. Test: same locked 61-row split as v1.

| Head | Winner | CV AUC | Test Acc/Prec/Rec/F1/AUC | TN/FP/FN/TP |
|---|---|---|---|---|
| cad | CatBoost native d4/lr.05/l2=3 | 0.9273±0.030 | 0.852/0.870/0.930/0.899/**0.893** | — |
| lad | RF 400/None/leaf2 | 0.8428±0.058 | 0.787/0.795/0.861/0.827/**0.843** | — |
| lcx | RF 400/None/leaf2 | 0.7400±0.060 | 0.672/0.611/0.458/0.524/**0.711** | — |
| rca | RF 400/8/leaf2 | 0.7067±0.068 | 0.672/0.600/0.391/0.474/**0.748** | — |

v1 → v2 test AUC: CAD 0.877→**0.893**, LAD 0.839→**0.843**,
LCX 0.693→**0.711** (recall 0.333→0.458, F1 0.421→0.524),
RCA 0.735→**0.748**. Winner stability (top-10 Jaccard): CAD 0.85,
LAD 0.83, LCX 0.66, RCA 0.77.

## Results (v1, superseded)

| Head | Acc | Prec | Rec | F1 | ROC-AUC | TN/FP/FN/TP |
|---|---|---|---|---|---|---|
| cad | 0.836 | 0.824 | 0.977 | 0.894 | 0.877 | 9/9/1/42 |
| lad | 0.787 | 0.795 | 0.861 | 0.827 | 0.839 | 17/8/5/31 |
| lcx | 0.639 | 0.571 | 0.333 | 0.421 | 0.693 | 31/6/16/8 |
| rca | 0.672 | 0.600 | 0.391 | 0.474 | 0.735 | 32/6/14/9 |

## How to read this honestly

- **CAD/LAD generalize.** CAD's 9 FP vs 1 FN reflects 71% prevalence plus
  `class_weight="balanced"` — expected, not a bug.
- **LCX/RCA are weak and recall-poor** (0.33–0.39): only 8/9 of ~24 positives
  detected. Causes: 114–119 positives total, overlapping vessel signals, sparse
  categorical levels. Reported as-is; the backlog (chains, LightGBM/CatBoost,
  calibration) targets exactly this.
- **±0.06 AUC noise** on n=61: treat small deltas as ties. The planned
  repeated-CV harness plus PR-AUC/Brier logging exists to stop seed-luck
  chasing.
- Probabilities are **uncalibrated RF votes** in v1 (isotonic/Platt calibration
  backlogged). Don't present them as validated risk percentages.

## Methodology guarantees

1. Preprocessing fitted on train only (inside CV folds; refit on train split).
2. Leakage columns excluded from all heads (verified: zero leakage strings in
   output features).
3. Selection on CV metrics; test scored once per artifact set.
4. Deterministic: `random_state=42` everywhere (split, CV, models, background).

## Still missing (per PROBLEM.md §10/§28)

ROC/PR curves, probability calibration plots, and the 6-page submission write-up
— all backlogged. Class distributions and confusion counts are already in
`metrics.json`.
