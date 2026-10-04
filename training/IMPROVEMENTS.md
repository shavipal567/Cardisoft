# Improvements backlog — training

Objective: maximize ROC-AUC (per scope decision). New dependencies allowed:
LightGBM, CatBoost. Frontend out of scope.

Full per-config CV numbers live in `training/artifacts/<target>/metadata.json`
(`all_cv_results`: 16 configs × 5 folds per target). This file records winners,
deltas, and next steps only.

## 1. Where we stand

Held-out test (61 rows, seed 42), from `artifacts/metrics.json`:

| target | acc | prec | rec | F1 | ROC-AUC | TN/FP/FN/TP |
|---|---|---|---|---|---|---|
| cad | 0.836 | 0.824 | 0.977 | 0.894 | 0.877 | 9/9/1/42 |
| lad | 0.787 | 0.795 | 0.861 | 0.827 | 0.839 | 17/8/5/31 |
| lcx | 0.639 | 0.571 | 0.333 | 0.421 | 0.693 | 31/6/16/8 |
| rca | 0.672 | 0.600 | 0.391 | 0.474 | 0.735 | 32/6/14/9 |

CV winners (mean CV AUC, tie-break F1) — all RandomForest; XGBoost compared
fairly and lost on every target:

| target | winner params | mean CV AUC | mean CV F1 | train pos rate |
|---|---|---|---|---|
| cad | RF n_est=200, depth=None, leaf=1 | 0.9272 | 0.9157 | 0.715 |
| lad | RF n_est=400, depth=8, leaf=2 | 0.8385 | 0.8089 | 0.583 |
| lcx | RF n_est=400, depth=None, leaf=1 | 0.7279 | 0.4550 | 0.393 |
| rca | RF n_est=200, depth=8, leaf=2 | 0.7343 | 0.4659 | 0.376 |

Grounding facts (measured on `dataset/dataset.csv`, n=303):

- Any vessel stenotic ⇒ CAD with P = 0.994–1.0 (LAD 0.994, LCX 1.0, RCA 1.0).
  CAD is nearly a deterministic OR of vessels — CAD gains come from
  vessel-signal improvements.
- Vessels co-occur: LCX stenotic → LAD stenotic 81%; RCA → LAD 76%;
  LAD → LCX 54% / RCA 49%. Independent per-vessel models ignore this.
- 61-row test set ⇒ roughly ±0.06 AUC noise. Deltas below that are seed luck
  without repeated CV.

## 2. Validation first (do before any model change)

- [ ] Repeated stratified 5-fold CV (×5–10 repeats) in `train.py`; report mean
      ± std of ROC-AUC per config. Keep the locked 80/20 test split untouched;
      select on CV only.
- [ ] Log PR-AUC + Brier score alongside ROC-AUC/F1 in CV results and
      `metadata.json` (ROC-AUC selects; PR-AUC exposes LCX/RCA ranking quality
      under ~38% prevalence).
- [ ] Append every run to `artifacts/experiments.csv` (config, CV
      AUC/PR-AUC/Brier, seed). Test AUC computed once, at the end.
- [ ] SHAP-stability check: top-10 features must substantially overlap across
      CV repeats, else the model is memorizing folds.

## 3. Vessel-dependence modeling (biggest structural headroom)

- [ ] Classifier chains LAD → LCX → RCA using **out-of-fold predicted
      probabilities** as extra features (never true labels). OOF predictions
      must be fitted on train folds only — true LAD/LCX/RCA columns still never
      enter as features (PROBLEM.md §6).
- [ ] Multi-task alternative if chains disappoint (shared representation, 3
      heads).
- [ ] CAD-as-OR: compare learned CAD head vs `1 − Π(1 − P(vessel))` from vessel
      models by CV AUC; ship the winner. Given the 0.994–1.0 determinism, the
      derived score may win.
- [ ] `inference.py` / backend schema unchanged (still 4 probabilities).

## 4. New candidates (LightGBM + CatBoost + stacking)

- [ ] LightGBM with native categoricals (pass Sex/BBB/VHD/Region RWMA + Y/N
      flags as categorical, skip one-hot on its path).
- [ ] CatBoost (ordered boosting, strong on n<1k, raw categories).
- [ ] HistGradientBoosting as sklearn-native baseline.
- [ ] Regularized small grids: `num_leaves ∈ {7, 15, 31}`,
      `min_data_in_leaf ∈ {10, 20, 30}`, `lambda_l2`, feature/bagging fraction
      ~0.8. Shallow + high leaf minimum is the anti-overfit setting for n=242.
- [ ] Stacking: OOF predictions of RF + XGB + LGBM + CatBoost → LogReg
      meta-learner (typical +0.01–0.03 AUC on small tabular data).
- [ ] Pin new deps identically in `training/requirements.txt` and
      `backend/requirements.txt` (unpickling requires version match).

## 5. Feature engineering backlog (each judged by repeated-CV delta, not test)

- [ ] `log1p` on skewed labs: TG, FBS, WBC, PLT, ESR (today only RobustScaled).
- [ ] Ratios/counts: LDL/HDL, TG/HDL, non-HDL; comorbidity count
      (DM+HTN+smoking+FH+DLP); ECG abnormality count (Q+ST+T+LVH+BBB); symptom
      burden (Typical+Atypical+Dyspnea+Function Class).
- [ ] Winsorize TG/FBS/WBC/PLT/HDL/BUN at 1st/99th percentiles (review, never
      blind-drop — e.g. TG 1050 may be real).
- [ ] Ablations: VHD ordinal vs one-hot; Region RWMA ordinal vs one-hot; drop vs
      keep CHF/LowTH Ang; collapse ultra-rare Y-levels (CRF/CVA/Weak Pulse,
      n<12) into one "rare comorbidity" flag.

## 6. Calibration & reporting (protects the demo; doesn't raise AUC)

- [ ] Calibrate inside CV folds: isotonic for CAD/LAD, Platt/sigmoid for
      LCX/RCA. Report Brier score + calibration curves (PROBLEM.md asks for
      "preferably calibrated" vessel probabilities).
- [ ] Keep API threshold at 0.5; report Youden-J / F1-optimal thresholds per
      vessel in `metrics.json` so LCX/RCA recall (~0.33–0.39) is contextualized.

## 7. Non-goals (with reasons)

- No SMOTE/oversampling: on 303 rows with rare categorical levels it
  synthesizes implausible patients and inflates CV scores. Keep
  `class_weight`/`scale_pos_weight` + threshold reporting.
- No test-peeking loops (try N configs, keep best test AUC): with n=61 this
  guarantees overfitting to the test set.
- No vessel labels as inputs, including proxies like "number of stenotic
  vessels": violates PROBLEM.md §6 and would fake AUC ≈ 1.0.
- Don't chase LCX/RCA past ~0.80 without more data; name the ceiling
  (weak univariate signals, 114–119 positives) in docs instead.

## 8. Execution order

1. Repeated-CV harness + PR-AUC/Brier logging (unlocks honest comparison).
2. LightGBM/CatBoost candidates + stacking.
3. Classifier chains / CAD-as-OR experiment.
4. Feature-engineering ablations; keep repeated-CV winners only.
5. Calibration + final `evaluate.py` + metrics/docs refresh.
