# Remaining Project Improvements

Review date: 2026-10-10. Based on all 35 sections of [PROBLEM.md](PROBLEM.md)
and the implementation available at review time.

Most core functionality is implemented: patient inputs, four prediction targets,
leakage controls, patient-specific explanations, interactive vessel visualization,
physiological breakdowns, and safety disclaimers. Remaining work primarily concerns
submission preparation, model evaluation, anatomical verification, and performance.

## Required submission deliverables

### 1. Record the demonstration video

- [ ] Produce a **3–10 minute** demonstration video.
- [ ] Show application startup and patient feature entry.
- [ ] Demonstrate inference, overall CAD prediction, and LAD/LCX/RCA probabilities.
- [ ] Show rotation, zoom, vessel selection, and prediction-dependent highlighting.
- [ ] Explain patient-specific contributions and the physiological breakdown.
- [ ] Present the technical architecture, validation metrics, and safety disclaimer.
- [ ] Include the video or its submission link in the project documentation.

No demonstration video was found in the repository at review time.
Requirement: **PROBLEM.md §28.5**; suggested flow: **§29**.

### 2. Finalize the submission report

- [ ] Compile [paper.tex](paper.tex) into the final submission PDF.
- [ ] Verify that the report is **no longer than 6 pages**.
- [ ] Update its implementation details and results to match the submitted artifacts.
- [ ] Cover problem definition, dataset, preprocessing, leakage prevention, feature
  engineering, model architecture, validation, evaluation, explainability, 3D
  visualization, system architecture, limitations, safety, and reproducibility.

The LaTeX source exists, but a compiled submission PDF was not found at review time.
Requirement: **PROBLEM.md §28.4**. The longer repository documentation can remain
as supporting material.

## High-priority technical improvements

### 3. Optimize 3D performance

- [ ] Reduce the size of `frontend/public/heart.glb`, approximately **66 MB** at review time.
- [ ] Reduce unnecessary geometry and texture resolution while preserving useful anatomy.
- [ ] Optimize artery-label visibility checks: `HeartViewer.tsx` currently raycasts
  against the heart inside frame callbacks.
- [ ] Measure model download/load time and camera responsiveness on ordinary laptops
  and phones, including devices without a dedicated GPU.
- [ ] Recheck coronary registration after changing the asset; regenerate reference
  paths when necessary.

Requirement: **PROBLEM.md §24**. Browser performance also contributes to the
3D visualization evaluation in **§31.2**.

### 4. Verify anatomical correspondence

- [ ] Review LAD, LCX, and RCA reference paths against anatomical references.
- [ ] Check anterior, posterior, and lateral views and document the reviewed landmarks.
- [ ] Review the approximate chamber, aorta, pulmonary trunk, and apex label anchors.
- [ ] Confirm that each prediction consistently updates the correct named vessel.
- [ ] Preserve the distinction between illustrative reference paths and verified
  native-vessel segmentation or patient-specific anatomy.

Current artery paths are manually registered overlays; chamber labels mark
approximate external regions. Existing geometry checks support registration but
do not establish clinical anatomical validation.
Relevant sections: **PROBLEM.md §§13–15, 27, 31.2**.

### 5. Improve LCX and RCA detection

The saved metrics in [training/artifacts/metrics.json](training/artifacts/metrics.json)
report test recall of approximately **45.8% for LCX** and **39.1% for RCA**.

- [ ] Evaluate further model, imbalance-handling, and decision-threshold experiments
  using training data and cross-validation.
- [ ] Compare recall alongside precision, F1, ROC-AUC, and precision–recall performance.
- [ ] Keep the held-out test set out of model and threshold selection.
- [ ] Report remaining weaknesses clearly, even if experiments do not improve results.

These are performance priorities, not failures to meet a specified minimum score:
the brief does not prescribe a minimum recall or ROC-AUC.
Relevant sections: **PROBLEM.md §§8–11, 31.1**.

