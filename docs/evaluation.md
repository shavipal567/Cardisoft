# Evaluation

`training/evaluate.py` evaluates frozen artifacts on each target's 61-row
stratified test split (seed 42) and writes `training/artifacts/metrics.json`.
Model selection uses 10 repeats of 5-fold CV on the separate 242-row training set.

| Target | Accuracy | Precision | Recall | F1 | ROC-AUC | TN/FP/FN/TP |
|---|---:|---:|---:|---:|---:|---|
| CAD | .852 | .870 | .930 | .899 | .893 | 12/6/3/40 |
| LAD | .787 | .795 | .861 | .827 | .843 | 17/8/5/31 |
| LCX | .672 | .611 | .458 | .524 | .711 | 30/7/13/11 |
| RCA | .672 | .600 | .391 | .474 | .748 | 32/6/14/9 |

These are the current saved v2 results: CatBoost for CAD and Random Forest
for the vessels. CV ROC-AUC is .9273/.8428/.7400/.7067 respectively.
The API's `/model-info` endpoint reads the actual saved metadata and metrics.
Frontend baselines use test prevalence so they refer to the same cohort.

LCX and RCA miss more than half of positive test cases at threshold 0.5.
The test set is small and drawn from the same source as training; these scores
are not evidence of external validation. Probabilities remain uncalibrated.
Small score differences should not be treated as reliable improvements without
uncertainty estimates and further validation.

Outer-fold preprocessing excludes validation data, target labels are excluded
from every head, and selection uses CV rather than the test scores. The optional
stack has an inner-fold preprocessing limitation described in [models](models.md).
Calibration plots, ROC/PR curves, external validation, the six-page submission
and demonstration video remain outstanding deliverables.

After retraining and evaluation, export the explicitly offline metadata snapshot:

```bash
python training/model_info.py --output frontend/public/model-info.json
```
