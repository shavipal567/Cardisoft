# Dataset Column Metadata — `dataset/dataset.csv`

Source: Extension of Z-Alizadeh Sani CAD dataset (UCI).
Shape: **303 rows × 59 columns**. Missing values: **0** (all columns complete).
Targets (leakage — never use as inputs): `LAD, LCX, RCA, Cath`.
Usable inputs: 55 columns (59 − 4 leakage). `Exertional CP` is zero-variance → drop.

Target balance:
- `Cath`: CAD 216 (71.3%) / Normal 87 (28.7%) — imbalanced, use stratified split.
- `LAD`: Stenotic 177 (58.4%) / Normal 126
- `LCX`: Normal 184 / Stenotic 119 (39.3%)
- `RCA`: Normal 189 / Stenotic 114 (37.6%)

Importance = domain prior + observed stats (ECG/echo/symptoms highest). It is a modeling prior, not a causal claim.

## Column table

| # | Column | Type | Category | Values / Range (n=303) | Description | Preprocessing | Importance |
|---|--------|------|----------|------------------------|-------------|---------------|------------|
| 1 | Age | int | demographic | 30–86, mean 58.9, med 58, mode 55 | Patient age (years) | median impute, robust scale (or none for trees) | **High** — core CAD risk factor |
| 2 | Weight | int | demographic | 48–120 kg, mean 73.8, med 74 | Body weight | median impute, scale | Medium — use via BMI; collinear with Length/Weight |
| 3 | Length | int | demographic | 140–188 cm, mean 164.7, med 165 | Height | median impute, scale | Low-Medium — mostly via BMI |
| 4 | Sex | nominal | demographic | Male 176 / Fmale 127 (typo for Female) | Sex | normalize `Fmale→Female`, one-hot | **Medium-High** — risk modifier; fix typo first |
| 5 | BMI | float | demographic | 18.1–40.9, mean 27.2, med 26.8 | Body mass index | median impute, scale | Medium — obesity proxy; collinear |
| 6 | DM | 0/1 | history | 0:213 / 1:90 | Diabetes mellitus | binary as-is | **High** — major CAD risk |
| 7 | HTN | 0/1 | history | 1:179 / 0:124 | Hypertension | binary as-is | **High** — major CAD risk |
| 8 | Current Smoker | 0/1 | history | 0:240 / 1:63 | Active smoking | binary as-is | **Medium-High** — CAD risk |
| 9 | EX-Smoker | 0/1 | history | 0:293 / 1:10 | Ex-smoker (rare) | binary as-is; rare-level flag | Medium — weak signal, sparse |
| 10 | FH | 0/1 | history | 0:255 / 1:48 | Family history | binary as-is | Medium — risk modifier |
| 11 | Obesity | Y/N | history | Y 211 / N 92 | Obesity flag (overlaps BMI) | one-hot Y/N | Medium — redundant with BMI; keep one |
| 12 | CRF | Y/N | history | N 297 / Y 6 (rare) | Chronic renal failure | one-hot; rare → group/smooth, careful in CV | Low — too sparse to learn reliably |
| 13 | CVA | Y/N | history | N 298 / Y 5 (rare) | Cerebrovascular accident history | one-hot; rare | Low — sparse |
| 14 | Airway disease | Y/N | history | N 292 / Y 11 | Airway disease | one-hot | Low — comorbidity only |
| 15 | Thyroid Disease | Y/N | history | N 296 / Y 7 | Thyroid disease | one-hot; rare | Low — comorbidity only |
| 16 | CHF | Y/N | history | N 302 / Y 1 | Congestive heart failure history | one-hot; near-constant → consider drop | Low — single positive, unusable |
| 17 | DLP | Y/N | history | N 191 / Y 112 | Dyslipidemia | one-hot | Medium — lipid risk proxy |
| 18 | BP | int | exam | 90–190, mean 129.6, med 130, mode 130 | Blood pressure (mmHg, systolic presumed) | median impute, scale; clip review 190 | **Medium-High** — HTN severity |
| 19 | PR | int | exam | 50–110, mean 75.1, med 70, mode 70 | Pulse rate (bpm) | median impute, scale | Medium — physiological state |
| 20 | Edema | 0/1 | exam | 0:291 / 1:12 | Edema present | binary as-is | Low-Medium — HF sign, sparse |
| 21 | Weak Peripheral Pulse | Y/N | exam | N 298 / Y 5 (rare) | Weak peripheral pulse | one-hot; rare | Low-Medium — vascular sign but sparse |
| 22 | Lung rales | Y/N | exam | N 292 / Y 11 | Lung rales | one-hot | Low-Medium — HF sign, sparse |
| 23 | Systolic Murmur | Y/N | exam | N 262 / Y 41 | Systolic murmur | one-hot | Medium — valve/HD hint |
| 24 | Diastolic Murmur | Y/N | exam | N 294 / Y 9 (rare) | Diastolic murmur | one-hot; rare | Low-Medium — sparse |
| 25 | Typical Chest Pain | 0/1 | symptom | 1:164 / 0:139 | Typical anginal chest pain | binary as-is | **High** — classic CAD symptom |
| 26 | Dyspnea | Y/N | symptom | N 169 / Y 134 | Dyspnea | one-hot | **Medium-High** — ischemia/HF symptom |
| 27 | Function Class | 0-3 | symptom | 0:211 / 2:73 / 3:18 / 1:1 | Functional class (NYHA-like) | ordinal 0-3 as-is; note class 1 n=1 | **Medium-High** — severity grade |
| 28 | Atypical | Y/N | symptom | N 210 / Y 93 | Atypical chest pain | one-hot | **Medium-High** — complements typical pain |
| 29 | Nonanginal | Y/N | symptom | N 287 / Y 16 | Nonanginal pain | one-hot; sparse | Medium — helps separate pain types |
| 30 | Exertional CP | Y/N | symptom | N 303 (constant) | Exertional chest pain — no variance | **drop** (zero variance) | **Drop** — unusable |
| 31 | LowTH Ang | Y/N | symptom | N 301 / Y 2 (rare) | Low threshold angina | one-hot; near-constant → consider drop | Low — only 2 positives |
| 32 | Q Wave | 0/1 | ECG | 0:287 / 1:16 | Pathological Q wave | binary as-is | **Medium-High** — prior infarct marker |
| 33 | St Elevation | 0/1 | ECG | 0:289 / 1:14 | ST elevation | binary as-is | **High** — acute ischemia marker |
| 34 | St Depression | 0/1 | ECG | 0:232 / 1:71 | ST depression | binary as-is | **High** — ischemia marker |
| 35 | Tinversion | 0/1 | ECG | 0:213 / 1:90 | T-wave inversion | binary as-is | **High** — ischemia marker |
| 36 | LVH | Y/N | ECG/echo | N 283 / Y 20 | Left ventricular hypertrophy | one-hot | **Medium-High** — pressure-overload marker |
| 37 | Poor R Progression | Y/N | ECG | N 294 / Y 9 (rare) | Poor R-wave progression | one-hot; rare | Medium — infarct hint, sparse |
| 38 | BBB | nominal | ECG | N 282 / LBBB 13 / RBBB 8 | Bundle branch block | one-hot 3 levels | Medium — conduction disease |
| 39 | FBS | int | lab | 62–400 mg/dL, mean 119.2, med 98, mode 90 | Fasting blood sugar | median impute, log/robust scale; review 400 outlier | **Medium-High** — diabetes severity |
| 40 | CR | float | lab | 0.5–2.2, mean 1.06, med 1.0 | Creatinine (mg/dL) | median impute, scale | Medium — renal function |
| 41 | TG | int | lab | 37–1050, mean 150.3, med 122 | Triglycerides | median impute, log/robust scale; review 1050 | Medium — lipid panel |
| 42 | LDL | int | lab | 18–232, mean 104.6, med 100 | LDL cholesterol | median impute, scale | **Medium-High** — core lipid risk |
| 43 | HDL | float | lab | 15.9–111, mean 40.2, med 39 | HDL cholesterol | median impute, scale; review 111 | **Medium-High** — protective lipid |
| 44 | BUN | int | lab | 6–52, mean 17.5, med 16 | Blood urea nitrogen | median impute, scale | Low-Medium — renal panel |
| 45 | ESR | int | lab | 1–90, mean 19.5, med 15 | ESR inflammation | median impute, robust scale | Low-Medium — nonspecific inflammation |
| 46 | HB | float | lab | 8.9–17.6, mean 13.2, med 13.2 | Hemoglobin | median impute, scale | Low-Medium — anemia proxy |
| 47 | K | float | lab | 3.0–6.6, mean 4.23, med 4.2 | Potassium | median impute, scale | Low-Medium — electrolyte |
| 48 | Na | int | lab | 128–156, mean 141.0, med 141 | Sodium | median impute, scale | Low — electrolyte, narrow range |
| 49 | WBC | int | lab | 3700–18000, mean 7562, med 7100 | White blood cells | median impute, robust scale; review 18000 | Low-Medium — inflammation |
| 50 | Lymph | int | lab | 7–60%, mean 32.4, med 32 | Lymphocyte % | median impute, scale | Low — differential only |
| 51 | Neut | int | lab | 32–89%, mean 60.1, med 60 | Neutrophil % | median impute, scale; collinear with Lymph | Low — differential only |
| 52 | PLT | int | lab | 25–742 (×10³), mean 221.5, med 210 | Platelets | median impute, robust scale; review 25/742 | Low-Medium — thrombotic hint |
| 53 | EF-TTE | int | echo | 15–60%, values {15,20,25,30,35,40,45,46,50,55,60}, med 50, mode 55 | Ejection fraction (echo) | median impute, scale; ordinal-like | **High** — LV function, top echo predictor |
| 54 | Region RWMA | int 0-4 | echo | 0:217 / 2:32 / 1:26 / 4:14 / 3:14 | Region with wall-motion abnormality (code undocumented) | treat as categorical/ordinal; one-hot or ordinal + document mapping gap | **High** — wall-motion abnormality |
| 55 | VHD | nominal | echo | mild 149 / N 116 / Moderate 27 / Severe 11 | Valvular heart disease grade | ordinal N<mild<Moderate<Severe or one-hot | **High** — structural disease |
| 56 | LAD | Stenotic/Normal | TARGET | Stenotic 177 / Normal 126 | LAD stenosis label (≥50% per PROBLEM.md) | **LEAKAGE — exclude from all X** | Target (LAD model) |
| 57 | LCX | Stenotic/Normal | TARGET | Normal 184 / Stenotic 119 | LCX stenosis label | **LEAKAGE — exclude from all X** | Target (LCX model) |
| 58 | RCA | Stenotic/Normal | TARGET | Normal 189 / Stenotic 114 | RCA stenosis label | **LEAKAGE — exclude from all X** | Target (RCA model) |
| 59 | Cath | CAD/Normal | TARGET | CAD 216 / Normal 87 | Overall CAD label | **LEAKAGE — exclude from all X** | Target (CAD model) |