## Recommended evaluation improvements

### 6. Strengthen evaluation presentation and probability assessment

The five required metrics already exist for all four targets. The following would
provide stronger supporting evidence:

- [ ] Add ROC and precision–recall curves for each target.
- [ ] Display confusion matrices in Model Info, alongside the existing metric table.
- [ ] Add calibration plots and held-out Brier scores.
- [ ] Report uncertainty intervals, with the method and small test-set limitations explained.
- [ ] Evaluate calibration using training-only folds and retain it only when supported
  by validation evidence.
- [ ] Keep probabilities labelled as model estimates; calibration alone does not
  establish clinically validated individual risk.

Calibration and these additional plots are recommended, not absolute submission
requirements. Relevant sections: **PROBLEM.md §§4.2, 10–11**.

## Integration and reproducibility

### 7. Complete integration checks before adopting new models

- [ ] Add the `vote` model display-name mapping to `training/model_info.py`.
  Training supports this model family, but the mapping was absent at review time;
  if it wins, Model Info can fail when reading its metadata.
- [ ] Verify new preprocessors and model artifacts through live prediction and explanation.
- [ ] Regenerate evaluation results and the offline Model Info snapshot when artifacts change.
- [ ] Check that thresholds, model identities, displayed metrics, and report contents
  correspond to the deployed artifacts.
- [ ] Restart the backend after replacing cached artifacts and run regression checks.

Reported training issues to resolve and verify:

- [ ] Verify the `CatBoostNative` clone-compatibility fix through the voting-model
  cross-validation path. The reported run stopped in
  `training/voting.py::optimize_voting_weights_and_threshold` when `clone(est)`
  raised `RuntimeError: Cannot clone object ... as the constructor either does
  not set or modifies parameter cat_features`. Preserve constructor parameters
  through initialization and `get_params` so scikit-learn can clone the estimator.
- [ ] Investigate repeated LightGBM warnings: `X does not have valid feature names,
  but LGBMClassifier was fitted with feature names`. Keep feature names and column
  order consistent between fitting and prediction; verify the cause before
  considering any narrowly scoped warning suppression.
- [ ] Rerun the affected training workflow and confirm voting-model evaluation
  completes and final metrics/artifacts are written. Candidate scores printed
  before the exception do not establish that the training run completed.

Relevant sections: **PROBLEM.md §§22–25, 28.2, 31.4–31.5**.

### 8. Assess missing-input robustness

- [ ] Evaluate representative patterns of omitted inputs, including heavily incomplete forms.
- [ ] Measure how the current default substitutions affect predictions and performance.
- [ ] Document limitations of estimates based on sparse inputs.
- [ ] Continue distinguishing supplied measurements from defaults; input completeness
  must not be presented as prediction confidence.

This is a recommended robustness check for the optional-input workflow, informed
by **PROBLEM.md §§7.1, 11, 26–27**.

### 9. Verify a clean installation

- [ ] Follow the documented setup in a fresh environment.
- [ ] Verify dependencies, saved-artifact loading, backend startup, and frontend startup.
- [ ] Run an end-to-end assessment, vessel explanation, 3D interaction, and PDF export.
- [ ] Confirm that documentation distinguishes live operation from demo fixtures.
- [ ] Record the tested setup and commands in the reproducibility instructions.

Relevant sections: **PROBLEM.md §§28.2, 28.4, 31.5**. Docker is an optional
implementation choice, not a mandatory deliverable in the brief.

## Make the multimodal clinical workflow more visible

The current application combines structured clinical data groups. ECG and
echocardiography inputs are recorded findings, PDF import extracts text, and the
3D heart visualizes predictions. These capabilities must not be presented as raw
ECG waveform analysis, echocardiographic image analysis, or patient-specific 3D
reconstruction. The following are recommended enhancements, not additional
mandatory deliverables from the brief.

### 10. Add a clinical data overview

- [ ] Display cards for demographics/history, symptoms/examination, laboratory
  tests, ECG findings, and echocardiography.
