# Dummy PNG reports

These are fictional, printed-English test fixtures for Cardisoft's report importer.
The numbers are test inputs, not diagnoses or clinical recommendations.

Download [all six PNGs and expected results](dummy-report-pngs.zip), or use an
individual image below. With Vite running, they are also available at
`http://localhost:5173/sample-reports/<filename>`.

Select **Start new assessment** before each test, then open **Import measurements
from a report → Choose PDF or image**. Compare the imported fields with the image
and [expected-results.json](expected-results.json).

| Image | Expected result from an empty form |
|---|---|
| [01-complete-report.png](01-complete-report.png) | 19 fields filled; 35 remain defaulted. Age 58, Male, BMI 27.4, BP 140, pulse 78; mixed positive/negative history and ECG findings. |
| [02-negative-findings.png](02-negative-findings.png) | 19 fields filled; 35 defaulted. Age 46, Female, BMI 23.8; all nine history/ECG flags should be No, counted as supplied values. |
| [03-partial-report.png](03-partial-report.png) | Exactly three fields: Age 45, LDL 92, Diabetes No. The other 51 remain defaulted. |
| [04-invalid-values.png](04-invalid-values.png) | Fill pulse 72, HDL 55 and triglycerides 150. Skip Age, BMI, BP, FBS, LDL and LVEF because they exceed the app's acceptance limits. |
| [05-no-matching-fields.png](05-no-matching-fields.png) | Readable text, but no supported measurements; show an explanatory message and leave inputs unchanged. |
| [06-blank-image.png](06-blank-image.png) | No readable text; show an explanatory message and leave inputs unchanged. |

All images are 1600 × 2300 pixels and below the 15 MB upload limit. The blank
fixture intentionally has no text, including no title or disclaimer.

The current mapper supports 19 fields, so a complete report here means all 19
importable fields, not every one of the 54 model inputs. `expected_values` uses
the frontend's numeric representation: Sex Male = 1 / Female = 0, Yes = 1 / No = 0;
BP contains only the systolic measurement. Report imports merge into the current
form, which is why tests should start with an empty assessment.

To regenerate these exact fixtures, install Pillow and run from the repository root:

```bash
python3 frontend/scripts/generate-report-fixtures.py
```

The generator renders fixed text with DejaVu Sans fonts. No image-generation model
is involved, so the intended test values are fixed and reproducible.
