"""Generate sample-lab-report.pdf — dummy text-based lab report for testing
the client-side PDF scan feature. Values match the SAMPLE patient in
frontend/src/fields.ts. Requires: pip install reportlab."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

OUT = "sample-lab-report.pdf"

SECTIONS = [
    ("SHAVIKA HOSPITAL", True),
    ("", False),
    ("Patient: Nigga       Sex: Male        Age: 58 years", False),
    ("Date: 12/03/2026            Ref: CARDIO-DEMO-001", False),
    ("", False),
    ("VITAL SIGNS", True),
    ("BMI 27.4 kg/m2", False),
    ("BP 140/90 mmHg (systolic 140)", False),
    ("Pulse rate 78 bpm", False),
    ("", False),
    ("BLOOD CHEMISTRY (fasting)", True),
    ("Fasting Blood Sugar 110 mg/dL", False),
    ("LDL-C 130 mg/dL", False),
    ("HDL-C 40 mg/dL", False),
    ("Triglycerides 160 mg/dL", False),
    ("", False),
    ("ECHOCARDIOGRAPHY", True),
    ("Ejection Fraction (LVEF) 50%", False),
    ("No regional wall motion abnormality noted.", False),
    ("", False),
    ("HISTORY & ECG", True),
    ("Diabetes mellitus present. Hypertension present.", False),
    ("Smoking: none. Family history negative for CAD.", False),
    ("Typical chest pain on exertion present.", False),
    ("Q wave absent. ST elevation negative.", False),
    ("ST depression present. T inversion present.", False),
    ("", False),
    ("Note: demonstration document with fictitious values.", False),
]


def main() -> None:
    c = canvas.Canvas(OUT, pagesize=A4)
    c.setFont("Helvetica-Bold", 14)
    y = 270 * mm
    first = True
    for text, heading in SECTIONS:
        c.setFont("Helvetica-Bold", 12 if first else 10)
        if heading:
            c.drawString(20 * mm, y, text)
        else:
            c.setFont("Helvetica", 10)
            c.drawString(20 * mm, y, text)
        first = False
        y -= 8 * mm
    c.showPage()
    c.save()
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
