# Multimodal AI Hackathon 2026 — Track A
# Cardiovascular Risk Visualization & Prediction

## 1. Problem Statement

Cardiovascular disease is one of the leading causes of morbidity and mortality worldwide. Modern clinical datasets contain demographic, physiological, laboratory, electrocardiographic (ECG), and echocardiographic measurements that can be used to estimate the likelihood of coronary artery disease (CAD).

However, conventional machine-learning systems often present their outputs as isolated numerical probabilities or binary classifications. A probability such as `0.73` for CAD may be statistically meaningful, but it does not provide an intuitive representation of **which coronary vessel is associated with elevated predicted risk**, nor does it clearly communicate which patient characteristics contributed to the prediction.

The objective of this challenge is to build an **interactive, explainable cardiovascular risk visualization and prediction system** that combines:

1. Leakage-resistant clinical machine learning.
2. Vessel-specific stenosis prediction.
3. Explainable AI.
4. Interactive 3D anatomical visualization.
5. A clinician-friendly dashboard.
6. A web-based software architecture capable of integrating the complete pipeline.

The system should transform structured patient-level clinical data into interpretable predictions for overall CAD and the three principal coronary vessels — **LAD, LCX, and RCA** — and visually associate those predictions with their corresponding anatomical structures.

> **Important:** The dataset supports statistical prediction of disease/stenosis status. It does **not** provide pixel-level or 3D lesion localization. Therefore, the visualization must not imply that the model has identified the exact physical location, size, or morphology of a plaque or stenosis.

---

# 2. Medical Domain Primer

## 2.1 Coronary Artery Disease

**Coronary Artery Disease (CAD)** occurs when the coronary arteries become narrowed or obstructed, commonly due to atherosclerotic plaque.

In the provided dataset, CAD is associated with **at least 50% narrowing of one or more major coronary vessels**, according to the dataset's labeling definition.

The ML system should therefore learn the relationship between available clinical/physiological measurements and the dataset's CAD label.

---

## 2.2 Coronary Arteries

The primary vessel-level prediction targets are:

### LAD — Left Anterior Descending

The LAD supplies a substantial portion of the anterior heart and interventricular septum.

### LCX — Left Circumflex

The LCX supplies regions of the lateral and, depending on coronary anatomy, posterior heart.

### RCA — Right Coronary Artery

The RCA supplies the right side and inferior regions of the heart and can supply other regions depending on coronary dominance.

For this challenge, these names represent **prediction targets and anatomical visualization targets**.

The model is expected to predict:

```text
P(LAD stenosis)
P(LCX stenosis)
P(RCA stenosis)
```

alongside:

```text
P(CAD)
```

---

# 3. Challenge Objective

Build a web-based AI system that accepts a patient's available physiological and clinical measurements and produces:

- Overall CAD prediction.
- CAD probability.
- LAD stenosis probability.
- LCX stenosis probability.
- RCA stenosis probability.
- Interpretable feature contributions.
- Interactive 3D visualization of the relevant coronary vessels.
- Vessel-specific risk inspection.
- Physiological measurement summaries.
- A clear clinical-safety disclaimer.

The complete system should connect the following pipeline:

```text
Clinical Dataset
       │
       ▼
Data Preprocessing
       │
       ▼
Leakage Prevention
       │
       ▼
Feature Engineering / Selection
       │
       ▼
Classification Models
       │
       ├───────────────┐
       ▼               ▼
    CAD Model      Vessel Models
                       │
                ┌──────┼──────┐
                ▼      ▼      ▼
               LAD    LCX    RCA
                │      │      │
                └──────┼──────┘
                       ▼
                Probability Outputs
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
        Explainability       3D Mapping
             │                   │
             └─────────┬─────────┘
                       ▼
                Clinical Dashboard
```

---

# 4. Required Machine-Learning Tasks

## 4.1 Overall CAD Classification

Train a classification model to predict the overall CAD status.

The model should produce at minimum:

```text
CAD prediction: 0 / 1
CAD probability: 0.00–1.00
```

For example:

```json
{
  "prediction": 1,
  "probability": 0.73
}
```

