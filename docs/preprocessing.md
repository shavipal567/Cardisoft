# Preprocessing

Code: `training/preprocessing.py`. One shared implementation used identically
at train and inference (via `training/inference.py`), so train-serve skew is
structurally impossible. Output: **81 features**.

## Cleaning (`clean_dataframe()`, idempotent)

1. `Sex`: `Fmale` → `Female`.
2. `Region RWMA`: int codes → strings (categorical treatment; mapping
   undocumented in source data).

## Transformer (`build_preprocessor()` → `ColumnTransformer`)

| Branch | Columns | Steps |
|---|---|---|
| `num` (33) | Age, Weight, Length, BMI, DM, HTN, Current Smoker, EX-Smoker, FH, BP, PR, Edema, Typical Chest Pain, Function Class, Q Wave, St Elevation, St Depression, Tinversion, FBS, CR, TG, LDL, HDL, BUN, ESR, HB, K, Na, WBC, Lymph, Neut, PLT, EF-TTE | `SimpleImputer(median)` → `RobustScaler` |
| `cat` (21) | 17 Y/N flags + Sex (2 levels) + BBB (N/LBBB/RBBB) + VHD (N/mild/Moderate/Severe) + Region RWMA (5 codes) | `SimpleImputer(most_frequent)` → `OneHotEncoder(handle_unknown="ignore")` |

0/1 binaries ride along as numerics. `handle_unknown="ignore"` keeps inference
robust to unseen categories.

## Design rationale

- **RobustScaler over StandardScaler**: TG/FBS/WBC/PLT/ESR are heavily
  right-skewed; no `log1p` in v1 (backlogged in IMPROVEMENTS.md).
- **Single shared preprocessor**: tree winners don't need scaling, but one code
  path stays correct if a linear model is tried later.
- **Leakage exclusion**: `split_features_target()` drops `LAD/LCX/RCA/Cath` +
  target + `Exertional CP`, then allow-lists `ALL_INPUT_FEATURES` (stray future
  columns excluded). Fitted on train data only — inside CV folds via `Pipeline`,
  on the 242-row split for refits.
- **Dropped**: `Exertional CP` (zero variance). Kept with regularization:
  `CHF` (n=1), `LowTH Ang` (n=2), rare Y-levels (n<12).

Verify no leakage in a fitted preprocessor:

```bash
python3 -c "
import joblib
names = list(joblib.load('training/artifacts/cad/preprocessor.joblib').get_feature_names_out())
print([n for n in names if any(l in n for l in ['LAD','LCX','RCA','Cath'])] or 'NONE - ok')
"
```
