# Improvements backlog — training

Objective: maximize ROC-AUC (per scope decision). New dependencies allowed:
LightGBM, CatBoost. Frontend out of scope.

## v2 status (done — 10 repeats × 5 folds, seeds 42–51)

Winners by mean CV AUC (tie-break F1); test on locked 61-row split:

| target | winner | CV AUC | test AUC | v1 test AUC | stability |
|---|---|---|---|---|---|
| cad | CatBoost native d4/lr.05/l2=3 | 0.9273±0.030 | 0.893 | 0.877 | 0.85 |
| lad | RF 400/None/leaf2 | 0.8428±0.058 | 0.843 | 0.839 | 0.83 |
| lcx | RF 400/None/leaf2 | 0.7400±0.060 | 0.711 | 0.693 | 0.66 |
| rca | RF 400/8/leaf2 | 0.7067±0.068 | 0.748 | 0.735 | 0.77 |

Takeaways: CatBoost-native takes CAD; RF holds the vessels (LGBM-native,
HistGBM, LogReg stack fairly compared, lost everywhere —
`artifacts/experiments.csv`). v1's RCA pick (single-CV 0.7343) was seed
luck; honest mean 0.7067. LCX recall 0.333→0.458. Done below: §2
(repeated-CV harness, PR-AUC/Brier, experiments.csv, stability check) and
§4 candidates. Remaining: §3 chains/CAD-as-OR, §5 features, §6 calibration.

Full per-config CV numbers live in `training/artifacts/<target>/metadata.json`
(`all_cv_results`: 32 configs × 10 repeats × 5 folds per target, including voting).
The current search spans seven families. This file records winners,
deltas, and next steps only.

## 1. Historical v1 baseline (superseded by v2 above)

Historical held-out test (61 rows, seed 42). Current `artifacts/metrics.json`
contains the v2 results, not these historical scores:

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

## 2. Validation harness (implemented)

- [x] Repeated stratified 5-fold CV (×5–10 repeats) in `train.py`; report mean
      ± std of ROC-AUC per config. Keep the locked 80/20 test split untouched;
      select on CV only.
- [x] Log PR-AUC + Brier score alongside ROC-AUC/F1 in CV results and
      `metadata.json` (ROC-AUC selects; PR-AUC exposes LCX/RCA ranking quality
      under ~38% prevalence).
- [x] Append every run to `artifacts/experiments.csv` (config, CV
      AUC/PR-AUC/Brier, seed). Test AUC computed once, at the end.
- [x] Gain-importance stability: top-10 overlap across model seeds is recorded.
      This is not a patient-specific SHAP stability check and does not by itself
      establish whether a model is overfitting.
- [x] Voting probability contract: `(n_samples, 2)` in `[0, 1]` class order;
      outer-fold F1 uses the threshold tuned within that training fold.
- [x] Voting winner stability: refit and re-tune for each repeat seed; skip
      members without usable importances when forming the ensemble ranking.
- [x] Focused regression checks in `training/tests/` cover the voting artifact
      round trip and LightGBM native/voting predictions, with warnings treated
      as errors in the LightGBM checks.

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

## 4. Evaluated candidates (implemented)

- [x] LightGBM with native categoricals (pass Sex/BBB/VHD/Region RWMA + Y/N
      flags as categorical, skip one-hot on its path).
- [x] CatBoost with native categorical handling. The saved artifact uses
      Plain boosting, verified from resolved parameters; earlier documentation
      incorrectly called this Ordered boosting.
- [x] HistGradientBoosting as sklearn-native baseline.
- [x] Regularized small grids: `num_leaves ∈ {7, 15, 31}`,
      `min_child_samples ∈ {10, 20}`, feature_fraction=0.8 for LightGBM. Shallow + high leaf minimum is the anti-overfit setting for n=242.
- [x] Stacking: OOF predictions of RF + XGB + HistGBM → LogReg meta-learner.
      Stacking won no saved target.
- [x] Soft voting: RF + XGB + HGB + LightGBM + CatBoost + ElasticNet, with
      weights and threshold tuned for F2. Voting won no saved target.
- [x] Fit fresh preprocessing clones inside stacking and voting inner folds
      (2026-10-11), including stability and final refitting. Regression checks
      verify row isolation, imputation/scaling/category fitting, and artifact
      compatibility. Historical ensemble CV scores still need a new training run.
- [x] `LGBMArrayClassifier` supplies fitted feature names for NumPy predictions
      in both native and voting tracks, avoiding repeated sklearn warnings
      while preserving probabilities.
- [x] Pin new deps identically in `training/requirements.txt` and
      `backend/requirements.txt` (unpickling requires version match).

## 5. Feature engineering backlog (each judged by repeated-CV delta, not test)

- [x] Shared training/inference feature sets: `log1p` TG/FBS/ESR; LDL/HDL,
      TG/HDL, Neut/Lymph; five-factor risk count and four-finding ECG count.
      New-run defaults: CAD logs, LAD counts, LCX ratios+counts, RCA baseline.
      Metadata/schema record the choice; explanations recompute derived values
      from raw inputs. These defaults follow exploratory accuracy results, not
      independently validated feature selection. Existing artifacts need retraining.
- [ ] Nested selection among feature sets. The current nested option fixes one
      candidate feature set before the run and retains an original-input comparator.
- [ ] Additional candidates: WBC/PLT logs, wider ECG counts and symptom summaries.
      Measured non-HDL cholesterol requires total cholesterol, absent in this CSV.
- [ ] Winsorize TG/FBS/WBC/PLT/HDL/BUN at 1st/99th percentiles (review, never
      blind-drop — e.g. TG 1050 may be real).
- [ ] Ablations: VHD ordinal vs one-hot; Region RWMA ordinal vs one-hot; drop vs
      keep CHF/LowTH Ang; collapse ultra-rare Y-levels (CRF/CVA/Weak Pulse,
      n<12) into one "rare comorbidity" flag.

## 6. Calibration & reporting (protects the demo; doesn't raise AUC)

- [x] CAD nested experiment: compare raw, Platt and isotonic with additional
      calibration subfolds; choose on inner log loss and evaluate on untouched
      outer folds. Save Brier, log loss, calibration intercept/slope, ECE,
      prevalence baseline, ROC/PR/calibration/F2/confusion plots and patient
      bootstrap intervals. Serving models remain unchanged.
- [ ] Extend the audited calibration protocol to vessel models. Do not assume
      isotonic is appropriate for a small dataset; evaluate it against sigmoid
      and raw probabilities inside training data.
- [ ] Report alternative Youden-J / F1-optimal thresholds per vessel in
      `metrics.json` so LCX/RCA recall (~0.46/~0.39) is contextualized. Evaluation
      and API labels use the saved threshold (tuned for voting, otherwise 0.5).

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

## 8. Remaining execution order

1. Re-evaluate stacking and voting with inner-fold preprocessing; make
   stacking importance handling robust to estimators without
   `feature_importances_` before expanding that track (voting is covered).
2. Classifier-chain and CAD-as-OR experiments, judged by repeated CV.
3. Feature-engineering ablations; retain only supported improvements.
4. Calibration, uncertainty reporting and ROC/PR/calibration plots.
5. Evaluate frozen winners, export dashboard metadata, and refresh docs.

Patient-specific approximate permutation explanations, live frontend defaults,
backend validation and artifact-backed dashboard metrics are implemented.

## MAIN:
1. make the 3d visualization more interactive(for example clicking on the LAD might open up a simple tube clotted by plague buildup)
2. show the blood flow inside the vessels
3. IMPROVE THE GRAPHS
4. Show heart beat in this heart
