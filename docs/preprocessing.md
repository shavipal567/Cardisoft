# Preprocessing

`training/preprocessing.py` defines the input allow-list and two preprocessing
tracks shared by training and frozen inference. 59 source columns become 54
inputs after removing LAD/LCX/RCA/Cath and constant Exertional CP.

Cleaning normalizes Fmale to Female and treats Region RWMA as a categorical
code because the anatomical mapping is undocumented.

| Track | Numerical inputs (33) | Categorical inputs (21) | Saved output |
|---|---|---|---|
| One-hot, used by vessel winners | Median imputation, RobustScaler | Mode imputation, one-hot, unknown ignored | 81 columns |
| Native, used by CAD winner | Median imputation, RobustScaler | Mode imputation, ordinal codes, unknown -1 | 54 columns |

Preprocessors are fitted manually inside each outer CV fold, then refitted
on the 242 training patients for the winning artifact. The 61 test patients
are not used in fitting. Categorical columns move together in explanations.

The HTTP API has explicit defaults for omitted measurements and validates
finite numbers, bounds and categories before preprocessing. Therefore an API
request containing `{}` differs from a direct inference call with missing
values: schema defaults and fitted imputation are distinct. The frontend
collects 19 of 54 fields and identifies uncollected explanation features as typical.

No derived ratios, log transforms or outlier capping are shipped. Rare features
are retained; extreme dataset values were not blindly removed. LDL's frontend
and backend input range includes the observed value of 18 mg/dL.
