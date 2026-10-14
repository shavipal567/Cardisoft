# Multimodal input and model fusion

Cardisoft already accepts information through multiple user-facing modes. Users
can enter measurements in the form, speak or type a description for parsing, and
import a report as a selectable-text PDF or image. These paths help people get
clinical measurements into the assessment; they are not all separate inputs to
the prediction models.

## Implemented input modes

| User input | Processing in the web app | What reaches the prediction API |
| --- | --- | --- |
| Form entry | Values are validated against the field definitions. | The supplied structured clinical fields. |
| Speech | The browser's speech recognition service transcribes speech; Cardisoft parses the transcript into candidate fields for the user to review and apply. | The resulting structured fields, after the user chooses Analyze. |
| Typed description | Cardisoft parses the text into candidate fields for the user to review and apply. | The resulting structured fields, after the user chooses Analyze. |
| Report image | Tesseract.js performs printed-English OCR locally in the browser; recognized text is mapped to supported fields for review. | The resulting structured fields, after the user chooses Analyze. |
| Selectable-text PDF | pdf.js extracts text in the browser; recognized measurements are mapped to supported fields for review. | The resulting structured fields, after the user chooses Analyze. |

Speech recognition is provided by the browser. In Chrome, audio is processed
online, so the interface advises using demo data only. Report images and their
recognized text stay in the browser; OCR assets are served by the frontend.
Neither voice capture nor report import triggers a prediction automatically.
Users can edit and review parsed values before submitting. See
`frontend/README.md` and the [product tour](showcase.md) for supported files,
limits, and workflow details.

## What the prediction models consume

All of the input paths converge on the same structured 54-field clinical
contract: demographics, history, examination, symptoms, ECG findings, laboratory
values, and echocardiography measurements. The backend applies its documented
validation and preprocessing to these fields and returns estimates for CAD,
LAD, LCX, and RCA. The models do not ingest audio recordings, report pixels,
raw ECG waveforms, or echocardiogram images. OCR and speech recognition are
input and accessibility features; they do not add raw-media encoders or
model-level feature fusion.

```text
form values ───────────────────────────────────┐
speech → transcript → parsed fields → review ──┤
report image → OCR → parsed fields → review ────┼─► structured fields
text PDF → extracted text → parsed fields ─────┘       │
                                                       ▼
                                      preprocessing → CAD/LAD/LCX/RCA models
```

## Extending model-level fusion

Adding raw ECG waveforms, echocardiogram images, or another model input would
require paired data and labels for the same patients and targets. A possible
path is:

1. Add a modality-specific preprocessing or encoder beside the tabular
   `build_preprocessor()` path.
2. Evaluate late fusion of modality vectors first, then score-level fusion with
   a meta-learner if it improves held-out performance.
3. Extend the inference contract to accept optional modality inputs and define
   behavior when a modality is missing.
4. Extend explanations to identify each modality's contribution and preserve
   feature-level attribution where possible.
5. Compare against the existing tabular baseline using leakage-safe,
   patient-aligned evaluation and per-modality ablations.

Do not add a modality without labels aligned to the same targets or combine
unpaired patient cohorts. Either choice would undermine the validation
guarantees described in [evaluation](evaluation.md).
