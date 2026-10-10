# Feature engineering

## Current implementation: minimal, faithful

The current pipeline engineers no derived features. It uses 54 clinical inputs,
transformed into 54 native columns for CAD or 81 one-hot columns for vessels.
The cleaning changes are the Fmale spelling correction and categorical treatment
of Region RWMA. Current test AUC is CAD .893, LAD .843, LCX .711, RCA .748;
feature experiments must be judged on repeated CV, not these test scores.

## Backlog (from `training/IMPROVEMENTS.md`, each judged by repeated-CV delta)

**Transforms**

- `log1p` on skewed labs: TG, FBS, WBC, PLT, ESR.
- Winsorize TG/FBS/WBC/PLT/HDL/BUN at 1st/99th percentiles (review, not drop).

**Domain-motivated composites** (things a tree must otherwise rediscover
through many splits — valuable at n=242):

- Lipid ratios: LDL/HDL, TG/HDL, non-HDL (total proxy).
- Burden counts: comorbidity (DM+HTN+smoking+FH+DLP), ECG abnormality
  (Q+ST-elevation+ST-depression+Tinversion+LVH+BBB), symptoms
  (Typical+Atypical+Dyspnea+Function Class).
- Rare-level collapse: CRF/CVA/Weak Peripheral Pulse (n<12) → single "rare
  comorbidity" flag (tests whether sparse one-hots are noise).

**Encoding ablations** (run, don't assume):

- VHD ordinal (N<mild<Moderate<Severe) vs one-hot.
- Region RWMA ordinal 0–4 vs one-hot.
- Drop vs keep CHF / LowTH Ang.

## Rules for adding features

1. Leakage-safe by construction (derived only from the 54 inputs).
2. Added in `preprocessing.py` as new transformer branches (keeps one code path
   for train + inference).
3. Accepted only on repeated-CV ROC-AUC improvement vs baseline; test AUC is
   never the selection criterion.