The exact probability interpretation must be consistent with the trained model and preprocessing pipeline.

---

## 4.2 Vessel-Specific Stenosis Classification

Train classification models to predict stenosis status for:

- LAD
- LCX
- RCA

Each model should produce a binary prediction and preferably a calibrated probability.

Example:

```json
{
  "LAD": {
    "prediction": 1,
    "probability": 0.81
  },
  "LCX": {
    "prediction": 0,
    "probability": 0.34
  },
  "RCA": {
    "prediction": 1,
    "probability": 0.56
  }
}
```

A multi-output model may also be considered if technically justified. However, the system must preserve the distinction between the three vessel-specific targets.

---

# 5. Input Features

The models may use available:

- Demographic features.
- Clinical examination features.
- Laboratory measurements.
- ECG measurements.
- Echocardiographic measurements.
- Other legitimate physiological/clinical variables included in the provided dataset.

Examples include:

- Age.
- Blood pressure.
- Pulse rate.
- Cholesterol.
- Cardiac enzymes.
- ST elevation.
- T inversion.
- Left ventricular hypertrophy (LVH).
- Region with regional wall motion abnormality (RWMA).
- Other dataset-provided clinical variables.

The exact feature set should be determined through dataset inspection, preprocessing, validation, and feature-selection experiments.

---

# 6. Critical Requirement: Prevent Target Leakage

The columns:

```text
LAD
LCX
RCA
Cath
```

must be excluded from model input features when predicting:

- Overall CAD.
- LAD stenosis.
- LCX stenosis.
- RCA stenosis.

This is a **mandatory requirement**.

## 6.1 Why Leakage Must Be Prevented

If the target vessel label is directly supplied to the model as an input, the model can learn the answer instead of learning the relationship between legitimate clinical measurements and disease status.

For example, when predicting LAD:

```text
VALID INPUTS
├── Age
├── Blood pressure
├── Cholesterol
├── ECG
├── Cardiac enzymes
├── ST elevation
├── T inversion
├── LVH
├── RWMA
└── Other legitimate clinical features

INVALID INPUTS
├── LAD
├── LCX
├── RCA
└── Cath
```

The same exclusion must be applied consistently across all prediction tasks.

---

## 6.2 Leakage-Safe Feature Construction

A robust implementation should define the exclusion explicitly:

```python
LEAKAGE_COLUMNS = [
    "LAD",
    "LCX",
    "RCA",
    "Cath"
]
```

When training a target model:

```python
X = dataframe.drop(
    columns=LEAKAGE_COLUMNS + [target_column]
)

y = dataframe[target_column]
```

The preprocessing pipeline must be fitted only on the training data.

---

# 7. Data Preprocessing Requirements

The preprocessing pipeline should be reproducible and applied identically during training and inference.

Possible preprocessing steps include:

## 7.1 Missing Values

Identify missing values and choose an appropriate strategy, such as:

- Median imputation for numerical variables.
- Mode/most-frequent imputation for categorical variables.
- Explicit missing-category handling where appropriate.

The selected strategy should be documented.

---

## 7.2 Categorical Variables

Categorical features may require:

- One-hot encoding.
- Ordinal encoding where justified.
- Native categorical handling if supported by the chosen model.

---

## 7.3 Numerical Features

Depending on the model:

- Standardization.
- Robust scaling.
- Min-max normalization.
- No scaling for tree-based models where unnecessary.

The chosen approach should be justified.

---

## 7.4 Outlier Handling

Investigate clinically implausible or extreme values.

Outlier treatment must not blindly remove medically meaningful observations.

Any filtering or transformation should be documented.

---

# 8. Model Development

Teams may compare multiple classification algorithms.

Potential models include:

- Logistic Regression.
- Random Forest.
- Gradient Boosting.
- XGBoost.
- LightGBM.
- CatBoost.
- Support Vector Machines.
- Other appropriate classification methods.

The final model should be selected using an appropriate validation methodology rather than simply maximizing training accuracy.

---

# 9. Validation Methodology

The evaluation methodology should prevent data leakage between training and evaluation sets.

Recommended approaches include:

