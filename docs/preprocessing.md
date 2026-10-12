# Preprocessing

`training/preprocessing.py` defines the raw input allow-list, feature formulas and
three preprocessing tracks. Training fits these transforms; inference loads and
applies the saved preprocessor. A change to training defaults never changes an
already fitted model's inputs.

## Raw inputs and cleaning

The source CSV contains 59 columns. Excluding `Cath`, `LAD`, `LCX`, `RCA` and
constant `Exertional CP` leaves **54 permitted raw inputs**:

- 33 numeric fields, including binary flags.
- 17 Y/N categorical fields.
- Four nominal fields: Sex, BBB, VHD and Region RWMA.

`split_features_target()` cleans the data and applies this allow-list. Extra
columns, target labels and patient IDs cannot become model inputs through it.
Patient IDs, when supplied to the nested protocol, are used only for splitting.

`clean_dataframe()` normalises `Fmale` to `Female` and converts Region RWMA codes
to strings. The code's anatomical mapping is undocumented, so it is not treated
as an invented severity scale. No automatic outlier clipping is performed.

## Transformation order

```text
Raw fields → cleaning → numeric branch: feature engineering → median imputation → RobustScaler
                     → categorical branch: mode imputation → one-hot or integer encoding
                     → concatenated model inputs
```

`NumericFeatureEngineer` computes row-wise values inside the numeric branch.
For count sets, that branch also receives raw DLP to form the risk-factor count;
DLP remains in the categorical branch as an original input. Generated columns
are not added to the raw API schema.

Ratios/counts retain their component fields. Log variants replace TG, FBS and ESR
with their log1p values. Missing/nonfinite operands propagate; ratio denominators
must be positive; logs require nonnegative labs; counts require every binary
constituent. Derived values are imputed only after calculation. Engineered numeric
branches preserve completely missing outputs so their positions remain stable.

See [feature engineering](feature-engineering.md) for exact formulas and the
exploratory evidence behind the defaults.

## Feature sets and dimensions

`train.py --feature-set auto` resolves to CAD `logs`, LAD `counts`, LCX
`ratios_counts`, and RCA `baseline`. An explicit set overrides the policy for
all requested targets. Low-level builder functions default to `baseline`.

| Feature set | Numeric outputs | Native outputs | One-hot outputs with full dataset vocabulary |
|---|---:|---:|---:|
| `baseline` | 33 | 54 | 81 |
| `ratios` | 36 | 57 | 84 |
| `counts` | 35 | 56 | 83 |
| `logs` | 33 | 54 | 81 |
| `ratios_counts` | 38 | 59 | 86 |
| `ratios_counts_logs` | 38 | 59 | 86 |

One-hot counts depend on the levels observed during fitting and can be smaller
inside a fold. Read `get_feature_names_out()` or `feature_schema.json` rather than
assuming a fixed width. The current saved models are baseline artifacts: 54
native columns for CAD and 81 one-hot columns for each vessel.

## Three preprocessing tracks

### One-hot track

`build_preprocessor(feature_set="baseline")` serves RF, XGBoost,
HistGradientBoosting and stacking. Numeric outputs receive median imputation
and robust scaling. Categoricals receive mode imputation and
`OneHotEncoder(handle_unknown="ignore", sparse_output=False)`. An unseen category
therefore has an all-zero block at inference.

### Native track

`build_native_preprocessor(feature_set="baseline")` serves LightGBM and CatBoost.
Numeric handling is the same as above. Mode-imputed categorical values become
integer codes through `OrdinalEncoder`; unseen levels map to −1. Missing inputs
normally receive the fitted mode before encoding.

Output order is numeric columns followed by the 21 categorical columns.
`native_cat_indices(feature_set)` computes the categorical positions from
`numeric_feature_names(feature_set)`. For example, counts shift the starting
position from 33 to 35; ratios plus counts shift it to 38.

`CatBoostNative` casts those positions to integer type at fit and prediction.
`LGBMArrayClassifier` preserves fitted LightGBM feature names when receiving
NumPy prediction arrays. Neither adapter changes the clinical input schema.

### Voting track

`build_voting_preprocessor(feature_set="baseline")` applies the one-hot track,
then `StandardScaler(with_mean=False)` for the ElasticNet member. All voting
members receive this shared transformed matrix. Their native standalone tracks
are not used inside the voting ensemble.

## Fold isolation and persistence

Each selection fold fits a fresh preprocessor on its training rows. Stacking
and voting clone and fit preprocessing again inside their inner OOF folds.
The nested CAD protocol also isolates inner, calibration and outer folds.
Final refitting learns statistics only from the development partition.

The fixed formulas use no labels or cohort statistics. Medians, modes, scaling
parameters and category vocabularies are learned only during fitting. The
historical holdout never fits preprocessing. Feature choices informed by earlier
exploration still limit claims of independent validation.

New training exports record the resolved feature set, generated names and output
width. `preprocessor.joblib` contains the transformer itself. Inference applies
that artifact rather than calling a builder with the latest defaults. Old
artifacts continue to use their original preprocessing.

## API defaults and explanations

HTTP requests are completed with `PatientInput` defaults before preprocessing.
An omitted HDL field therefore uses its API default when forming ratios. Direct
inference with missing measurements can instead invoke fitted imputation.
These are distinct behaviours; an empty API request is a defaults-only assessment.

The [input-availability accuracy check](evaluation.md#accuracy-with-available-inputs)
uses those same raw-field defaults on holdout records and then applies the frozen
preprocessor. Derived features are recalculated after substitution.

Engineered-model explanations use a saved raw training background and recompute
derived values whenever their source inputs change. Baseline models retain
transformed-space grouping. [Explanation details](explainability.md).

## Output names and code reference

`get_output_feature_names()` delegates to the fitted preprocessor. Names include
branch prefixes, for example `num__Age`, `num__log1p_TG`,
`num__risk_factor_count` and `cat__Sex_Male`. Voting preserves these names
through its additional scaling step.
The names describe model columns; `ALL_INPUT_FEATURES` describes the 54 raw fields.

See the [training API reference](api-reference/training.md) for signatures,
feature-set resolution and artifact metadata.
