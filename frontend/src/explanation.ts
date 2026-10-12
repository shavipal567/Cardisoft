import { FIELDS, fieldValueLabel } from "./fields";
import type { ExplainResponse, ExplanationReliability, FeatureContribution, FeatureProvenance, Pred, PredictionContext, ProvenanceStatus, Target } from "./api";

export const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const probability = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const string = (v: unknown) => typeof v === "string" && v.length ? v : undefined;

// A missing classification is a contract error, never an invitation to apply a
// frontend threshold. Preserve even an unexpected backend classification decision.
export function normalizePrediction(raw: unknown): Pred | null {
  const row = object(raw);
  const p = [row.probability, row.prob, row.proba].find(probability);
  const c = [row.prediction, row.label, row.predicted, row.class].find(v => v === 0 || v === 1 || typeof v === "boolean");
  if (p === undefined || c === undefined) return null;
  return { probability: p, prediction: Number(c), threshold: probability(row.threshold) ? row.threshold : undefined };
}

export const PROVENANCE: Record<ProvenanceStatus, { label: string; detail: string }> = {
  recorded: { label: "Recorded", detail: "Explicitly supplied in this assessment. Measurement acquisition is not verified." },
  measured: { label: "Measured", detail: "The source pipeline identifies this input as a measurement." },
  imputed: { label: "Imputed", detail: "The source pipeline reports replacement of a missing value. Imputation method unavailable." },
  default: { label: "Default / Auto-supplied", detail: "The source pipeline reports an automatically supplied value; it is not a recorded patient measurement." },
  unavailable: { label: "Provenance unavailable", detail: "The source of this input could not be established." },
};

function normalizeProvenance(raw: unknown): FeatureProvenance {
  const p = object(raw);
  return { status: typeof p.status === "string" && Object.hasOwn(PROVENANCE, p.status) ? p.status as ProvenanceStatus : "unavailable",
    method: string(p.method), detail: string(p.detail) };
}

export function normalizePredictionContext(raw: unknown): PredictionContext | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = object(raw);
  const models = {} as PredictionContext["models"];
  for (const target of ["CAD", "LAD", "LCX", "RCA"] as const) {
    const model = object(object(source.models)[target]);
    if (string(model.version)) models[target] = { version: model.version as string,
      name: string(model.name) ?? "Model", training_revision: string(model.training_revision) ?? "unavailable" };
  }
  return {
    effective_inputs: Object.fromEntries(Object.entries(object(source.effective_inputs)).filter(([, v]) => finite(v) || typeof v === "string")) as PredictionContext["effective_inputs"],
    defaulted_inputs: Array.isArray(source.defaulted_inputs) ? source.defaulted_inputs.filter((v): v is string => typeof v === "string") : [],
    feature_provenance: Object.fromEntries(Object.entries(object(source.feature_provenance)).map(([key, value]) => [key, normalizeProvenance(value)])),
    models, input_signature: string(source.input_signature), input_validation: source.input_validation as PredictionContext["input_validation"],
  };
}

function normalizeReliability(raw: unknown): ExplanationReliability | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = object(raw);
  const out: Record<string, unknown> = {};
  for (const key of ["model_version", "evaluation", "source", "calibration_status", "calibration_method", "external_validation", "attribution_stability"]) {
    if (string(source[key])) out[key] = source[key];
  }
  for (const key of ["roc_auc", "threshold", "sensitivity", "specificity", "brier", "selection_cv_brier"]) {
    if (probability(source[key])) out[key] = source[key];
  }
  if (finite(source.n_test) && Number.isInteger(source.n_test) && source.n_test > 0) out.n_test = source.n_test;
  return out;
}