- Stratified train/validation/test split.
- Stratified K-fold cross-validation.
- Repeated cross-validation where computationally practical.

The evaluation process should document:

```text
Dataset split
      │
      ├── Training data
      │       │
      │       └── preprocessing + model fitting
      │
      ├── Validation data
      │       │
      │       └── model selection / tuning
      │
      └── Test data
              │
              └── final evaluation
```

Preprocessing transformations must not be fitted using the held-out test set.

---

# 10. Required Evaluation Metrics

The challenge explicitly requires:

- Accuracy.
- Precision.
- Recall.
- F1-score.
- ROC-AUC.

These metrics should be reported separately for:

```text
CAD
LAD
LCX
RCA
```

A recommended evaluation table is:

| Target | Accuracy | Precision | Recall | F1 | ROC-AUC |
|---|---:|---:|---:|---:|---:|
| CAD | — | — | — | — | — |
| LAD | — | — | — | — | — |
| LCX | — | — | — | — | — |
| RCA | — | — | — | — | — |

The final project should also consider class imbalance and report additional information such as:

- Confusion matrices.
- Class distributions.
- ROC curves.
- Precision-recall curves where appropriate.
- Probability calibration where applicable.

---

# 11. Risk Estimation

The system should distinguish between:

### Classification

```text
CAD = positive / negative
```

and:

### Probability

```text
P(CAD) = 0.73
```

The same distinction applies to vessel-specific outputs.

Probabilities should not automatically be described as medically validated risk percentages unless the model has been appropriately calibrated and validated for that interpretation.

A visualization-oriented aggregate may be used if clearly labeled as a model-derived indicator, but teams should not invent a clinically validated "overall cardiac risk" measure without appropriate methodological support.

---

# 12. 3D Visualization Requirement

The application must contain an interactive 3D representation of the relevant cardiovascular anatomy.

Possible technologies include:

- Three.js.
- WebGL.
- React Three Fiber.
- VTK.js.
- Other browser-compatible 3D frameworks.

The user should be able to:

- Rotate the model.
- Zoom.
- Pan where appropriate.
- Select coronary vessels.
- Inspect vessel-specific predictions.
- Observe prediction-dependent visual changes.

---

# 13. Anatomical Representation

The visualization should contain, at minimum:

```text
Heart
 │
 ├── LAD
 ├── LCX
 └── RCA
```

Additional anatomical structures may be included if useful.

Open-source anatomical assets such as:

- `.obj`
- `.gltf`
- `.glb`

may be used, subject to their respective licenses.

All external anatomical assets should be properly attributed and their licenses documented.

---

# 14. Prediction-to-Anatomy Mapping

The mapping between model outputs and anatomical structures must be deterministic and consistent.

Example:

```text
Model output               3D structure

P(LAD)   ─────────────────► LAD mesh
P(LCX)   ─────────────────► LCX mesh
P(RCA)   ─────────────────► RCA mesh
```

A vessel's visual state should update whenever a new prediction is generated.

For example:

```text
LAD probability = 0.81
        │
        ▼
LAD anatomical mesh
        │
        ▼
High-risk visual state
```

---

# 15. Important Anatomical Visualization Constraint

The dataset does not provide:

- Exact lesion coordinates.
- Plaque geometry.
- Stenosis location along a vessel.
- Pixel-level lesion segmentation.
- 3D lesion segmentation.
- CT angiography geometry.

Therefore, the system **must not claim to reconstruct or localize an actual stenosis in 3D space**.

The appropriate interpretation is:

> The model predicts the probability of stenosis for a named vessel, and the visualization highlights that vessel to provide an intuitive anatomical context for the statistical prediction.

For example, a highlighted LAD means:

```text
The model predicts elevated LAD stenosis probability.
```

It must **not** imply:

```text
The model found a plaque at this exact point on the LAD.
```

---

# 16. Suggested Visual Encoding

Vessel color/intensity can represent predicted probability.

Conceptually:

```text
Probability

0.00 ───────────────────────────── 1.00
 LOW                              HIGH
```

A continuous color scale may be used, provided that:

- The legend is visible.
- The mapping is consistent.
- Color is not the only indicator of risk.
- The exact numerical probability is displayed.

For accessibility, combine color with labels or numerical values.

---

# 17. Vessel Interaction

Selecting a vessel should open or update a vessel-specific information panel.

Example:

```text
Selected Vessel: LAD

Predicted stenosis probability
81%

Classification
Positive

Model explanation
----------------------------
Age                +0.14
RWMA               +0.18
ST Elevation       +0.11
Cholesterol        +0.08
...
```

Selecting LCX or RCA should dynamically update the same panel.

---

# 18. Clinical Dashboard

The dashboard should combine patient data, predictions, explanations, and 3D anatomy.

A recommended layout:

```text
┌──────────────────────────────────────────────────────────┐
│                  CARDIOVASCULAR AI                       │
├───────────────────┬───────────────────────┬──────────────┤
│ Patient Features  │      3D Anatomy       │ Risk Summary │
│                   │                       │              │
│ Age               │        HEART          │ CAD  73%     │
│ BP                │                       │              │
│ Pulse             │   LAD   LCX   RCA     │ LAD  81%     │
│ Cholesterol       │                       │ LCX  34%     │
│ ECG               │                       │ RCA  56%     │
│ RWMA              │                       │              │
├───────────────────┴───────────────────────┴──────────────┤
│                   MODEL EXPLANATION                       │
│                                                           │
│ Feature             Contribution                          │
│ Age                 █████████████                         │
│ RWMA                ███████████                           │
│ ST Elevation        ███████                               │
│ Cholesterol         █████                                 │
├───────────────────────────────────────────────────────────┤
│ CLINICAL SAFETY DISCLAIMER                                │
└───────────────────────────────────────────────────────────┘
```

---

# 19. Explainable AI Requirement

The system must provide an interpretable explanation of model predictions.

Preferred approaches include:

- SHAP.
- LIME.
- Model-specific feature importance.
- Other defensible explainability methods.

SHAP is particularly suitable because it can provide both:

- Global feature importance.
- Patient-specific local explanations.

---

# 20. Patient-Specific Explanation

For a selected patient, the system should communicate:

> Which features pushed the prediction higher or lower?

Example:

```text
Prediction: CAD probability = 73%

Factors increasing the model output:
+ Age
+ RWMA
+ ST elevation
+ Cholesterol

Factors decreasing the model output:
- Feature X
- Feature Y
```

The explanation must be presented as a **model explanation**, not as a medical causal conclusion.

For example:

### Appropriate

> "RWMA had a positive contribution to this model prediction."

### Inappropriate

> "RWMA caused the patient's CAD."

The model's feature attribution describes the behavior of the predictive model; it does not establish clinical causality.

---

# 21. Physiological Breakdown

The dashboard should allow the user to inspect relevant measurements alongside their model contributions.

Example:

| Measurement | Patient value | Model contribution |
|---|---:|---:|
| Age | 56 | Positive |
| Systolic BP | 145 | Positive |
| Cholesterol | 220 | Positive |
| Pulse | 84 | Small positive |
| ST Elevation | Present | Positive |
| T Inversion | Absent | Neutral/negative |
| RWMA | Present | Positive |

The exact contribution values should come from the selected explanation method.

---

# 22. System Architecture

A recommended architecture is:

```text
                    ┌───────────────────┐
                    │    Web Browser    │
                    │                   │
                    │ React Application │
                    │       +           │
                    │ Three.js / R3F    │
                    └─────────┬─────────┘
                              │ REST/JSON
                              ▼
                    ┌───────────────────┐
                    │      FastAPI      │
                    │      Backend      │
                    ├───────────────────┤
                    │ Input validation  │
                    │ Preprocessing     │
                    │ Model inference   │
                    │ SHAP explanation  │
                    └─────────┬─────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
             ┌─────────────┐     ┌─────────────┐
             │ ML Models   │     │ Preprocessor│
             │ CAD         │     │ Encoder     │
             │ LAD         │     │ Imputer     │
             │ LCX         │     │ Scaler      │
             │ RCA         │     └─────────────┘
             └─────────────┘
```

---

# 23. API Requirements