## Leakage rule (mandatory, PROBLEM.md §6)

```python
LEAKAGE_COLUMNS = ["LAD", "LCX", "RCA", "Cath"]
X = df.drop(columns=LEAKAGE_COLUMNS + [target])
y = df[target]
```

Fit preprocessing on train only. Applies to CAD, LAD, LCX, RCA models.

## Preprocessing defaults

- Numerics: median impute + robust scale (TG/FBS/WBC/PLT/ESR skewed → consider log).
- Y/N + binaries: most-frequent impute (for inference safety) + one-hot or 0/1.
- Nominal: `Sex` (fix Fmale), `BBB` (3), `VHD` (4), `Region RWMA` (5 codes — confirm mapping with data dictionary).
- Drop: `Exertional CP`; consider dropping `CHF`, `LowTH Ang` (n≤2) or keep with regularization.
- Rare Y (n<12): `CRF, CVA, Weak Peripheral Pulse, Diastolic Murmur, Poor R Progression, Lung rales, Airway disease` — keep but expect unstable CV folds; use stratified K-fold.
- Outlier review (do not blind-drop): TG 1050, FBS 400, BP 190, PR 110, WBC 18000, PLT 25/742, HDL 111, BUN 52.

## Safety note

Feature contributions (SHAP/LIME) describe model behavior, not clinical causality. 3D vessel highlighting = statistical context for P(LAD)/P(LCX)/P(RCA), not lesion localization.
