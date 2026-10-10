# Preprocessing

`training/preprocessing.py` defines the input allow-list and two preprocessing
tracks shared by training and frozen inference. 59 source columns become 54
inputs after removing LAD/LCX/RCA/Cath and constant Exertional CP.

## Cleaning (`clean_dataframe()`)

Idempotent, applied identically at training and inference:

1. **Sex normalization**: `Fmale` → `Female` (dataset typo affecting 127 rows)
2. **Region RWMA**: integer codes → strings so the encoder treats them as
   categorical (the anatomical mapping of codes 0–4 is undocumented)

No other cleaning is applied. Outliers are reviewed but never blind-dropped.
No derived ratios, log transforms, or outlier capping are shipped.

## Three preprocessing tracks

| Track | Numerical inputs (33) | Categorical inputs (21) | Saved output |
|---|---|---|---|
| One-hot (vessel winners) | Median imputation, RobustScaler | Mode imputation, one-hot, unknown ignored | 81 columns |
| Native (CAD winner) | Median imputation, RobustScaler | Mode imputation, ordinal codes, unknown −1 | 54 columns |
| Voting (voting ensemble) | Median imputation, RobustScaler | Mode imputation, one-hot, unknown ignored | 81 columns + StandardScaler(with_mean=False) |

### One-hot track (RF/XGB/HGB/Stack)

Used by the saved vessel models (LAD, LCX, RCA). Produces 81 transformed columns:

- 33 numerical columns (Age, Weight, binaries, labs, EF-TTE)
- 48 one-hot columns from 21 categorical inputs:
  - 15 Y/N flags → 1 column each (15)
  - Sex → 2 columns (Male, Female)
  - BBB → 3 columns (N, LBBB, RBBB)
  - VHD → 4 columns (N, mild, Moderate, Severe)
  - Region RWMA → 5 columns (0, 1, 2, 3, 4)

`handle_unknown="ignore"` makes inference robust to unseen categories —
unknown values produce an all-zeros one-hot row rather than raising an error.

### Native track (LightGBM/CatBoost)

Used by the saved CAD model. Produces 54 transformed columns:

- 33 numerical columns (same as one-hot track)
- 21 categorical columns encoded as integer codes via `OrdinalEncoder`
  - Unknown/missing values → −1

Output order is `[NUMERIC_FEATURES..., NATIVE_CAT_FEATURES...]`, so
`native_cat_indices()` gives the categorical positions passed as
`categorical_feature` (LGBM) / `cat_features` (CatBoost) at every fit.

`CatBoostNative` (`native_models.py`) int-casts on the way in at both fit
and predict time, because CatBoost rejects float matrices with cat features.
This keeps the saved artifact layout identical (`preprocessor.joblib` +
`model.joblib`), so `inference.py` and the backend work unchanged.

### Voting track (Voting ensemble)

Used by the voting ensemble. Produces 81 transformed columns (same as one-hot track)
followed by `StandardScaler(with_mean=False)` for unit variance across all features.
This conditions the ElasticNet member (L1/L2 regularization is scale-sensitive).

## Design decisions

- **RobustScaler over StandardScaler**: TG/FBS/WBC/PLT/ESR are heavily
  right-skewed. RobustScaler uses median and IQR, making it less sensitive
  to outliers than mean/std scaling.
- **No log-transform**: Recorded as future work (see IMPROVEMENTS.md §5).
  Tree winners don't need it, but it could help linear models.
- **Median imputation**: More robust than mean for skewed distributions.
  Fitted on training data only — the 61 test patients never influence
  imputation values.
- **Mode imputation for categoricals**: Most frequent value is the safest
  default for sparse categorical levels.

## Leakage prevention

Preprocessors are fitted:
1. Manually inside each outer CV fold (during model selection)
2. On the full 242-row training split (for the final saved artifact)

The 61-row test split is never used in fitting. `LEAKAGE_COLUMNS` (LAD, LCX,
RCA, Cath) are excluded by `split_features_target()` for every target.
An allow-list (`ALL_INPUT_FEATURES`) ensures stray columns in a future CSV
are excluded automatically.

## API defaults vs. fitted imputation

The HTTP API has explicit defaults for omitted measurements (defined in
`backend/schemas.py`) and validates finite numbers, bounds, and categories
before preprocessing. An API request containing `{}` differs from a direct
inference call with missing values: schema defaults and fitted imputation
are distinct. The frontend collects 19 of 54 fields and identifies
uncollected explanation features as "defaulted."

## Output feature names

`get_output_feature_names()` returns the transformed column names:
- One-hot: `Age`, `Weight`, ..., `Sex_Male`, `Sex_Female`, `BBB_N`, ...
- Native: `Age`, `Weight`, ..., `Sex`, `BBB`, `VHD`, `Region RWMA`, ...

These names are used in explanations to map transformed columns back to
original clinical inputs.
