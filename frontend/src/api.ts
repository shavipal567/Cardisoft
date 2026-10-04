export type Target = "CAD" | "LAD" | "LCX" | "RCA";
export type Vessel = Exclude<Target, "CAD">;
export type Patient = Record<string, number>;

export interface Pred { prediction: number; probability: number }
export interface PredictResponse { cad: Pred; vessels: Record<Vessel, Pred> }
export interface FeatureContribution { name: string; value: number | string; contribution: number }
export interface ExplainResponse { target: Target; base_value: number; features: FeatureContribution[] }

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

function post(path: string, body: unknown) {
  return fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// POST /predict : body is the flat patient object
export async function predict(patient: Patient): Promise<PredictResponse> {
  const res = USE_MOCK ? await fetch("/mock_predict.json") : await post("/predict", patient);
  return json<PredictResponse>(res);
}

// POST /explain : body is { target, patient }  (confirm this with your teammate)
export async function explain(target: Target, patient: Patient): Promise<ExplainResponse> {
  if (USE_MOCK) {
    const all = await json<Record<Target, ExplainResponse>>(await fetch("/mock_explain.json"));
    return all[target];
  }
  return json<ExplainResponse>(await post("/explain", { target, patient }));
}