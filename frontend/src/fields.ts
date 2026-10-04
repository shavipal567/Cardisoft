import type { Patient, Target } from "./api";

export type Field = {
  key: string;
  label: string;
  type: "number" | "toggle";
  min?: number;
  max?: number;
  on?: string;
  off?: string;
};

// Keys must match the dataset column names the backend expects. Confirm with your teammate.
export const FIELDS: Field[] = [
  { key: "Age", label: "Age (years)", type: "number", min: 20, max: 100 },
  { key: "BMI", label: "BMI", type: "number", min: 10, max: 60 },
  { key: "BP", label: "Systolic BP (mmHg)", type: "number", min: 60, max: 250 },
  { key: "PR", label: "Pulse rate (bpm)", type: "number", min: 30, max: 200 },
  { key: "FBS", label: "Fasting blood sugar", type: "number", min: 50, max: 500 },
  { key: "LDL", label: "LDL cholesterol", type: "number", min: 20, max: 300 },
  { key: "HDL", label: "HDL cholesterol", type: "number", min: 10, max: 120 },
  { key: "TG", label: "Triglycerides", type: "number", min: 20, max: 1100 },
  { key: "EF-TTE", label: "Ejection fraction (%)", type: "number", min: 10, max: 80 },
  { key: "Sex", label: "Male sex", type: "toggle", on: "Male", off: "Female" },
  { key: "DM", label: "Diabetes", type: "toggle" },
  { key: "HTN", label: "Hypertension", type: "toggle" },
  { key: "Current Smoker", label: "Current smoker", type: "toggle" },
  { key: "FH", label: "Family history", type: "toggle" },
  { key: "Typical Chest Pain", label: "Typical chest pain", type: "toggle" },
  { key: "Q Wave", label: "Q wave", type: "toggle" },
  { key: "St Elevation", label: "ST elevation", type: "toggle" },
  { key: "St Depression", label: "ST depression", type: "toggle" },
  { key: "Tinversion", label: "T inversion", type: "toggle" },
];

export const SAMPLE: Patient = {
  Age: 58, BMI: 27.4, BP: 140, PR: 78, FBS: 110, LDL: 130, HDL: 40, TG: 160, "EF-TTE": 50,
  Sex: 1, DM: 1, HTN: 1, "Current Smoker": 0, FH: 0, "Typical Chest Pain": 1,
  "Q Wave": 0, "St Elevation": 0, "St Depression": 1, Tinversion: 1,
};

export const TARGETS: Target[] = ["CAD", "LAD", "LCX", "RCA"];
export const TARGET_LABELS: Record<Target, string> = {
  CAD: "Overall CAD",
  LAD: "LAD (anterior)",
  LCX: "LCX (lateral/posterior)",
  RCA: "RCA (right/inferior)",
};

// blue (low) -> amber (middle) -> red (high). Always shown with the numeric probability.
// green (lower) -> amber (middle) -> rose (higher). Always shown with the numeric probability.
export function riskColor(p: number) {
  const stops = [[124, 203, 162], [242, 195, 107], [233, 101, 122]];
  const t = Math.min(Math.max(p, 0), 1) * 2;
  const i = t < 1 ? 0 : 1;
  const f = t - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c.join(",")})`;
}
export function validate(values: Patient): string[] {
  return FIELDS.filter((f) => {
    if (f.type !== "number") return false;
    const v = values[f.key];
    return v === undefined || Number.isNaN(v) || v < (f.min ?? -Infinity) || v > (f.max ?? Infinity);
  }).map((f) => f.label);
}

export function buildPayload(values: Patient): Patient {
  const out: Patient = {};
  FIELDS.forEach((f) => (out[f.key] = values[f.key] ?? 0));
  return out;
}
export const GROUPS = [
  { title: "About the patient", keys: ["Age", "Sex", "BMI"] },
  { title: "Heart and blood pressure", keys: ["BP", "PR", "EF-TTE"] },
  { title: "Blood tests", keys: ["FBS", "LDL", "HDL", "TG"] },
  { title: "Medical history", keys: ["DM", "HTN", "Current Smoker", "FH"] },
  { title: "Symptoms and ECG", keys: ["Typical Chest Pain", "Q Wave", "St Elevation", "St Depression", "Tinversion"] },
];