A minimal backend can expose:

## `POST /predict`

Accept patient features and return:

- CAD prediction.
- CAD probability.
- LAD prediction/probability.
- LCX prediction/probability.
- RCA prediction/probability.
- Optional explanation data.

Example response:

```json
{
  "cad": {
    "prediction": 1,
    "probability": 0.73
  },
  "vessels": {
    "LAD": {
      "prediction": 1,
      "probability": 0.81
    },
    "LCX": {
      "prediction": 0,
      "probability": 0.34
    },
    "RCA": {
      "prediction": 1,
      "probability": 0.56
    }
  }
}
```

---

## `POST /explain`

Optionally return patient-specific feature attribution.

Example:

```json
{
  "target": "CAD",
  "base_value": 0.42,
  "features": [
    {
      "name": "Age",
      "value": 56,
      "contribution": 0.14
    },
    {
      "name": "RWMA",
      "value": 2,
      "contribution": 0.09
    }
  ]
}
```

The actual schema may differ depending on the selected explainability implementation.

---

## `GET /health`

Return backend availability:

```json
{
  "status": "ok"
}
```

---

# 24. Performance Requirements

The application should remain responsive in modern web browsers without requiring a dedicated GPU.

The 3D viewer should therefore:

- Use reasonably sized assets.
- Avoid unnecessarily high polygon counts.
- Avoid expensive per-frame computation.
- Load assets asynchronously where appropriate.
- Update vessel materials rather than rebuilding the complete scene.
- Maintain smooth camera interaction.

Model inference should be sufficiently fast for interactive prediction after patient input.

---

# 25. Extensibility

The architecture should allow future addition of:

- Additional clinical features.
- Additional prediction targets.
- Additional coronary vessels.
- Additional anatomical structures.
- Alternative ML models.
- Additional explainability methods.
- New patient cohorts.
- Additional visualization layers.

A modular architecture is therefore preferred.

For example:

```text
models/
├── cad_model
├── lad_model
├── lcx_model
├── rca_model
└── future_model

anatomy/
├── heart
├── lad
├── lcx
├── rca
└── future_structure
```

---

# 26. Clinical Safety and Disclaimer

The interface must contain a clear and visible disclaimer.

A suitable example is:

> **Clinical Safety Notice:** This system is a machine-learning research and decision-support prototype intended for educational and demonstration purposes. Its predictions are not a medical diagnosis and must not be used as a substitute for qualified clinical assessment, diagnostic imaging, laboratory interpretation, or professional medical advice.

The disclaimer should be visible within the main application rather than hidden exclusively in documentation.

---

# 27. What the System Must Not Claim

The system must not claim that it:

- Diagnoses CAD independently.
- Replaces a cardiologist.
- Replaces coronary angiography or diagnostic imaging.
- Detects the exact location of a plaque.
- Measures exact stenosis severity unless the dataset explicitly supports that task.
- Reconstructs a patient's actual coronary anatomy from the available tabular data.
- Establishes causal relationships from SHAP/LIME explanations.
- Provides clinically validated individual risk unless the model has been appropriately developed and validated for that purpose.

The 3D anatomy is an **interpretive visualization layer**, not a patient-specific anatomical reconstruction.

---

# 28. Expected Deliverables

## 28.1 Working Software Prototype

A web-based application containing:

- Patient input interface.
- ML prediction pipeline.
- CAD prediction.
- LAD prediction.
- LCX prediction.
- RCA prediction.
- Interactive 3D anatomy.
- Vessel-specific visualization.
- Explainability dashboard.
- Clinical safety disclaimer.

---

## 28.2 Trained Prediction Pipeline

Provide:

- Data preprocessing code.
- Feature selection/engineering code.
- Training code.
- Validation code.
- Evaluation code.
- Saved model weights/artifacts.
- Inference code.
- Dependency specifications.

The pipeline should be reproducible.

---

## 28.3 Clinical Explanation Dashboard

The dashboard should include:

- CAD probability.
- Vessel-specific probabilities.
- Patient physiological values.
- Feature contributions.
- SHAP/LIME or equivalent explanation.
- Vessel-specific explanation where feasible.
- Prediction interpretation.