- [ ] Show supplied and defaulted input counts for each group.
- [ ] Preserve the distinction between entered, imported, sample, and default values.
- [ ] Describe these as clinical data groups rather than implying that raw signals
  or images were analyzed.

### 11. Show the prediction pipeline

- [ ] Add a visible pipeline explaining the actual workflow:

  ```text
  Clinical data groups → Preprocessing → Combined model
      → CAD and vessel estimates → Anatomical visualization
  ```

- [ ] Use wording such as “Combined clinical inputs” unless a separate
  modality-fusion architecture is actually implemented and evaluated.
- [ ] Make clear that the 3D view is an output visualization, not an imaging input.

### 12. Group explanations by clinical data source

- [ ] Aggregate existing signed feature contributions into the clinical groups
  used in the data overview.
- [ ] Show which groups increased or decreased the selected target's estimate.
- [ ] Keep individual feature contributions available for inspection.
- [ ] Identify contributions associated with defaulted inputs.
- [ ] Explain that these are grouped model attributions, not causal effects or
  independent predictions from separate modality models.
- [ ] Use complete attribution values when computing group totals; do not silently
  sum only the displayed top features. Define a consistent feature-to-group mapping.

### 13. Link data groups to detailed inspection

- [ ] Let users select a group such as ECG findings to inspect its recorded values,
  input sources, and contributions to the current CAD or vessel estimate.
- [ ] Keep group inspection synchronized with LAD, LCX, and RCA selection.
- [ ] Explain when a group has no supplied measurements and its contribution is
  based on default substitutions.

### 14. Evaluate the benefit of combining data groups

- [ ] Compare models trained on individual clinical groups with models trained on
  combined inputs, using identical validation splits and leakage-safe preprocessing.
- [ ] Consider leave-one-group-out experiments to assess the contribution of each group.
- [ ] Report measured performance and uncertainty for each target; do not assume
  combining groups necessarily improves predictions.
- [ ] Present these comparisons in Model Info and the submission report.
- [ ] Distinguish retrained group-comparison experiments from simply replacing
  a current patient's inputs with defaults.

### 15. Demonstrate the combined clinical workflow

- [ ] Include an assessment with laboratory, ECG, and echocardiographic findings
  in the demonstration video.
- [ ] Show the supplied/defaulted overview, group-level explanations, individual
  contributions, and corresponding vessel highlights.
- [ ] State explicitly that the current model consumes structured findings rather
  than raw waveforms or medical images.

Prioritize the **clinical data overview, grouped explanations, and comparison
experiments**. These make the combined-data approach both visible and supported
by evidence. Relevant sections: **PROBLEM.md §§5, 8–10, 18–21, 28.5**.

### Future extension: raw signal or image modalities

- [ ] Only pursue ECG waveform or echocardiographic image analysis with suitable
  datasets, compatible labels, and separately evaluated processing/model pipelines.
- [ ] Evaluate any actual fusion architecture before claiming benefits over the
  structured-data baseline.

This is a larger future extension, not a prerequisite for completing the current
prototype or making its existing clinical data groups clearer.

## Roadmap for multimodal model inputs

To support multimodal AI in the stronger technical sense, the prediction system
should jointly analyze different data types. More numeric fields, an upload
button, or a 3D visualization alone do not establish this capability. The current
PDF importer converts text into structured inputs; the heart viewer is an output.

The recommended first extension is **structured clinical data + raw ECG
waveforms**, conditional on obtaining suitable paired training data. It is not
necessary to add ECG, images, and text simultaneously.

### 16. Obtain paired data before building the extension

- [ ] Identify a dataset containing ECG recordings and structured clinical
  measurements for the same patients.
- [ ] Verify that the dataset provides labels compatible with the intended
  prediction targets: overall CAD and, if supported, LAD/LCX/RCA stenosis.
