import type { Patient, Target } from "./api";

export type Field = {
  key: string;
  label: string;
  type: "number" | "toggle" | "select";
  options?: { value: number; label: string; backend?: string }[];
  exclusiveMin?: boolean;
  min?: number;
  max?: number;
  on?: string;
  off?: string;
};

const YES_NO = [{ value: 0, label: "No", backend: "N" }, { value: 1, label: "Yes", backend: "Y" }];

// Keys must match the dataset column names the backend expects.
export const FIELDS: Field[] = [
  { key: "Age", label: "Age (years)", type: "number", min: 20, max: 100 },
  { key: "BMI", label: "BMI", type: "number", min: 10, max: 60 },
  { key: "BP", label: "Systolic BP (mmHg)", type: "number", min: 60, max: 250 },
  { key: "PR", label: "Pulse rate (bpm)", type: "number", min: 30, max: 200 },
  { key: "FBS", label: "Fasting blood sugar (mg/dL)", type: "number", min: 50, max: 500 },
  { key: "LDL", label: "LDL cholesterol (mg/dL)", type: "number", min: 10, max: 300 },
  { key: "HDL", label: "HDL cholesterol (mg/dL)", type: "number", min: 10, max: 120 },
  { key: "TG", label: "Triglycerides (mg/dL)", type: "number", min: 20, max: 1100 },
  { key: "EF-TTE", label: "Ejection fraction (%)", type: "number", min: 10, max: 80 },
  { key: "Sex", label: "Sex used by the model", type: "toggle", on: "Male", off: "Female" },
  { key: "DM", label: "Diabetes", type: "toggle" },
  { key: "HTN", label: "Hypertension", type: "toggle" },
  { key: "Current Smoker", label: "Current smoker", type: "toggle" },
  { key: "FH", label: "Family history of CAD", type: "toggle" },
  { key: "Typical Chest Pain", label: "Typical chest pain", type: "toggle" },
  { key: "Q Wave", label: "Q wave", type: "toggle" },
  { key: "St Elevation", label: "ST elevation", type: "toggle" },
  { key: "St Depression", label: "ST depression", type: "toggle" },
  { key: "Tinversion", label: "T inversion", type: "toggle" },
  { key: "Weight", label: "Weight (kg)", type: "number", min: 0, exclusiveMin: true },
  { key: "Length", label: "Height (cm)", type: "number", min: 0, exclusiveMin: true },
  { key: "CR", label: "Creatinine (mg/dL)", type: "number", min: 0 },
  { key: "BUN", label: "Blood urea nitrogen (mg/dL)", type: "number", min: 0 },
  { key: "ESR", label: "ESR (mm/hr)", type: "number", min: 0 },
  { key: "HB", label: "Hemoglobin (g/dL)", type: "number", min: 0, exclusiveMin: true },
  { key: "K", label: "Potassium (mEq/L)", type: "number", min: 0, exclusiveMin: true },
  { key: "Na", label: "Sodium (mEq/L)", type: "number", min: 0, exclusiveMin: true },
  { key: "WBC", label: "White blood cells (cells/µL)", type: "number", min: 0, exclusiveMin: true },
  { key: "Lymph", label: "Lymphocytes (%)", type: "number", min: 0, max: 100 },
  { key: "Neut", label: "Neutrophils (%)", type: "number", min: 0, max: 100 },
  { key: "PLT", label: "Platelets (10³/µL)", type: "number", min: 0 },
  { key: "EX-Smoker", label: "Former smoker", type: "toggle" },
  { key: "Edema", label: "Edema", type: "toggle" },
  { key: "Obesity", label: "Obesity", type: "select", options: YES_NO },
  { key: "CRF", label: "Chronic renal failure", type: "select", options: YES_NO },
  { key: "CVA", label: "Cerebrovascular accident", type: "select", options: YES_NO },
  { key: "Airway disease", label: "Airway disease", type: "select", options: YES_NO },
  { key: "Thyroid Disease", label: "Thyroid disease", type: "select", options: YES_NO },
  { key: "CHF", label: "Congestive heart failure", type: "select", options: YES_NO },
  { key: "DLP", label: "Dyslipidemia", type: "select", options: YES_NO },
  { key: "Weak Peripheral Pulse", label: "Weak peripheral pulse", type: "select", options: YES_NO },
  { key: "Lung rales", label: "Lung rales", type: "select", options: YES_NO },
  { key: "Systolic Murmur", label: "Systolic murmur", type: "select", options: YES_NO },
  { key: "Diastolic Murmur", label: "Diastolic murmur", type: "select", options: YES_NO },
  { key: "Dyspnea", label: "Dyspnea", type: "select", options: YES_NO },
  { key: "Atypical", label: "Atypical chest pain", type: "select", options: YES_NO },
  { key: "Nonanginal", label: "Nonanginal chest pain", type: "select", options: YES_NO },
  { key: "LowTH Ang", label: "Low-threshold angina", type: "select", options: YES_NO },
  { key: "LVH", label: "Left ventricular hypertrophy", type: "select", options: YES_NO },
  { key: "Poor R Progression", label: "Poor R progression", type: "select", options: YES_NO },
  { key: "Function Class", label: "Function class", type: "select", options: [{ value: 0, label: "0" }, { value: 1, label: "1" }, { value: 2, label: "2" }, { value: 3, label: "3"}] },
  { key: "Region RWMA", label: "Regional wall motion abnormality (code)", type: "select", options: [{ value: 0, label: "0" }, { value: 1, label: "1" }, { value: 2, label: "2" }, { value: 3, label: "3" }, { value: 4, label: "4"}] },
  { key: "BBB", label: "Bundle branch block", type: "select", options: [{ value: 0, label: "None", backend: "N" }, { value: 1, label: "LBBB", backend: "LBBB" }, { value: 2, label: "RBBB", backend: "RBBB"}] },
  { key: "VHD", label: "Valvular heart disease", type: "select", options: [{ value: 0, label: "None", backend: "N" }, { value: 1, label: "mild", backend: "mild" }, { value: 2, label: "Moderate", backend: "Moderate" }, { value: 3, label: "Severe", backend: "Severe"}] },
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

// green (lower) -> amber (middle) -> rose (higher). Always shown with the numeric probability.
export function riskColor(p: number) {
  const stops = [[124, 203, 162], [242, 195, 107], [233, 101, 122]];
  const t = Math.min(Math.max(p, 0), 1) * 2;
  const i = t < 1 ? 0 : 1;
  const f = t - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c.join(",")})`;
}

export function fieldError(field: Field, value: number | undefined): string {
  if (value === undefined) return "";
  if (!Number.isFinite(value)) return "Enter a valid number, or clear the field to use its default.";
  if (field.type === "toggle" && value !== 0 && value !== 1) return "Choose one of the listed options.";
  if (field.options && !field.options.some((option) => option.value === value)) return "Choose one of the listed options.";
  if (field.exclusiveMin && value <= (field.min ?? -Infinity)) return `Enter a value greater than ${field.min}.`;
  if (value < (field.min ?? -Infinity) || value > (field.max ?? Infinity)) {
    if (field.min !== undefined && field.max !== undefined) return `Enter a value from ${field.min} to ${field.max}.`;
    if (field.min !== undefined) return `Enter ${field.min} or greater.`;
    return `Enter ${field.max} or less.`;
  }
  return "";
}

export function validate(values: Patient): string[] {
  return FIELDS.filter((field) => fieldError(field, values[field.key])).map((field) => field.label);
}

export function buildPayload(values: Patient): Patient {
  return Object.fromEntries(FIELDS.filter((f) => values[f.key] !== undefined)
    .map((f) => [f.key, values[f.key]]));
}

export function fieldValueLabel(key: string, value: number): string {
  const field = FIELDS.find((f) => f.key === key);
  if (field?.type === "toggle") return value === 1 ? field.on ?? "Yes" : field.off ?? "No";
  return field?.options?.find((option) => option.value === value)?.label ?? String(value);
}

export const GROUPS = [
  { title: "About the patient", keys: ["Age", "Sex", "Weight", "Length", "BMI"] },
  { title: "Vitals and examination", keys: ["BP", "PR", "Edema", "Weak Peripheral Pulse", "Lung rales", "Systolic Murmur", "Diastolic Murmur"] },
  { title: "Medical history", keys: ["DM", "HTN", "Current Smoker", "EX-Smoker", "FH", "Obesity", "CRF", "CVA", "Airway disease", "Thyroid Disease", "CHF", "DLP"] },
  { title: "Symptoms", keys: ["Typical Chest Pain", "Dyspnea", "Function Class", "Atypical", "Nonanginal", "LowTH Ang"] },
  { title: "ECG findings", keys: ["Q Wave", "St Elevation", "St Depression", "Tinversion", "LVH", "Poor R Progression", "BBB"] },
  { title: "Blood chemistry and lipids", keys: ["FBS", "LDL", "HDL", "TG", "CR", "BUN", "K", "Na"] },
  { title: "Blood count and inflammation", keys: ["ESR", "HB", "WBC", "Lymph", "Neut", "PLT"] },
  { title: "Echocardiography", keys: ["EF-TTE", "Region RWMA", "VHD"] },
];
