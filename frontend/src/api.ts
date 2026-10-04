import { FIELDS } from "./fields";

export type Target = "CAD" | "LAD" | "LCX" | "RCA";
export type Vessel = Exclude<Target, "CAD">;
export type Patient = Record<string, number>;

export interface Pred { prediction: number; probability: number }
export interface PredictResponse { cad: Pred; vessels: Record<Vessel, Pred> }
export interface FeatureContribution {
  name: string;
  value: number | string;
  contribution: number;
  assumed?: boolean; // true when the form does not collect this input (the model used a typical value)
}
export interface ExplainResponse {
  target: Target;
  base_value: number;
  features: FeatureContribution[];
  signed?: boolean; // false = importance only (no direction), e.g. the fallback method
  method?: string;
  note?: string;
}

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const TARGET_KEYS: Target[] = ["CAD", "LAD", "LCX", "RCA"];
const FORM_KEYS = new Set(FIELDS.map((f) => f.key));

// Our form uses numbers; the backend wants text for Sex.
function toBackend(p: Patient): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(p)) out[k] = k === "Sex" ? (v === 1 ? "Male" : "Female") : v;
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
  return { cad: out.CAD!, vessels: { LAD: out.LAD!, LCX: out.LCX!, RCA: out.RCA! } };
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
    const inForm = FORM_KEYS.has(base);
    const rawVal = f.raw_value;
    groups.set(base, {
      contribution: c,
      assumed: !inForm,
      value: inForm
        ? patient[base]
        : typeof rawVal === "number" || typeof rawVal === "string"
          ? rawVal
          : "typical value",
    });
  }

  return {
    target,
    base_value: typeof r.base_value === "number" ? r.base_value : 0,
    method,
    note: typeof r.note === "string" ? r.note : undefined,
    signed: method === undefined || method === "shap_tree",
    features: [...groups].map(([name, g]) => ({ name, value: g.value, contribution: g.contribution, assumed: g.assumed })),
  };
}

function post(path: string, body: unknown) {
  return fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function predict(patient: Patient): Promise<PredictResponse> {
  const res = USE_MOCK ? await fetch("/mock_predict.json") : await post("/predict", toBackend(patient));
  if (!res.ok) return fail(res);
  return normalizePredict(await res.json());
}

export async function explain(target: Target, patient: Patient): Promise<ExplainResponse> {
  if (USE_MOCK) {
    const res = await fetch("/mock_explain.json");
    if (!res.ok) return fail(res);
    const all = (await res.json()) as Record<Target, ExplainResponse>;
    return all[target];
  }
  const res = await post("/explain", { target: target.toLowerCase(), features: toBackend(patient), top_k: 60 });
  if (!res.ok) return fail(res);
  return normalizeExplain(await res.json(), target, patient);
}