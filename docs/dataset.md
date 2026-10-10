# Dataset

File: `dataset/dataset.csv` — extension of the Z-Alizadeh Sani CAD dataset
(UCI). **303 rows × 59 columns, zero missing values.** Companion notes:
`dataset/columns.metadata.md` (per-column stats), `analysis.ipynb` (early,
superseded EDA).

## Column groups (59 total)

- **Targets (4, leakage — never inputs)**: `LAD, LCX, RCA, Cath`.
- **Dropped (1)**: `Exertional CP` — zero variance (all `N`).
- **Inputs (54)**: 33 numeric/binary + 21 categorical (see
  [preprocessing](preprocessing.md)).

| Category | Count | Columns |
|---|---:|---|
| Demographic | 5 | Age, Weight, Length, Sex, BMI |
| History | 12 | DM, HTN, Current Smoker, EX-Smoker, FH, Obesity, CRF, CVA, Airway disease, Thyroid Disease, CHF, DLP |
| Exam | 7 | BP, PR, Edema, Weak Peripheral Pulse, Lung rales, Systolic/Diastolic Murmur |
| Symptoms | 7 | Typical Chest Pain, Dyspnea, Function Class, Atypical, Nonanginal, Exertional CP (dropped), LowTH Ang |
| ECG | 7 | Q Wave, St Elevation, St Depression, Tinversion, LVH, Poor R Progression, BBB |
| Labs | 14 | FBS, CR, TG, LDL, HDL, BUN, ESR, HB, K, Na, WBC, Lymph, Neut, PLT |
| Echo | 3 | EF-TTE, Region RWMA, VHD |

## Target balance

| Target | Positive | Negative | Note |
|---|---|---|---|
| Cath (CAD) | 216 (71.3%) | 87 | imbalanced → stratified split mandatory |
| LAD | 177 (58.4%) | 126 | mild imbalance |
| LCX | 119 (39.3%) | 184 | minority positive |
| RCA | 114 (37.6%) | 189 | minority positive |

The 71.3% CAD prevalence means a naive "always predict CAD" classifier achieves
71.3% accuracy. Stratified splits preserve this ratio in train/test partitions.
`class_weight="balanced"` (or `scale_pos_weight` for XGBoost) counteracts the
imbalance during training.

## Label structure (measured, motivates chains — see IMPROVEMENTS.md)

- P(CAD | vessel stenotic): LAD 0.994, LCX 1.0, RCA 1.0 — CAD is nearly a
  deterministic OR of the three vessel labels
- P(vessel | CAD): LAD 0.815, LCX 0.551, RCA 0.528
- Co-occurrence: LCX→LAD 81%, RCA→LAD 76%, LAD→LCX 54% / RCA 49%

This structure means CAD prediction can benefit from vessel-signal improvements,
and vessel models could theoretically use each other's predictions as features
(classifier chains — backlogged in IMPROVEMENTS.md §3).

## Known quirks (handled in `clean_dataframe()` / documented, not silently fixed)

- `Sex`: typo `Fmale` (127 rows) → normalized to `Female`
- `Region RWMA`: int codes 0–4, mapping undocumented → treated as categorical
- Near-constant: `CHF` (1 positive), `LowTH Ang` (2) — kept with regularization
- Rare Y-levels (n<12): CRF, CVA, Weak Peripheral Pulse, Diastolic Murmur, Poor
  R Progression, Lung rales, Airway disease — unstable under CV, kept faithfully
- Outlier review list (never blind-dropped): TG 1050, FBS 400, BP 190, PR 110,
  WBC 18000, PLT 25/742, HDL 111, BUN 52
- Collinear pairs: Neut/Lymph (differentials), Weight/Length/BMI/Obesity

## Importance ratings

Column metadata (`dataset/columns.metadata.md`) assigns importance based on domain prior + observed stats:

| Importance | Count | Examples |
|---|---|---|
| High | 10 | DM, HTN, Typical Chest Pain, St Depression, Tinversion, EF-TTE, Region RWMA, VHD |
| Medium-High | 9 | Age, DLP, FBS, LDL, HDL, Dyspnea, Atypical, Q Wave, LVH |
| Medium | 10 | Weight, FH, BP, PR, Systolic Murmur, Nonanginal, BBB, CR |
| Low-Medium | 16 | EX-Smoker, Obesity, Edema, Weak Peripheral Pulse, Lung rales, Diastolic Murmur, BUN, ESR, HB, K, WBC, Lymph, Neut, PLT |
| Low / Sparse | 9 | CRF, CVA, Airway disease, Thyroid Disease, CHF, Poor R Progression, LowTH Ang, Na |

Importance is a modeling prior, not a causal claim. High-importance features
are expected to dominate model predictions but are not guaranteed to be the
strongest predictors in every model.

## Data dictionary

Full per-column metadata (types, ranges, means, modes, descriptions) is in
`dataset/columns.metadata.md`. Each column documents:
- Type and value range observed in the dataset
- Clinical description
- Preprocessing applied
- Importance rating
- Known issues (outliers, sparsity, collinearity)
