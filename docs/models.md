# Models

Source: `training/train.py`, with frozen selections in each target's
`training/artifacts/<target>/metadata.json`.

## Current protocol

Each of CAD, LAD, LCX and RCA has an independent stratified 80/20 split with
seed 42: 242 train and 61 test patients. Selection uses 10 repeats of 5-fold
CV on the training partition (seeds 42–51), with a preprocessor fitted inside
each outer fold. Mean ROC-AUC selects the winner; mean F1 breaks ties.
PR-AUC and Brier scores are also recorded. Test data does not enter selection.

32 configurations per target: 8 Random Forest, 8 XGBoost, 4 HistGradientBoosting,
6 LightGBM, 4 CatBoost, 1 RF/XGB/HGB stack with a logistic-regression meta-model,
and 1 soft voting ensemble (RF + XGB + HGB + LGBM + CatBoost + ElasticNet).
RF/XGB/HGB/stack use one-hot preprocessing; LightGBM/CatBoost use native categorical codes;
the voting ensemble uses one-hot + StandardScaler(with_mean=False).
The stack's inner OOF predictions operate on data transformed at the outer-fold
level; fitting preprocessing again inside each inner fold remains an improvement.
The stack did not win any target.

## Saved winners

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

## Model families

### Random Forest

`RandomForestClassifier(class_weight="balanced", n_jobs=-1)` — 8 configurations
varying `n_estimators` (200, 400), `max_depth` (8, None), and `min_samples_leaf` (1, 2).
Wins all three vessel targets. Robust to small data with balanced class weights.

### XGBoost

`XGBClassifier(tree_method="hist", subsample=colsample=0.8, reg_lambda=1.0)` —
8 configurations varying `n_estimators`, `max_depth` (3, 4), and `learning_rate` (0.05, 0.1).
Uses `scale_pos_weight` for class imbalance. Did not win any target in v2.

### HistGradientBoosting

`HistGradientBoostingClassifier(class_weight="balanced")` — 4 configurations
varying `max_leaf_nodes` (15, 31) and `min_samples_leaf` (10, 20).
Sklearn-native gradient boosting baseline. Did not win any target.

### LightGBM

`LGBMClassifier` with native categorical features — 6 configurations varying
`num_leaves` (7, 15, 31) and `min_child_samples` (10, 20). Uses `feature_fraction=0.8`
and `n_estimators=300`. Strong on small datasets but lost to CatBoost and RF.

### CatBoost

`CatBoostNative` adapter with integer categorical casting — 4 configurations
varying `depth` (4, 6) and `l2_leaf_reg` (3, 10). Uses ordered boosting,
`auto_class_weights="Balanced"`, `iterations=400`, `learning_rate=0.05`.
Wins CAD target.

### Stacking

`StackedModel` in `training/stacking.py` — RF + XGB + HGB base models with
inner 3-fold out-of-fold predictions feeding a `LogisticRegression` meta-learner.
Uses one-hot track. Inner preprocessing isolation remains a limitation.
Did not win any target.

### Voting

`VotingClassifier` in `training/voting.py` — soft voting over six base models:
RF, XGB, HGB, LGBM, CatBoost, and ElasticNet. Uses the voting track (one-hot +
`StandardScaler(with_mean=False)`). Member weights and decision threshold are
grid-searched on out-of-fold CV predictions to maximize F2 (accuracy tiebreak,
then recall). Top-4 models by individual CV F2 are selected for the weight search.
Did not win any target.

## Feature stability

Top-10 feature importance stability (mean pairwise Jaccard across repeat seeds)
is recorded in each target's `metadata.json`:

| Target | Stability |
|---|---|
| CAD | 0.85 |
| LAD | 0.83 |
| LCX | 0.66 |
| RCA | 0.77 |

Higher values indicate the model consistently relies on the same features
across CV repeats. LCX's lower stability reflects its weaker signal.

## Current limits

- Uncalibrated probabilities (no Platt/isotonic scaling shipped)
- Small single-source dataset (n=303, no external validation)
- Weak LCX/RCA recall (~0.46 and ~0.39 at threshold 0.5)
- No vessel-dependence modeling (classifier chains, CAD-as-OR are backlogged)
- No derived features (log transforms, domain composites are backlogged)

See `training/IMPROVEMENTS.md` for the full backlog and execution order.
