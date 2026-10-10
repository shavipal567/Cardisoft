import type { ExplainResponse, InputValues, Patient, PredictResponse, Pred, Target } from "./api";
import { FIELDS, fieldValueLabel } from "./fields";

export interface Assessment {
  id: string;
  createdAt: string;
  name: string;
  inputs: Patient;
  result: PredictResponse;
  demo: boolean;
}
export type Explanations = Partial<Record<Target, ExplainResponse>>;
export const predictionOf = (assessment: Assessment, target: Target): Pred =>
  target === "CAD" ? assessment.result.cad : assessment.result.vessels[target];

export function completeness(inputs: Patient) {
  const supplied = FIELDS.filter((field) => inputs[field.key] !== undefined);
  const missing = FIELDS.filter((field) => inputs[field.key] === undefined);
  return { supplied, missing, percent: Math.round(supplied.length / FIELDS.length * 100) };
}

export function displayInput(key: string, inputs: Patient, effective?: InputValues): string {
  const entered = inputs[key];
  if (entered !== undefined) return fieldValueLabel(key, entered);
  const value = effective?.[key];
  if (value === undefined) return "Default unavailable";
  // Backend enum/binary values need their own decoding (Sex is a string here).
  if (typeof value === "number") return fieldValueLabel(key, value);
  const field = FIELDS.find((f) => f.key === key);
  return field?.options?.find((option) => option.backend === value)?.label ?? value;
}

export function changedInputs(before: Assessment, after: Assessment) {
  return FIELDS.filter((field) => {
    const a = before.inputs[field.key], b = after.inputs[field.key];
    const av = before.result.context?.effective_inputs[field.key];
    const bv = after.result.context?.effective_inputs[field.key];
    return a !== b || av !== bv;
  });
}

export function probabilityChange(before: number, after: number): string {
  const rounded = Math.round((after - before) * 1000) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} pp`;
}
