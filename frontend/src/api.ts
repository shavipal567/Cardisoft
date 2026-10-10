import { FIELDS, fieldValueLabel } from "./fields";

export type Target = "CAD" | "LAD" | "LCX" | "RCA";
export type Vessel = Exclude<Target, "CAD">;
export type Patient = Record<string, number>;

export interface Pred { prediction: number; probability: number }
export type InputValues = Record<string, number | string>;
export interface PredictionContext {
  effective_inputs: InputValues;
  defaulted_inputs: string[];
  models: Record<Target, { name: string; version: string; training_revision: string }>;
}
export interface PredictResponse { cad: Pred; vessels: Record<Vessel, Pred>; context?: PredictionContext }
export interface FeatureContribution {
  name: string;
  value: number | string;
  contribution: number;
  assumed?: boolean; // true when the patient omitted this input (the server used a preset default)
}
export interface ExplainResponse {
  target: Target;
  base_value: number;
  features: FeatureContribution[];
  signed?: boolean; // false = importance only (no direction), e.g. the fallback method
  method?: string;
  model_version?: string;
  note?: string;
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

function toPred(v: unknown): Pred | null {
  if (typeof v === "number") return { probability: v, prediction: v >= 0.5 ? 1 : 0 };
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const p = [o.probability, o.prob, o.proba].find((x) => typeof x === "number") as number | undefined;
    if (p === undefined) return null;
    const c = [o.prediction, o.label, o.predicted, o.class].find(
      (x) => typeof x === "number" || typeof x === "boolean"
    );
    return { probability: p, prediction: c === undefined ? (p >= 0.5 ? 1 : 0) : Number(c) };
  }
  return null;
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
    const p = toPred(pool[t.toLowerCase()]);
    if (p) out[t] = p;
  }
  const missing = TARGET_KEYS.filter((t) => !out[t]);
  if (missing.length)
    throw new Error(`Unexpected /predict response (missing ${missing.join(", ")}). Keys: ${Object.keys(root).join(", ")}`);
  return { cad: out.CAD!, vessels: { LAD: out.LAD!, LCX: out.LCX!, RCA: out.RCA! },
    context: root.context as PredictionContext | undefined };
}

// "num__Age" -> "Age";  "cat__Sex_Male" -> "Sex"
function baseOf(name: string) {
  const i = name.indexOf("__");
  const prefix = i >= 0 ? name.slice(0, i) : "";
  const rest = i >= 0 ? name.slice(i + 2) : name;
  const cut = rest.lastIndexOf("_");
  return prefix === "cat" && cut > 0 ? rest.slice(0, cut) : rest;
}

function normalizeExplain(raw: unknown, target: Target, patient: Patient): ExplainResponse {
  const r = (raw ?? {}) as Record<string, unknown>;
  const feats = Array.isArray(r.features) ? (r.features as Record<string, unknown>[]) : [];
  const method = typeof r.method === "string" ? r.method : undefined;

  // add up the one-hot pieces of the same input
  const groups = new Map<string, { contribution: number; value: number | string; assumed: boolean }>();
  for (const f of feats) {
    const base = baseOf(String(f.name ?? ""));
    const c = Number(f.contribution ?? 0);
    const g = groups.get(base);
    if (g) {
      g.contribution += c;
      continue;
    }
    const inForm = patient[base] !== undefined;
    const rawVal = f.raw_value;
    groups.set(base, {
      contribution: c,
      assumed: !inForm,
      value: inForm
        ? fieldValueLabel(base, patient[base])
        : typeof rawVal === "number" || typeof rawVal === "string"
          ? rawVal
          : "default value",
    });
  }

  return {
    target,
    base_value: typeof r.base_value === "number" ? r.base_value : 0,
    method,
    model_version: typeof r.model_version === "string" ? r.model_version : undefined,
    note: typeof r.note === "string" ? r.note : undefined,
    signed: typeof r.signed === "boolean" ? r.signed : method === "shap_tree" || method === "permutation_shapley",
    features: [...groups].map(([name, g]) => ({ name, value: g.value, contribution: g.contribution, assumed: g.assumed })),
  };
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
    return all[target];
  }
  const res = await post("/explain", { target: target.toLowerCase(), features: toBackend(patient), top_k: 60 });
  if (!res.ok) return fail(res);
  return normalizeExplain(await res.json(), target, patient);
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
