# Problem formulation

## Challenge and motivation

Cardisoft was developed for the **Multimodal AI Hackathon 2026, Track A:
Cardiovascular Risk Visualization & Prediction**. The challenge is to turn
structured patient measurements into predictions for overall coronary artery
disease (CAD) and stenosis in three named coronary vessels, then make those
outputs easier to inspect through patient-specific explanations and an
interactive anatomical view.

A set of isolated labels or percentages is difficult to interpret in context.
The system therefore connects four parts of the problem: leakage-resistant
prediction, explanations of model behavior, a vessel-specific visual mapping,
and a usable web application. Its visual layer adds anatomical context; it does
not locate a patient's plaque or reconstruct that patient's coronary anatomy.

## Objective

For the clinical fields available for a patient, estimate four binary outcomes:

1. Whether the dataset labels the patient as having overall CAD.
2. Whether the dataset labels stenosis in the left anterior descending artery
   (LAD).
3. Whether it labels stenosis in the left circumflex artery (LCX).
4. Whether it labels stenosis in the right coronary artery (RCA).

For every target, return a binary classification and a model probability. Show
which inputs contributed to an explanation, and associate each vessel estimate
with its corresponding structure in the schematic heart. Keep the output
inspectable and clearly separate statistical estimates from clinical diagnosis
or medical advice.

## Dataset and target definitions

The source cohort contains **303 records and 59 columns**: 54 allowed clinical
inputs, four target labels, and one constant field that is dropped. The inputs
cover demographics, history, examination, symptoms, ECG findings, laboratory
measurements, and echocardiography. See the [dataset guide](dataset.md) for
column groups, cohort exploration, label balance, and data quirks.

| Model head | Dataset label | Positive class | Positive records |
|---|---|---|---:|
| Overall CAD | `Cath` | CAD; the dataset definition corresponds to at least 50% narrowing in one or more major vessels | 216 (71.3%) |
| LAD | `LAD` | Stenotic | 177 (58.4%) |
| LCX | `LCX` | Stenotic | 119 (39.3%) |
| RCA | `RCA` | Stenotic | 114 (37.6%) |

These labels and prevalences describe this cohort. They are not population
prevalence estimates. The CAD label is strongly related to the three vessel
labels, so leakage controls and evaluation design are essential.

## Inputs and user workflow

The prediction contract consists of the 54 allowed structured clinical fields.
The web app lets users enter them in the form, speak or type a description, or
import measurements from a selectable-text PDF or report image. Speech
recognition, PDF extraction, and image OCR help convert those sources into
candidate form values. Users review and apply the extracted values; the backend
receives structured measurements only when an assessment is submitted. See the
[multimodal input guide](multimodal-fusion.md) for processing and data-flow
details.

The clinical inputs describe information such as age, history, blood pressure,
pulse, symptoms, ECG findings, laboratory values, and echocardiography
measurements. The exact allow-list and field validation rules are documented in
the [API reference](api.md#post-predict).

## Prediction and preprocessing requirements

The training and serving pipeline must use the same documented input contract
and fitted preprocessing. For each prediction head, the labels `LAD`, `LCX`,
`RCA`, and `Cath` are excluded from the model inputs. The current row-wise
features are derived only from the allowed clinical fields; learned imputation,
scaling, encoding, and other transformations are fitted within training folds.
This prevents a model from receiving the answer directly or benefiting from
statistics calculated using held-out records. See
[preprocessing](preprocessing.md) and [engineering decisions](engineering-decisions.md).

```text
Form, speech, typed description, PDF, or report image
                         │
             reviewed structured field values
                         │
       validation → row-wise feature engineering
                         │
        fold-fitted preprocessing → four model heads
                         │
      CAD + LAD + LCX + RCA estimates and explanations
                         │
           dashboard and vessel-level 3D context
```

Each head retains a separate target and output. The classification threshold is
read from the saved model metadata; the currently checked-in serving models use
0.5. A probability is the model's output score. It must not be presented as a
clinically validated individual risk percentage unless calibration and
appropriate clinical validation support that interpretation.

## Validation and evidence

The cohort is small and the targets are imbalanced, so training performance
alone is inadequate. The project uses target-specific stratified development
and held-out partitions, with transformations fitted on training data. Model
selection and feature experiments use development records; held-out records
are reserved for evaluation. Report accuracy, precision, recall, F1, ROC-AUC,
and confusion matrices separately for CAD, LAD, LCX, and RCA.

The [evaluation page](evaluation.md) documents the split, exact held-out metrics,
the engineered-feature experiment, and its limitations. Cohort evaluation
describes performance across historical records. It does not establish whether
one patient's prediction is correct. Input-dependent cohort accuracy,
completeness, and the patient's model probability are distinct quantities.

## Explanation and vessel visualization

The dashboard should answer two related questions: what estimate did each head
produce, and how did the model respond to the submitted inputs? Cardisoft shows
CAD and vessel estimates with patient-specific grouped permutation Shapley
contributions. Contributions describe model behavior; they do not establish
biological cause, treatment effect, or clinical importance. Read the
[explainability guide](explainability.md) for the method and its limitations.

The interactive 3D view maps LAD, LCX, and RCA estimates to their named vessel
structures. Vessel color and displayed probability communicate the model
estimate, not measured narrowing. The source cohort has no lesion coordinates,
plaque geometry, CT angiography, or patient-specific anatomical segmentation.
Therefore, the application must not claim that it found an exact lesion
location, size, or morphology. The heart is a schematic orientation aid. See
[visualization](visualization.md) for the asset, mapping, and interaction
contract.

## Safety and intended use

Cardisoft is a research and demonstration prototype. It is not an independent
diagnostic system, does not replace a cardiologist or clinical assessment, and
does not recommend treatment. The interface must keep a clear safety notice
visible. Explanations are not causal claims, and highlighting a vessel means
only that the corresponding model estimated a vessel-level probability.

## Scope and status

Implemented components include the leakage-controlled training and inference
pipeline, four prediction heads, FastAPI service, React dashboard, report import
and speech-assisted field entry, patient-specific explanations, cohort
evaluation panels, and schematic interactive 3D heart. New training supports
target-specific engineered feature sets; checked-in serving artifacts remain
baseline models. Calibration and nested CAD evaluation are available as
isolated experiments. Vessel calibration, modeling dependence among vessel
targets, and external validation remain future work. Details and evidence are
linked throughout this documentation.

## Challenge success criteria

The hackathon evaluates the complete system across five areas:

| Category | Weight | Evidence expected |
|---|---:|---|
| Predictive performance | 30% | Appropriate validation, leakage controls, and per-target classification metrics |
| 3D visualization | 25% | Clear anatomy, correct vessel mapping, interaction, and responsive updates |
| Clinical interpretability | 20% | Patient-specific model explanations and clear communication of estimates |
| System integration | 15% | Working data, model, API, frontend, and visualization flow |
| Technical implementation | 10% | Reproducibility, maintainability, documentation, and asset attribution |

The intended result is an understandable, inspectable, anatomically contextual
view of model estimates, with a firm boundary between machine-learning output
and clinical diagnosis.