---

## 28.4 Project Documentation

Documentation should be no longer than **6 pages** for the required project submission.

It should cover:

1. Problem definition.
2. Dataset description.
3. Preprocessing.
4. Leakage prevention.
5. Feature engineering.
6. Model architecture.
7. Validation methodology.
8. Evaluation results.
9. Explainability.
10. 3D visualization pipeline.
11. System architecture.
12. Limitations and clinical safety.
13. Reproducibility instructions.

---

## 28.5 Demonstration Video

Required duration:

**3–10 minutes**

The video should demonstrate:

1. Application startup.
2. Patient feature entry.
3. Model inference.
4. CAD prediction.
5. LAD/LCX/RCA probabilities.
6. 3D interaction.
7. Vessel selection.
8. Explainability.
9. Physiological contribution breakdown.
10. Technical architecture.
11. Safety disclaimer.

---

# 29. Recommended Demonstration Flow

A strong demonstration sequence is:

```text
START
  │
  ▼
Open application
  │
  ▼
Enter patient measurements
  │
  ▼
Click "Analyze"
  │
  ▼
Backend preprocessing
  │
  ▼
Run CAD + vessel models
  │
  ▼
Display probabilities
  │
  ▼
Update 3D vessels
  │
  ▼
Rotate / zoom heart
  │
  ▼
Select LAD
  │
  ▼
Display LAD probability + explanation
  │
  ▼
Select LCX
  │
  ▼
Display LCX probability + explanation
  │
  ▼
Select RCA
  │
  ▼
Display RCA probability + explanation
  │
  ▼
Show SHAP explanation
  │
  ▼
Show validation metrics
  │
  ▼
Show safety disclaimer
```

---

# 30. Suggested Repository Structure

```text
cardiovascular-ai/
│
├── README.md
├── PROBLEM.md
├── LICENSE
├── requirements.txt
├── package.json
├── docker-compose.yml
│
├── data/
│   ├── raw/
│   └── processed/
│
├── ml/
│   ├── preprocessing.py
│   ├── feature_selection.py
│   ├── train.py
│   ├── evaluate.py
│   ├── calibration.py
│   └── inference.py
│
├── models/
│   ├── cad/
│   ├── lad/
│   ├── lcx/
│   └── rca/
│
├── explainability/
│   ├── shap_explainer.py
│   └── feature_importance.py
│
├── backend/
│   ├── main.py
│   ├── schemas.py
│   ├── routes/
│   │   ├── predict.py
│   │   └── explain.py
│   └── services/
│       ├── predictor.py
│       └── explainer.py
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── App.jsx
│   └── public/
│
├── assets/
│   └── anatomy/
│       └── heart.glb
│
├── notebooks/
│   ├── EDA.ipynb
│   └── model_comparison.ipynb
│
└── docs/
    ├── architecture.md
    └── evaluation.md
```

---

# 31. Evaluation Criteria

The challenge will evaluate the system using five primary categories.

## 31.1 Predictive Performance — 30%

Evaluation may consider:

- Classification performance.
- Appropriate validation methodology.
- ROC-AUC.
- Accuracy.
- Precision.
- Recall.
- F1-score.
- Probability/risk estimation quality.
- Robustness against leakage.

---

## 31.2 3D Visualization — 25%

Evaluation may consider:

- Quality of anatomical representation.
- Correct LAD/LCX/RCA correspondence.
- Spatial clarity.
- Interactive rotation.
- Zoom.
- Vessel selection.
- Prediction-dependent visual updates.
- Browser performance.

---

## 31.3 Clinical Interpretability — 20%

Evaluation may consider:

- SHAP/LIME or equivalent explanations.
- Patient-specific explanations.
- Feature importance.
- Physiological breakdown.
- Clarity of risk communication.
- Appropriate distinction between prediction and diagnosis.

---

## 31.4 System Integration — 15%

Evaluation may consider:

- Data pipeline quality.
- ML-to-API integration.
- API-to-frontend integration.
- Real-time visualization updates.
- Error handling.
- Modular architecture.

---

