import type { Target } from "./api";

export const PLAIN_NAMES: Record<string, string> = {
  Age: "Age",
  Sex: "Sex",
  BMI: "Body weight for height (BMI)",
  BP: "Blood pressure",
  PR: "Heart rate",
  FBS: "Blood sugar",
  LDL: "Cholesterol that can build up in arteries (LDL)",
  HDL: "Protective cholesterol (HDL)",
  TG: "Blood fats (triglycerides)",
  "EF-TTE": "How strongly the heart pumps",
  DM: "Diabetes",
  HTN: "High blood pressure",
  "Current Smoker": "Smoking",
  FH: "Family history of CAD (coronary artery disease)",
  "Typical Chest Pain": "Chest pain with a heart-related pattern",
  "Q Wave": "A heart-tracing (ECG) pattern called Q wave",
  "St Elevation": "A heart-tracing (ECG) change called ST elevation",
  "St Depression": "A heart-tracing (ECG) change called ST depression",
  Tinversion: "A heart-tracing (ECG) change called T inversion",
};
export const plainName = (n: string) => PLAIN_NAMES[n] ?? n;

export const PLAIN_LABEL: Record<Target, string> = {
  CAD: "Heart arteries overall",
  LAD: "Front artery",
  LCX: "Side and back artery",
  RCA: "Right and underside artery",
};

export const AREA: Record<Target, string> = {
  CAD: "at least one of the heart's main arteries",
  LAD: "the main artery at the front of the heart (called LAD)",
  LCX: "the artery that wraps around the side and back of the heart (called LCX)",
  RCA: "the artery on the right side and underside of the heart (called RCA)",
};

// Simple wording for the number. These are display words only, not medical categories.
export const band = (p: number) => (p < 0.35 ? "lower" : p < 0.65 ? "moderate" : "higher");
export const bandClass = (p: number) => (p < 0.35 ? "neg" : p < 0.65 ? "mid" : "pos");