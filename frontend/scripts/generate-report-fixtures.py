"""Render exact, fictional report text into repeatable PNG import fixtures.

Run from any directory: python3 frontend/scripts/generate-report-fixtures.py
Requires Pillow. These are synthetic software test cases, not clinical reports.
"""

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from PIL import Image, ImageDraw, ImageFont

OUTPUT = Path(__file__).resolve().parents[1] / "public" / "sample-reports"
FONT = "DejaVuSans.ttf"
BOLD = "DejaVuSans-Bold.ttf"

CASES = [
    {
        "file": "01-complete-report.png",
        "title": "Complete report",
        "rows": [
            "Age: 58 years", "Sex: Male", "BMI: 27.4", "BP: 140/90 mmHg",
            "Pulse rate: 78 bpm", "Fasting blood sugar: 110 mg/dL",
            "LDL-C: 130 mg/dL", "HDL-C: 40 mg/dL", "Triglycerides: 160 mg/dL",
            "LVEF: 50%", "Diabetes: present", "Hypertension: present",
            "Smoking: none", "Family history of CAD: negative",
            "Typical chest pain: present", "Q wave: absent", "ST elevation: negative",
            "ST depression: present", "T inversion: present",
        ],
        "expected_values": {
            "Age": 58, "Sex": 1, "BMI": 27.4, "BP": 140, "PR": 78,
            "FBS": 110, "LDL": 130, "HDL": 40, "TG": 160, "EF-TTE": 50,
            "DM": 1, "HTN": 1, "Current Smoker": 0, "FH": 0,
            "Typical Chest Pain": 1, "Q Wave": 0, "St Elevation": 0,
            "St Depression": 1, "Tinversion": 1,
        },
        "expected_skipped": [],
        "expected_error": None,
    },
    {
        "file": "02-negative-findings.png",
        "title": "Negative findings",
        "rows": [
            "Age: 46 years", "Sex: Female", "BMI: 23.8", "BP: 118/76 mmHg",
            "Pulse rate: 68 bpm", "Fasting blood sugar: 92 mg/dL",
            "LDL-C: 96 mg/dL", "HDL-C: 58 mg/dL", "Triglycerides: 110 mg/dL",
            "LVEF: 62%", "Diabetes: absent", "Hypertension: absent",
            "Smoking: none", "Family history of CAD: negative",
            "Typical chest pain: absent", "Q wave: absent", "ST elevation: absent",
            "ST depression: absent", "T inversion: absent",
        ],
        "expected_values": {
            "Age": 46, "Sex": 0, "BMI": 23.8, "BP": 118, "PR": 68,
            "FBS": 92, "LDL": 96, "HDL": 58, "TG": 110, "EF-TTE": 62,
            "DM": 0, "HTN": 0, "Current Smoker": 0, "FH": 0,
            "Typical Chest Pain": 0, "Q Wave": 0, "St Elevation": 0,
            "St Depression": 0, "Tinversion": 0,
        },
        "expected_skipped": [],
        "expected_error": None,
    },
    {
        "file": "03-partial-report.png",
        "title": "Partial report",
        "rows": ["Age: 45 years", "LDL-C: 92 mg/dL", "Diabetes: absent"],
        "expected_values": {"Age": 45, "LDL": 92, "DM": 0},
        "expected_skipped": [],
        "expected_error": None,
    },
    {
        "file": "04-invalid-values.png",
        "title": "Range validation test",
        "rows": [
            "Age: 150 years", "BMI: 75.0", "BP: 300/90 mmHg",
            "Fasting blood sugar: 40 mg/dL", "LDL-C: 999 mg/dL", "LVEF: 95%",
            "Pulse rate: 72 bpm", "HDL-C: 55 mg/dL", "Triglycerides: 150 mg/dL",
        ],
        "expected_values": {"PR": 72, "HDL": 55, "TG": 150},
        "expected_skipped": ["Age", "BMI", "BP", "FBS", "LDL", "EF-TTE"],
        "expected_error": None,
    },
    {
        "file": "05-no-matching-fields.png",
        "title": "Unstructured document",
        "rows": [
            "This document contains sample prose only.",
            "Please keep this page for software testing.",
            "The text reader should recognise these sentences.",
            "There are no measurements to fill in the form.",
        ],
        "expected_values": {},
        "expected_skipped": [],
        "expected_error": "Text was read, but no supported measurements were recognized.",
    },
    {
        "file": "06-blank-image.png",
        "title": "Blank image",
        "rows": [],
        "expected_values": {},
        "expected_skipped": [],
        "expected_error": "No readable text found.",
    },
]


def render(case):
    image = Image.new("RGB", (1600, 2300), "white")
    if case["rows"]:
        draw = ImageDraw.Draw(image)
        title_font = ImageFont.truetype(BOLD, 52)
        subtitle_font = ImageFont.truetype(BOLD, 38)
        body_font = ImageFont.truetype(FONT, 40)
        small_font = ImageFont.truetype(FONT, 30)
        draw.rectangle((0, 0, 1600, 165), fill="#e9f4f3")
        draw.text((95, 50), "CARDISOFT DEMO REPORT", fill="#163d47", font=title_font)
        draw.text((95, 205), case["title"], fill="#172d36", font=subtitle_font)
        draw.text((95, 270), "FICTIONAL DATA - SOFTWARE TESTING ONLY", fill="#45515a", font=small_font)
        draw.line((95, 345, 1505, 345), fill="#bcc9cc", width=2)
        for index, line in enumerate(case["rows"]):
            draw.text((100, 395 + index * 82), line, fill="#111111", font=body_font)
        draw.line((95, 2140, 1505, 2140), fill="#bcc9cc", width=2)
        draw.text((95, 2180), "Synthetic test fixture. Review extracted values before analysis.", fill="#45515a", font=small_font)
    image.save(OUTPUT / case["file"], optimize=True)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    expected = []
    for case in CASES:
        render(case)
        expected.append({
            **case,
            "expected_filled_count": len(case["expected_values"]),
            "expected_defaulted_count_from_empty_form": 54 - len(case["expected_values"]),
        })
    (OUTPUT / "expected-results.json").write_text(json.dumps(expected, indent=2) + "\n")
    with ZipFile(OUTPUT / "dummy-report-pngs.zip", "w", ZIP_DEFLATED) as archive:
        for name in [*(case["file"] for case in CASES), "expected-results.json", "README.md"]:
            path = OUTPUT / name
            if path.exists():
                archive.write(path, arcname=name)
    print(f"Generated {len(CASES)} PNGs, expected results and ZIP in {OUTPUT}")


if __name__ == "__main__":
    main()