- [ ] Do not assume that a general ECG dataset includes vessel-specific labels.
- [ ] Match inputs by patient and appropriate assessment time, excluding information
  that would not have been available when making the prediction.
- [ ] Verify permitted dataset use and document label definitions and cohort limitations.

The existing structured dataset alone cannot train this extension. Unrelated ECG
recordings and clinical rows must not be treated as paired patient examples.

### 17. Add raw ECG input and signal analysis

- [ ] Define supported waveform formats and required lead, sampling-rate, and unit metadata.
- [ ] Add ECG upload and a waveform viewer so users can inspect the received signal.
- [ ] Implement reproducible signal preprocessing and a trained ECG encoder.
- [ ] Extract learned information from the waveform rather than relying exclusively
  on manually entered ECG findings.
- [ ] Keep model development and validation separate from the upload/display feature.

### 18. Combine ECG and structured clinical information

- [ ] Implement and evaluate a fusion model combining ECG-derived information with
  laboratory results, history, and other structured measurements.
- [ ] Define which outputs the paired data actually supports; retain clearly labelled
  tabular-only outputs where multimodal target labels are unavailable.
- [ ] Save and version the signal preprocessing, encoders, fusion model, and tabular
  preprocessing together for reproducible inference.
- [ ] Expose the active prediction mode in the API, dashboard, and exported reports.

### 19. Check input quality and modality availability

- [ ] Check waveform validity, required leads, sampling metadata, and signal quality
  using documented criteria.
- [ ] Show whether ECG input is available, accepted, rejected, or still processing.
- [ ] Define and evaluate behavior when ECG input is missing or unusable.
- [ ] Clearly identify any fallback to the tabular-only model; do not silently label
  fallback predictions as multimodal results.

### 20. Explain contributions across modalities

- [ ] Show how structured measurements and ECG-derived information contributed to
  the combined model's output using a defensible attribution method.
- [ ] If signal regions are highlighted, document the explanation method and its
  limitations; highlights are not proof of causal or diagnostic significance.
- [ ] Distinguish explanations of the combined model from explanations of separate
  single-modality models.
- [ ] Keep model attribution separate from plaque localization or patient-specific
  anatomical reconstruction.

### 21. Validate the benefit of multimodal fusion

- [ ] Compare tabular-only, ECG-only, and combined models on comparable patient cohorts
  using patient-separated validation splits.
- [ ] Keep all recordings from the same patient within one split and fit preprocessing
  and model-selection steps using training data only.
- [ ] Report the required classification metrics, probability assessment, and uncertainty
  for every supported target.
- [ ] Evaluate missing-modality and poor-quality-input scenarios separately.
- [ ] Report measured improvements or lack of improvement; do not assume fusion helps.

### Later modality and interaction options

| Addition | What it contributes | What it requires |
|---|---|---|
| Echocardiography video analysis | Learns motion and structural information from ultrasound clips | Paired echo videos, clinical data, and suitable outcome labels |
| Clinical-note understanding | Extracts symptoms, history, and context from narrative text | Notes available before diagnosis, with strict target-leakage control |
| Longitudinal measurements | Combines changing vitals or wearable signals with a clinical assessment | Patient-linked time series and clearly defined prediction timing |
| Cross-modal consistency checks | Flags conflicting information, such as disagreement between recorded findings and signal-derived findings | Validated comparison methods and a clear review workflow |
| Modality-aware confidence | Communicates how missing or poor-quality inputs affect reliability | Calibration and validation across different input combinations |
| Interactive modality comparison | Lets users compare tabular-only, ECG-only, and combined predictions | Separately evaluated models and clearly labelled comparisons |

Echocardiography analysis also requires separately evaluated image/video processing
and model pipelines. For clinical notes, diagnostic statements, angiography
conclusions, and post-diagnosis information may reveal the prediction target and
must not be used as legitimate pre-prediction inputs.

This roadmap extends the current prototype. It should not be described as an
already implemented capability or as an additional mandatory requirement of
the original challenge.
