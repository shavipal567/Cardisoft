# Models

Source: `training/train.py`, with frozen selections in each target's
`training/artifacts/<target>/metadata.json`.

## Feature sets and saved models

The training code supports six fixed feature sets. New legacy training runs
default to CAD `logs`, LAD `counts`, LCX `ratios_counts` and RCA `baseline` via
`--feature-set auto`. An explicit override applies to every requested target.
All 32 candidate configurations for a target use the same resolved feature set;
the search does not choose among feature sets. See
[Feature engineering](feature-engineering.md) for formulas and selection evidence.

The checked-in models below still use `baseline`. Their metadata predates the
`feature_set` field; changing a training default does not modify a frozen model.

## Serving-model protocol and new CAD experiments

The frozen serving models below retain their original selection. For new CAD
experiments use the [nested validation protocol](cad-nested-validation.md):
inner folds select the CatBoost configuration, stopping count, calibration and
threshold; outer folds evaluate the complete procedure. Experimental models
are saved separately and do not automatically replace the serving artifacts.
The historical winner's CV scores below reuse selection folds and can be
optimistic; they are not nested estimates of the full model search.

Each of CAD, LAD, LCX and RCA has an independent stratified 80/20 split with
seed 42: 242 train and 61 test patients. Selection uses 10 repeats of 5-fold
CV on the training partition (seeds 42–51), with a preprocessor fitted inside
each CV selection fold. Mean ROC-AUC selects the winner; mean F1 breaks ties.
PR-AUC and Brier scores are also recorded. Test data does not enter selection.
Voting F1 uses the threshold tuned on the outer training fold; other candidates
use 0.5. Probability metrics use the positive-class column directly.

32 configurations per target: 8 Random Forest, 8 XGBoost, 4 HistGradientBoosting,
6 LightGBM, 4 CatBoost, 1 RF/XGB/HGB stack with a logistic-regression meta-model,
and 1 soft voting ensemble (RF + XGB + HGB + LGBM + CatBoost + ElasticNet).
RF/XGB/HGB/stack use one-hot preprocessing; LightGBM/CatBoost use native categorical codes;
the voting ensemble uses one-hot + StandardScaler(with_mean=False).
Stacking and voting now fit preprocessing independently inside each inner fold
before computing OOF predictions. Historical ensemble scores used outer-fold
transforms and have not been regenerated under this fix (2026-10-11).
Neither ensemble won a saved target.

## Saved winners

| Target | Saved winner | CV ROC-AUC | Test ROC-AUC |
|---|---|---:|---:|
| CAD | CatBoost, depth 4, learning rate .05, L2 3 | .9273 | .8928 |
| LAD | RF, 400 trees, unlimited depth, leaf minimum 2 | .8428 | .8433 |
| LCX | RF, 400 trees, unlimited depth, leaf minimum 2 | .7400 | .7106 |
| RCA | RF, 400 trees, depth 8, leaf minimum 2 | .7067 | .7483 |

