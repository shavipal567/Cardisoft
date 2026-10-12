import { FIELDS } from "./fields";
import { normalizeExplanation, normalizePrediction, normalizePredictionContext } from "./explanation";
import { normalizeVesselFindings } from "./anatomy/stenosis";
import type { VesselFindings } from "./anatomy/stenosis";

export type Target = "CAD" | "LAD" | "LCX" | "RCA";
export type Vessel = Exclude<Target, "CAD">;
export type Patient = Record<string, number>;

export interface Pred { prediction: number; probability: number; threshold?: number }
export type InputValues = Record<string, number | string>;
export interface InputValidationMetrics {
  accuracy: number;
  correct: number;
  n_test: number;
  accuracy_interval: { low: number; high: number };
  recall: number | null;
  full_input_accuracy: number;
  majority_baseline: number;
  model_version: string;
}
export type InputValidation = {
  supplied_count: number;
  total_features: number;
} & ({ status: "available"; method: "held_out_default_substitution"; targets: Record<Target, InputValidationMetrics> }
  | { status: "unavailable"; reason: string });
export interface PredictionContext {
  effective_inputs: InputValues;
  defaulted_inputs: string[];
  models: Record<Target, { name: string; version: string; training_revision: string }>;
  input_validation?: InputValidation;
  input_signature?: string;
  feature_provenance?: Record<string, FeatureProvenance>;
}
export interface PredictResponse { cad: Pred; vessels: Record<Vessel, Pred>; context?: PredictionContext; vessel_findings?: VesselFindings }
export interface FeatureContribution {
  name: string;
  value: number | string | null;
  contribution: number;
  provenance?: FeatureProvenance;
  assumed?: boolean; // true when the patient omitted this input (the server used a preset default)
}
export type ProvenanceStatus = "recorded" | "measured" | "imputed" | "default" | "unavailable";
export interface FeatureProvenance { status: ProvenanceStatus; method?: string; detail?: string }
export interface ExplanationReliability {
  model_version?: string;
  evaluation?: string;
  source?: string;
  n_test?: number;
  roc_auc?: number;
  threshold?: number;
  sensitivity?: number;
  specificity?: number;
  brier?: number;
  selection_cv_brier?: number;
  calibration_status?: string;
  calibration_method?: string;
  external_validation?: string;
  attribution_stability?: string;
}
export interface ExplainResponse {
  target: Target;
  base_value: number | null;
  features: FeatureContribution[];
  signed?: boolean; // false = importance only (no direction), e.g. the fallback method
  method?: string;
  model_version?: string;
  note?: string;
  probability?: number;
  output_value?: number;
  output_space?: string;
  input_signature?: string;
  remaining_contribution?: number;
  total_features?: number;
  background_rows?: number;
  baseline_definition?: string;
  approximate?: boolean;
  reliability?: ExplanationReliability;
  invalid_features?: boolean;
}

export const DEMO_MODE = import.meta.env.VITE_USE_MOCK === "true";
const API_URL = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const TARGET_KEYS: Target[] = ["CAD", "LAD", "LCX", "RCA"];


// Translate numeric select values to the exact categories expected by the API.
function toBackend(p: Patient): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(p)) {
    const field = FIELDS.find((f) => f.key === k);
    out[k] = k === "Sex" ? (v === 1 ? "Male" : "Female")
      : field?.options?.find((option) => option.value === v)?.backend ?? v;
  }
  return out;
}

type Problem = { loc?: (string | number)[]; msg?: string };

async function fail(res: Response): Promise<never> {
  let msg = `Request failed (${res.status})`;
  try {
    const j = (await res.json()) as { detail?: string | Problem[] };
    const d = j.detail;
    if (typeof d === "string") msg += `: ${d}`;
    else if (Array.isArray(d))
      msg += ": " + d.slice(0, 3).map((x) => `${(x.loc ?? []).slice(1).join(".")} ${x.msg ?? ""}`).join("; ");
  } catch {
    /* response was not JSON */
  }
  throw new Error(msg);
}

// Accepts {cad, vessels:{LAD..}} or {cad, lad, lcx, rca} in any letter case
function normalizePredict(raw: unknown): PredictResponse {
  const root = (raw ?? {}) as Record<string, unknown>;
  const pool: Record<string, unknown> = {};
  const add = (o: unknown) => {
    if (o && typeof o === "object")
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) pool[k.toLowerCase()] = v;
  };
  add(root);
  add(root.vessels);
  add(root.predictions);
  add(root.targets);
  const out: Partial<Record<Target, Pred>> = {};
  for (const t of TARGET_KEYS) {
    const p = normalizePrediction(pool[t.toLowerCase()]);
    if (p) out[t] = p;
  }
  const missing = TARGET_KEYS.filter((t) => !out[t]);
  if (missing.length)
    throw new Error(`Unexpected /predict response (missing ${missing.join(", ")}). Keys: ${Object.keys(root).join(", ")}`);
  return { cad: out.CAD!, vessels: { LAD: out.LAD!, LCX: out.LCX!, RCA: out.RCA! },
    vessel_findings: normalizeVesselFindings(root.vessel_findings),
    context: normalizePredictionContext(root.context) };
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error("Cannot reach the prediction service. Start the backend and check the API connection, then try again.");
  }
}

function post(path: string, body: unknown) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function predict(patient: Patient): Promise<PredictResponse> {
  const res = DEMO_MODE ? await fetch("/mock_predict.json") : await post("/predict", toBackend(patient));
  if (!res.ok) return fail(res);
  return normalizePredict(await res.json());
}

export async function explain(target: Target, patient: Patient): Promise<ExplainResponse> {
  if (DEMO_MODE) {
    const res = await fetch("/mock_explain.json");
    if (!res.ok) return fail(res);
    const all = (await res.json()) as Record<Target, ExplainResponse>;
    return normalizeExplanation({ ...all[target], signed: true, method: "illustrative_demo" }, target);
  }
  const res = await post("/explain", { target: target.toLowerCase(), features: toBackend(patient), top_k: 60 });
  if (!res.ok) return fail(res);
  return normalizeExplanation(await res.json(), target);
}
export interface ModelMetrics {
  model_name: string;
  status: string;
  evaluation: string;
  dataset: { patients: number; features: number; train: number; test: number };
  targets: Record<string, {
    model_name: string;
    positive_rate: number;
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    roc_auc: number;
  }>;
}

export async function getModelInfo(): Promise<ModelMetrics> {
  const res = DEMO_MODE ? await fetch("/model-info.json") : await request("/model-info");
  if (!res.ok) return fail(res);
  return res.json();
}

export async function getInputDefaults(): Promise<InputValues> {
  const res = DEMO_MODE ? await fetch("/input-defaults.json") : await request("/input-defaults");
  if (!res.ok) return fail(res);
  return res.json();
}
