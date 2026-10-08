# Models

Code: `training/train.py`. Four independent binary heads (one per target),
shared preprocessing, shared protocol.

## Protocol (identical for cad/lad/lcx/rca)

- Stratified 80/20 split, `random_state=42` → 242 train / 61 test.
- Stratified 5-fold CV on train; preprocessor fitted **inside each fold** via
  `Pipeline(prep → clf)`.
- 16 configs × 5 folds = 80 fits per head, 320 total (CPU-minutes).
- Selection: highest mean CV ROC-AUC, tie-break mean CV F1. Winner refit on
  full train; test split never touched until `evaluate.py`.

## Search space

| Family | Configs | Settings |
|---|---|---|
| RandomForest (`class_weight="balanced"`) | 8 | `n_estimators ∈ {200,400}`, `max_depth ∈ {8,None}`, `min_samples_leaf ∈ {1,2}` |
| XGBoost (`tree_method="hist"`, `subsample=colsample=0.8`, `reg_lambda=1.0`) | 8 | `n_estimators ∈ {200,400}`, `max_depth ∈ {3,4}`, `learning_rate ∈ {0.05,0.1}`, `scale_pos_weight` from train balance |

XGBoost is explicitly allowed (PROBLEM.md §8); it was fairly compared and lost
on CV AUC for all four heads in this run.

## Winners v2 (10 repeats × 5 folds; full tables in `artifacts/<target>/metadata.json`)

| Head | Winner | Mean CV AUC | Mean CV F1 | Stability Jaccard | Artifact size |
|---|---|---|---|---|---|
| cad | CatBoost native, depth 4 / lr 0.05 / l2 3 | 0.9273±0.030 | 0.9074 | 0.85 | — |
| lad | RF 400/None/leaf2 | 0.8428±0.058 | 0.8181 | 0.83 | — |
| lcx | RF 400/None/leaf2 | 0.7400±0.060 | 0.5103 | 0.66 | — |
| rca | RF 400/8/leaf2 | 0.7067±0.068 | 0.4377 | 0.77 | — |

Notes: v1 (single 5-fold) winners were all RF (CAD 0.9272 / LAD 0.8385 /
LCX 0.7279 / RCA 0.7343). Under 10 repeats, CatBoost-native takes CAD,
RF holds elsewhere with shifted configs; notably v1's RCA pick (0.7343)
was seed luck — its honest mean is 0.7067. LightGBM-native, HistGBM and
the LogReg stack were fairly compared and lost on every head (see
`artifacts/experiments.csv`). Native track: integer-coded categoricals
(`build_native_preprocessor`); one-hot track unchanged.

## Winners v1 (superseded, single 5-fold CV)

| Head | Winner | Mean CV AUC | Mean CV F1 | Artifact size |
|---|---|---|---|---|
| cad | RF 200/None/leaf1 | 0.9272 | 0.9157 | ~1.3M |
| lad | RF 400/8/leaf2 | 0.8385 | 0.8089 | ~2.2M |
| lcx | RF 400/None/leaf1 | 0.7279 | 0.4550 | ~3.3M |
| rca | RF 200/8/leaf2 | 0.7343 | 0.4659 | ~1.2M |

## Artifacts (`training/artifacts/<head>/`)

- `preprocessor.joblib` — fitted transformer (train-only fit).
- `model.joblib` — fitted classifier (all RF in v1).
- `shap_background.npz` — 100 transformed train rows (seeded) for TreeSHAP.
- `metadata.json` — column/positive label, split sizes, pos rates, winning
  config, **all 16 CV results**, seed, git hash.

Tracked in git (~7.9M total) because `backend/` loads them at startup.
`ARTIFACTS_DIR` env var overrides the location.

## Next candidates

LightGBM (native categoricals), CatBoost (ordered boosting, strong at n<1k),
HistGBM baseline, RF+XGB+LGBM+CatBoost stacking, classifier chains over
vessel co-occurrence, CAD-as-OR ensemble — see `training/IMPROVEMENTS.md`.
