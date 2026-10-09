import type { Patient, PredictResponse } from "./api";

export interface PlanItem { title: string; text: string }
export interface Plan { headline: string; items: PlanItem[]; questions: string[] }

// Common reference thresholds (mg/dL and mmHg). They are prompts for a conversation, not diagnoses.
export function buildPlan(p: Patient, r: PredictResponse, clinician: boolean): Plan {
  const flagged = (["LAD", "LCX", "RCA"] as const).filter((t) => r.vessels[t].prediction === 1);
  const high = r.cad.prediction === 1 || flagged.length > 0;
  const items: PlanItem[] = [];
  const say = (title: string, patientText: string, clinicianText: string) =>
    items.push({ title, text: clinician ? clinicianText : patientText });

  say(
    "Talk it through with a doctor",
    "Take these results to a doctor or cardiologist. This tool gives an estimate, and only a doctor can tell you what is going on.",
    "Correlate with clinical assessment. This model output is decision support only and is not a diagnosis."
  );

  if (high) {
    say(
      "Ask about further tests",
      "Ask whether more heart tests would be sensible for you, for example a stress test or a scan of the heart's arteries.",
      "Consider confirmatory evaluation in line with local guidelines (for example stress testing or coronary imaging)."
    );
  } else {
    say(
      "A lower estimate is not a clear all-clear",
      "The model can miss problems. If you have chest pain, breathlessness or other symptoms, see a doctor even if the numbers look low.",
      "Model estimates do not exclude coronary disease, particularly for LCX and RCA where validation performance is weaker."
    );
  }

  if (p["Current Smoker"] === 1)
    say("Smoking", "Ask your doctor about support to stop smoking. It is one of the most helpful changes for heart health.", "Current smoker: consider cessation counselling and support.");
  if (p["BP"] >= 140)
    say("Blood pressure", "Your blood pressure reading is above the usual target. Ask to have it rechecked.", "Systolic BP at or above 140 mmHg: confirm with repeat measurements.");
  if (p["LDL"] >= 130)
    say("Cholesterol", "Your LDL cholesterol is on the high side. Ask about a cholesterol check and what to do about it.", "LDL at or above 130 mg/dL: review lipid assessment and management.");
  if (p["HDL"] < 40)
    say("Protective cholesterol", "Your protective (HDL) cholesterol is on the low side. Regular activity can help, and your doctor can advise.", "HDL below 40 mg/dL: review in the context of overall lipid profile.");
  if (p["TG"] >= 150)
    say("Blood fats", "Your triglycerides are above the usual range. Ask your doctor whether to recheck them.", "Triglycerides at or above 150 mg/dL: consider repeat fasting lipid panel.");
  if (p["FBS"] >= 126)
    say("Blood sugar", "Your fasting blood sugar is above the usual range. Ask about a diabetes check.", "Fasting glucose at or above 126 mg/dL: consider confirmatory glycaemic testing.");
  if (p["BMI"] >= 25)
    say("Weight", "Small, steady changes in food and activity can help. Ask what a healthy weight range is for you.", "BMI at or above 25: lifestyle counselling on diet and activity.");
  if (p["EF-TTE"] < 50)
    say("Heart pumping measure", "The measure of how strongly your heart pumps is lower than usual. Ask a cardiologist what it means for you.", "EF below 50%: correlate with the echo report and clinical status.");

  say(
    "Everyday habits",
    "Regular movement, meals with less salt and processed food, not smoking, good sleep and taking medicines as prescribed all help most hearts. Ask your doctor what is right for you.",
    "Reinforce standard lifestyle measures and adherence to prescribed therapy."
  );

  return {
    headline: high
      ? clinician
        ? "The model flags possible coronary disease. Correlate clinically."
        : "The model sees signs that are worth talking through with a doctor."
      : clinician
        ? "The model does not flag CAD for these inputs. This does not exclude disease."
        : "The model did not flag a strong concern, but it can miss things.",
    items,
    questions: [
      "What do these results mean for me?",
      "Do I need more tests, such as a stress test or a scan of my heart's arteries?",
      "Which of my numbers should I work on first?",
      "Which symptoms mean I should get help straight away?",
    ],
  };
}