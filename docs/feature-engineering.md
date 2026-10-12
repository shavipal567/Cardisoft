# Feature engineering

## Implemented feature sets

The API and input allow-list contain the same 54 raw clinical measurements.
`NumericFeatureEngineer`, saved inside each new preprocessor, computes derived
features before fold-fitted median imputation and robust scaling.

| Feature | Formula |
|---|---|
| `LDL_HDL_ratio` | LDL / HDL |
| `TG_HDL_ratio` | TG / HDL |
| `Neut_Lymph_ratio` | Neut / Lymph (both recorded as percentages) |
| `risk_factor_count` | DM + HTN + Current Smoker + FH + 1[DLP = Y] |
| `ecg_finding_count` | Q Wave + St Elevation + St Depression + Tinversion |
| `log1p_TG`, `log1p_FBS`, `log1p_ESR` | Natural logarithm of 1 + lab value |

Counts are unweighted experimental summaries, not validated clinical scores.
Logs replace the three original lab columns. Ratios/counts retain their raw
components. Non-HDL cholesterol is not computed because total cholesterol is
absent. The historical analysis notebook and CSV exports in `dataset/` preserve
the original exploratory experiment; regression checks compare production
calculations to that saved export.

The default `train.py --feature-set auto` uses:

| Target | Feature set | Numeric output columns |
|---|---|---:|
| CAD | `logs` | 33 |
| LAD | `counts` | 35 |
| LCX | `ratios_counts` | 38 |
| RCA | `baseline` | 33 |

Overrides: `baseline`, `ratios`, `counts`, `logs`, `ratios_counts`,
`ratios_counts_logs`. All one-hot, native, stacking and voting paths support the
same choices. Native categorical indices are recomputed from numeric output
width; generated feature names and the chosen feature set are exported in the
schema and metadata. Historical artifacts without a feature-set field remain
baseline models. Saved-model curve regeneration follows recorded metadata.

## Evidence and limitations

Defaults were chosen from the exploratory accuracy comparison on three repeats
of five-fold development CV. CAD logs reached 87.60% versus 86.36% baseline;
LAD counts 78.24% versus 77.41%; LCX ratios/counts 67.91% versus 66.53%. No tested
feature set improved RCA accuracy. These comparisons use threshold 0.5 and the
same records repeatedly; they do not independently validate the chosen defaults.
The original notebook ranks log loss and gives different winners. See the
[complete comparison](evaluation.md#engineered-feature-comparison) for both
metrics and the exact development-only protocol. The checked-in serving
models remain baseline models and do not include these accuracy gains.

The legacy training search still selects models by ROC-AUC/F1. Its reported
winner score is a selection score. The CAD nested protocol accepts an explicit
`--feature-set` for its candidate, retaining original inputs for the comparator;
historical configurations keep baseline features. It nests model/calibration
selection, not selection among feature sets. A future unbiased comparison of
feature-selection procedures needs that choice inside inner folds as well.

## Missing values and explanation consistency

Missing/nonfinite constituents propagate to missing derived values. Ratio
denominators must be positive and numerators nonnegative; log inputs must be
nonnegative. Counts require
every constituent to be observed and binary. Imputation is fitted afterward,
using only the current training fold. All-missing numeric outputs retain their
positions. No cohort thresholds, clipping limits or target statistics are used
in the row-wise formulas.

New artifacts include a raw training background for explanations. For engineered
models, the explainer varies the 54 raw fields and runs the frozen preprocessor
on each resulting row. Ratios, counts and logs are recomputed together with
their source fields; they are not independently varied or arbitrarily assigned
to a single source. Existing baseline artifacts retain their explanation path.

## Rules for adding features

1. **Leakage-safe by construction**: derived only from the 54 inputs. No target
   labels, no vessel labels, no proxies like "number of stenotic vessels."
2. **Single code path**: added in `preprocessing.py` as new transformer branches
   (keeps one code path for train + inference).
3. **CV-judged**: choose the objective before comparing features; the historical
   test split is never the selection criterion. Nest any learned feature selection.
4. **Documented**: each feature gets a docstring explaining its clinical rationale
   and expected effect.

## Feature importance stability

The following saved baseline values describe top-10 feature importance
stability: mean pairwise Jaccard similarity across 10 seed refits on the
development partition. They are recorded in each target's `metadata.json`
and do not measure the new engineered sets:

| Target | Stability | Interpretation |
|---|---|---|
| CAD | 0.85 | High — model consistently relies on same features |
| LAD | 0.83 | High — stable across seeds |
| LCX | 0.66 | Less overlap across seed refits |
| RCA | 0.77 | Intermediate overlap across seed refits |

This is not a patient-specific SHAP stability check and does not by itself
establish whether a model is overfitting. It measures whether the same features
are ranked as important across different seed refits of the winning model.