export function normalizeExplanation(raw: unknown, target: Target): ExplainResponse {
  const r = object(raw);
  if (r.target !== undefined && String(r.target).toUpperCase() !== target) throw new Error("Explanation target does not match the selected prediction.");
  const groups = new Map<string, FeatureContribution>();
  let invalid = !Array.isArray(r.features);
  for (const item of Array.isArray(r.features) ? r.features : []) {
    const f = object(item);
    if (!string(f.name) || !finite(f.contribution)) { invalid = true; continue; }
    const original = f.name as string;
    const rest = original.split("__").at(-1)!;
    const name = original.startsWith("cat__") ? rest.slice(0, Math.max(rest.lastIndexOf("_"), 0)) || rest : rest;
    // A transformed one-hot value is not the raw patient input.
    const value = f.raw_value !== undefined ? f.raw_value : original.includes("__") ? null : f.value;
    const provenance = normalizeProvenance(f.provenance);
    const old = groups.get(name);
    if (old) {
      old.contribution += f.contribution;
      if (old.value !== value) old.value = null;
      if (old.provenance?.status !== provenance.status) old.provenance = { status: "unavailable" };
      continue;
    }
    groups.set(name, { name, contribution: f.contribution,
      value: finite(value) || typeof value === "string" ? value : null,
      provenance, assumed: provenance.status === "default" || provenance.status === "imputed" });
  }
  const features = [...groups.values()].filter(f => {
    if (!finite(f.contribution)) { invalid = true; return false; }
    return true;
  });
  return {
    target, features, invalid_features: invalid,
    base_value: finite(r.base_value) ? r.base_value : null,
    probability: probability(r.probability) ? r.probability : undefined,
    output_value: finite(r.output_value) ? r.output_value : undefined,
    output_space: string(r.output_space), method: string(r.method),
    model_version: string(r.model_version), input_signature: string(r.input_signature),
    signed: typeof r.signed === "boolean" ? r.signed : undefined,
    approximate: typeof r.approximate === "boolean" ? r.approximate : undefined,
    remaining_contribution: finite(r.remaining_contribution) ? r.remaining_contribution : undefined,
    total_features: finite(r.total_features) && Number.isInteger(r.total_features) && r.total_features >= 0 ? r.total_features : undefined,
    background_rows: finite(r.background_rows) && r.background_rows > 0 ? r.background_rows : undefined,
    baseline_definition: string(r.baseline_definition), note: string(r.note),
    reliability: normalizeReliability(r.reliability),
  };
}

// Names and units come from the existing input schema/dataset dictionary. Keep
// atypical and typical chest pain distinct; do not invent meanings for RWMA codes.
const LABELS: Record<string, string> = {
  DM: "Diabetes mellitus (DM)", ESR: "Erythrocyte sedimentation rate (ESR)",
  Sex: "Sex recorded in patient data", Neut: "Neutrophils", Lymph: "Lymphocytes",
  BP: "Blood pressure", FH: "Family history", BMI: "Body mass index (BMI)",
};
export function featureMeta(name: string) {
  const field = FIELDS.find(f => f.key === name);
  const label = field?.label ?? name;
  const unit = field?.type === "number" ? label.match(/\(([^)]+)\)$/)?.[1] : undefined;
  return { label: LABELS[name] ?? (unit ? label.slice(0, label.lastIndexOf(" (")).trim() : label),
    unit: name === "BMI" ? "kg/m²" : unit };
}
export function featureValue(feature: FeatureContribution): string {
  const v = feature.value;
  if (v === null || v === undefined || (typeof v === "number" && !finite(v)) || v === "") return "Value unavailable";
  const field = FIELDS.find(f => f.key === feature.name);
  if (typeof v === "number") return fieldValueLabel(feature.name, v);
  return field?.options?.find(o => o.backend === v)?.label ?? v;
}
export function statusOf(feature: FeatureContribution): ProvenanceStatus {
  return feature.provenance?.status ?? "unavailable";
}
export function provenanceDetail(feature: FeatureContribution) {
  return feature.provenance?.detail ?? PROVENANCE[statusOf(feature)].detail;
}
const compact = (n: number, digits = 2) => Math.abs(n).toFixed(digits);
export function formatContribution(value: number, space?: string, long = false) {
  if (!finite(value)) return "Contribution unavailable";
  const scaled = space === "probability" ? value * 100 : value;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const amount = scaled !== 0 && Math.abs(scaled) < .01 ? "<0.01" : compact(scaled);
  const unit = space === "probability" ? (long ? " percentage points" : " pp") : space === "log_odds" ? " log-odds" : " raw units";
  return `${sign}${amount}${unit}`;
}
export function formatOutput(value: number | null | undefined, space?: string) {
  if (!finite(value)) return "Unavailable";
  if (space === "probability") return `${(value * 100).toFixed(1)}%`;
  return `${value.toFixed(3)} ${space === "log_odds" ? "log-odds" : "raw units"}`;
}
export const thresholdMargin = (p: number, threshold?: number) => probability(p) && probability(threshold) ? (p - threshold) * 100 : null;
export function direction(value: number, signed?: boolean) {
  return signed !== true ? "unknown" : value === 0 ? "neutral" : value > 0 ? "positive" : "negative";
}
export const DIRECTION = {
  positive: "Increases the model's output relative to the baseline.",
  negative: "Decreases the model's output relative to the baseline.",
  neutral: "Has little or no contribution for this prediction.",
  unknown: "Direction unavailable from this explanation method.",
};
export function axisLabel(space?: string) {
  return space === "probability" ? "SHAP contribution to estimated probability (percentage points)"
    : space === "log_odds" ? "SHAP contribution to model output (log-odds)"
      : space === "raw" ? "SHAP contribution to model output (raw units)" : "Feature contribution to model output (raw units; output space unavailable)";
}

