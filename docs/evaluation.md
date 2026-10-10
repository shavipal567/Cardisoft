# Evaluation

`training/evaluate.py` evaluates frozen artifacts on each target's 61-row
stratified test split (seed 42) and writes `training/artifacts/metrics.json`.
Model selection uses 10 repeats of 5-fold CV on the separate 242-row training set.

## Held-out test results (v2)

| Target | Accuracy | Precision | Recall | F1 | ROC-AUC | TN/FP/FN/TP |
|---|---:|---:|---:|---:|---:|---|
| CAD | .852 | .870 | .930 | .899 | .893 | 12/6/3/40 |
| LAD | .787 | .795 | .861 | .827 | .843 | 17/8/5/31 |
| LCX | .672 | .611 | .458 | .524 | .711 | 30/7/13/11 |
| RCA | .672 | .600 | .391 | .474 | .748 | 32/6/14/9 |

CV ROC-AUC is .9273/.8428/.7400/.7067 respectively.
The API's `/model-info` endpoint reads the actual saved metadata and metrics.
Frontend baselines use test prevalence so they refer to the same cohort.

## v1 vs v2 comparison

| Target | v1 Test AUC | v2 Test AUC | Change |
|---|---:|---:|---:|
| CAD | 0.877 | 0.893 | +0.016 |
| LAD | 0.839 | 0.843 | +0.004 |
| LCX | 0.693 | 0.711 | +0.018 |
| RCA | 0.735 | 0.748 | +0.013 |

v1 used single 5-fold CV with RF/XGB only. v2 added 10 repeats, five more model
families, CatBoost-native, stacking, soft voting ensemble, PR-AUC/Brier metrics,
and the experiments log.

## Reading the results honestly

**CAD and LAD generalize well.** CAD achieves 0.893 AUC with 93% recall, meaning
it correctly identifies 40 of 43 positive patients. LAD at 0.843 AUC with 86%
recall is clinically useful for decision support.

**LCX and RCA miss more than half of positive test cases at threshold 0.5.**
LCX recall is 0.458 (detects 11 of 24 positives) and RCA recall is 0.391
(detects 9 of 23 positives). This is expected on 303 rows with ~38% prevalence
and sparse signals. These scores are reported as-is rather than tuned away.

**Probabilities remain uncalibrated.** The models output raw `predict_proba`
values without Platt or isotonic scaling. A probability of 0.7 does not mean
a 70% chance of disease in a validated clinical sense.

**Small test set noise.** With n=61, AUC has roughly ±0.06 noise. Small score
differences should not be treated as reliable improvements without uncertainty
estimates and further validation.

## Leakage prevention

The evaluation pipeline enforces:
- Outer-fold preprocessing excludes validation data
- Target labels are excluded from every head
- Selection uses CV rather than the test scores
- The 61 test patients are never used in fitting

The optional stack has an inner-fold preprocessing limitation described in
[Models](models.md).

## Calibration status

Calibration (Platt/isotonic) is **not yet shipped**. It is backlogged in
`training/IMPROVEMENTS.md` §6. When implemented:
- Isotonic calibration for CAD/LAD (more data, non-parametric)
- Platt/sigmoid calibration for LCX/RCA (smaller positive count)
- Report Brier score + calibration curves alongside AUC
- Keep API threshold at 0.5; report Youden-J / F1-optimal thresholds per vessel

## After retraining and evaluation

Export the explicitly offline metadata snapshot for the frontend:

```bash
python training/model_info.py --output frontend/public/model-info.json
```

## Outstanding deliverables

- Calibration plots, ROC/PR curves
- External validation on a separate cohort
- The six-page submission document
- Demonstration video (3-10 minutes)
