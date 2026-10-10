# Models

Source: `training/train.py`, with frozen selections in each target's
`training/artifacts/<target>/metadata.json`.

## Current protocol

Each of CAD, LAD, LCX and RCA has an independent stratified 80/20 split with
seed 42: 242 train and 61 test patients. Selection uses 10 repeats of 5-fold
CV on the training partition (seeds 42–51), with a preprocessor fitted inside
each outer fold. Mean ROC-AUC selects the winner; mean F1 breaks ties.
PR-AUC and Brier scores are also recorded. Test data does not enter selection.

31 configurations per target: 8 Random Forest, 8 XGBoost, 4 HistGradientBoosting,
6 LightGBM, 4 CatBoost, and 1 RF/XGB/HGB stack with a logistic-regression meta-model.
RF/XGB/HGB/stack use one-hot preprocessing; LightGBM/CatBoost use native categorical codes.
The stack's inner OOF predictions operate on data transformed at the outer-fold
level; fitting preprocessing again inside each inner fold remains an improvement.
The stack did not win any target.

| Target | Saved winner | CV ROC-AUC | Test ROC-AUC |
|---|---|---:|---:|
| CAD | CatBoost, depth 4, learning rate .05, L2 3 | .9273 | .8928 |
| LAD | RF, 400 trees, unlimited depth, leaf minimum 2 | .8428 | .8433 |
| LCX | RF, 400 trees, unlimited depth, leaf minimum 2 | .7400 | .7106 |
| RCA | RF, 400 trees, depth 8, leaf minimum 2 | .7067 | .7483 |

Artifacts contain a preprocessor, model, 100-row transformed training background,
and metadata. CAD transforms into 54 columns; the saved vessel preprocessors
produce 81 columns. CatBoostNative casts categorical codes to integer columns
at fit and prediction. Model inference is shared by the backend.

Current limits: uncalibrated probabilities, a small single-source dataset,
weak LCX/RCA recall and no external validation. Calibration, derived-feature
ablations and vessel-dependence models remain experiments, not shipped features.