const TOLERANCE = 1e-6; // probability units (0.0001 pp); not a rounding correction
export function explanationMatch(e: ExplainResponse, target: Target, pred: Pred, context?: PredictionContext) {
  if (e.target !== target || (e.model_version && context?.models?.[target]?.version && e.model_version !== context.models[target].version)
    || (e.input_signature && context?.input_signature && e.input_signature !== context.input_signature)
    || (finite(e.probability) && Math.abs(e.probability - pred.probability) > TOLERANCE)) return "mismatch";
  return e.model_version && e.model_version === context?.models?.[target]?.version
    && e.input_signature && e.input_signature === context?.input_signature && finite(e.probability) ? "verified" : "unverified";
}

export interface WaterfallStep { name: string; start: number; end: number; contribution?: number }
export function waterfall(e: ExplainResponse, visible: FeatureContribution[], verified: boolean): { steps: WaterfallStep[]; reason?: string } {
  const unavailable = (reason: string) => ({ steps: [], reason });
  if (!verified) return unavailable("Waterfall unavailable: the explanation cannot be verified against this prediction.");
  if (e.signed !== true || !["probability", "log_odds", "raw"].includes(e.output_space ?? "")) return unavailable("Waterfall unavailable: additive output space is not documented.");
  const output = e.output_value ?? (e.output_space === "probability" ? e.probability : undefined);
  if (!finite(e.base_value) || !finite(output) || !e.features.length || e.invalid_features) return unavailable("Waterfall unavailable: baseline, output or valid contributions are missing.");
  if (e.output_space === "probability" && (!probability(e.base_value) || !probability(output) || !finite(e.probability) || Math.abs(output - e.probability) > TOLERANCE)) return unavailable("Waterfall unavailable: probability outputs disagree.");
  const total = e.features.reduce((sum, f) => sum + f.contribution, 0) + (e.remaining_contribution ?? 0);
  if (!finite(total) || Math.abs(e.base_value + total - output) > TOLERANCE) return unavailable("Waterfall unavailable: the baseline and contributions do not reconcile with the final model output.");
  const steps: WaterfallStep[] = [{ name: "Baseline model output", start: 0, end: e.base_value }];
  let cumulative = e.base_value;
  for (const f of visible) {
    steps.push({ name: featureMeta(f.name).label, start: cumulative, end: cumulative + f.contribution, contribution: f.contribution });
    cumulative += f.contribution;
  }
  const other = total - visible.reduce((sum, f) => sum + f.contribution, 0);
  const count = (e.total_features ?? e.features.length) - visible.length;
  if (count > 0 || Math.abs(other) > TOLERANCE) {
    steps.push({ name: count > 0 ? `Other ${count} features (combined)` : "Remaining contributions (combined)", start: cumulative, end: cumulative + other, contribution: other });
  }
  steps.push({ name: "Final model output", start: 0, end: output });
  return { steps };
}