The existing baseline bundle contains preprocessors, models, transformed
training backgrounds and metadata. Its CAD preprocessor produces 54 columns;
the vessel preprocessors produce 81. Engineered sets have different widths,
documented in [Preprocessing](preprocessing.md#feature-sets-and-dimensions). New runs also
export `feature_schema.json` and `shap_raw_background.joblib`, preserving the
raw reference rows required to explain engineered models. Model inference
uses the saved preprocessor and does not rebuild it from current defaults.

## Model families

### Random Forest

`RandomForestClassifier(class_weight="balanced", n_jobs=-1)` — 8 configurations
varying `n_estimators` (200, 400), `max_depth` (8, None), and `min_samples_leaf` (1, 2).
Won all three vessel targets in the saved baseline run.

### XGBoost

`XGBClassifier(tree_method="hist", subsample=colsample=0.8, reg_lambda=1.0)` —
8 configurations varying `n_estimators`, `max_depth` (3, 4), and `learning_rate` (0.05, 0.1).
Uses `scale_pos_weight` for class imbalance. Did not win any target in v2.

### HistGradientBoosting

`HistGradientBoostingClassifier(class_weight="balanced")` — 4 configurations
varying `max_leaf_nodes` (15, 31) and `min_samples_leaf` (10, 20).
Sklearn-native gradient boosting baseline. Did not win any target.

### LightGBM

`LGBMArrayClassifier`, a subclass of `LGBMClassifier`, with native categorical
features — 6 configurations varying
`num_leaves` (7, 15, 31) and `min_child_samples` (10, 20). Uses `feature_fraction=0.8`
and `n_estimators=300`. Did not win a target in the saved baseline run.

The adapter in `training/native_models.py` also backs the LightGBM voting
member. At prediction time it attaches LightGBM's fitted feature names to dense
NumPy inputs. This prevents repeated sklearn feature-name warnings while
preserving probability values and positional feature order.

### CatBoost

`CatBoostNative` adapter with integer categorical casting — 4 configurations
varying `depth` (4, 6) and `l2_leaf_reg` (3, 10). The saved model resolves to
**Plain** boosting with symmetric trees (verified with `get_all_params()`),
`auto_class_weights="Balanced"`, `iterations=400`, `learning_rate=0.05`.
Wins CAD target. It uses all 400 iterations without early stopping and does
not optimize F2. The separate nested protocol evaluates early stopping and
calibration using this adapter. It also accepts a fixed candidate feature set;
its comparator always uses original inputs.

### Stacking

`StackedModel` in `training/stacking.py` — RF + XGB + HGB base models with
inner 3-fold out-of-fold predictions feeding a `LogisticRegression` meta-learner.
Uses the one-hot track, fitted separately inside each inner training fold.
Did not win any target.

### Voting

`VotingClassifier` in `training/voting.py` — soft voting over six base models:
RF, XGB, HGB, LGBM, CatBoost, and ElasticNet. Uses the voting track (one-hot +
`StandardScaler(with_mean=False)`). Member weights and decision threshold are
grid-searched on out-of-fold CV predictions to maximize F2 (accuracy tiebreak,
then recall). Top-4 models by individual CV F2 are selected for the weight search.
Did not win any target.

`fit_voting()` uses inner 3-fold CV when scoring an outer fold, and inner
5-fold CV for winner stability and final refitting. The repeat seed controls
both member estimators and inner splits; the final refit uses seed 42.

`predict_proba(X)` returns `(n_samples, 2)` with rows `[P(0), P(1)]`, matching
every other saved classifier. `predict(X)` applies the tuned threshold to
column 1. A voting winner saves its threshold and member weights in
`metadata.json`; evaluation and inference read that threshold, with 0.5 as
the default when absent.

## Feature stability

The following historical baseline values are recorded in each target's
`metadata.json`. Stability refits the winning configuration on the development
partition with different seeds and compares its top-10 importance sets using
mean pairwise Jaccard similarity:

| Target | Stability |
|---|---|
| CAD | 0.85 |
| LAD | 0.83 |
| LCX | 0.66 |
| RCA | 0.77 |

Higher values indicate more overlap in the important feature sets across seed
refits. This is neither independent validation nor a patient-level explanation
stability test; a low score alone does not establish its cause.

If voting wins, stability refits and re-tunes the ensemble for each seed on
the training partition. Its feature importance vector is the unweighted mean
of normalised member importances. Members without importances, such as HGB
and ElasticNet, are skipped, as are members with zero total importance.

## Regression checks

Training saves per-stage metric curves for the winning configuration by
default; `--learning-curves all` saves every candidate. See
[Stored learning curves](evaluation.md#stored-learning-curves) for file paths,
metrics, fold provenance and the distinction between iterations and tree counts.

From the repository root, run:

```bash
python -m unittest discover -s training/tests -v
```

Checks cover the voting probability/threshold contract, missing member
importances, saving and loading a voting winner for evaluation and inference,
and LightGBM native/voting predictions with warnings treated as errors. They
also compare LightGBM probabilities with the unadapted estimator and exercise
cloning, serialisation and invalid input handling. These focused checks use
small models; they do not rerun the full search.

## Current limits

- Uncalibrated probabilities (no Platt/isotonic scaling shipped)
- Small single-source dataset (n=303, no external validation)
- Weak LCX/RCA recall (~0.46 and ~0.39 at threshold 0.5)
- No vessel-dependence modeling (classifier chains, CAD-as-OR are backlogged)
- Engineered features are implemented; their exploratory gains need validation
  and the serving bundle has not been retrained with them

See `training/IMPROVEMENTS.md` for the full backlog and execution order.