## 31.5 Technical Implementation — 10%

Evaluation may consider:

- Code quality.
- Reproducibility.
- Documentation.
- Appropriate use of public datasets/resources.
- Anatomical asset licensing.
- Maintainability.
- Engineering quality.

---

# 32. Suggested Evaluation Matrix

| Category | Weight | Key Evidence |
|---|---:|---|
| Predictive Performance | 30% | Test metrics, CV, ROC-AUC, leakage controls |
| 3D Visualization | 25% | Interactive anatomy, vessel mapping, responsiveness |
| Clinical Interpretability | 20% | SHAP/LIME, feature breakdown |
| System Integration | 15% | End-to-end working pipeline |
| Technical Implementation | 10% | Code quality, reproducibility, documentation |
| **Total** | **100%** | |

---

# 33. Technical Success Criteria

A complete implementation should satisfy the following:

### Machine Learning

- [ ] CAD classifier implemented.
- [ ] LAD classifier implemented.
- [ ] LCX classifier implemented.
- [ ] RCA classifier implemented.
- [ ] LAD/LCX/RCA/Cath excluded from model inputs.
- [ ] Reproducible preprocessing pipeline.
- [ ] Appropriate validation methodology.
- [ ] Accuracy reported.
- [ ] Precision reported.
- [ ] Recall reported.
- [ ] F1 reported.
- [ ] ROC-AUC reported.

### Explainability

- [ ] Patient-specific explanation.
- [ ] Feature contribution visualization.
- [ ] Vessel-specific explanation where feasible.
- [ ] Model attribution clearly distinguished from causality.

### 3D

- [ ] Interactive 3D heart/anatomical model.
- [ ] LAD represented.
- [ ] LCX represented.
- [ ] RCA represented.
- [ ] Prediction mapped to correct vessel.
- [ ] Rotate supported.
- [ ] Zoom supported.
- [ ] Vessel selection supported.
- [ ] Numerical probability shown alongside visual encoding.

### Dashboard

- [ ] Patient input.
- [ ] CAD output.
- [ ] Vessel outputs.
- [ ] Physiological measurements.
- [ ] Feature explanations.
- [ ] Safety disclaimer.

### Engineering

- [ ] Backend API.
- [ ] Frontend integration.
- [ ] Reproducible model artifacts.
- [ ] Documentation.
- [ ] Demo video.
- [ ] Anatomical asset licensing documented.

---

# 34. Core Design Principle

The central design principle is:

> **Use machine learning to estimate disease-associated probabilities from legitimate clinical features, use explainable AI to show what influenced those predictions, and use 3D anatomy to provide an intuitive vessel-level context — without claiming anatomical lesion localization that the dataset cannot support.**

The resulting system should bridge three layers:

```text
                 CLINICAL DATA
                      │
                      ▼
                MACHINE LEARNING
                      │
             ┌────────┴────────┐
             ▼                 ▼
        PROBABILITIES      EXPLANATIONS
             │                 │
             └────────┬────────┘
                      ▼
              3D ANATOMICAL UI
                      │
                      ▼
             HUMAN-INTERPRETABLE
                 DECISION SUPPORT
```

---

# 35. Final Challenge Goal

The final prototype should demonstrate that a structured clinical dataset can be transformed into an integrated, interpretable, and interactive cardiovascular AI experience.

The ideal system is not merely:

```text
Patient Data → ML → 73%
```

Instead, it should provide:

```text
Patient Data
     │
     ▼
Leakage-resistant ML
     │
     ├───────────────┐
     ▼               ▼
CAD probability   Vessel probabilities
     │               │
     │          ┌────┼────┐
     │          ▼    ▼    ▼
     │         LAD  LCX  RCA
     │          │    │    │
     └──────────┼────┼────┘
                ▼
         Interactive 3D
             Anatomy
                │
                ▼
         Explainable AI
                │
                ▼
        Clinical Dashboard
                │
                ▼
       Decision-Support View
```

The system should ultimately make the model's output **understandable, inspectable, anatomically contextualized, and technically reproducible**, while maintaining a clear boundary between machine-learning prediction and clinical diagnosis.