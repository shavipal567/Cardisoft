import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer, ReferenceLine } from "recharts";
import { predict, explain } from "./api";
import type { PredictResponse, ExplainResponse, Target, Patient, Pred } from "./api";
import { FIELDS, GROUPS, SAMPLE, TARGETS, TARGET_LABELS, riskColor, validate, buildPayload } from "./fields";
import Logo from "./components/Logo";
import "./App.css";

const NEUTRAL = 0.005; // |contribution| below this is shown as neutral
const QUOTES = [
  "Be gentle with your heart. It works for you every single second.",
  "Rest is part of caring for yourself, too.",
  "Every heartbeat is a quiet new beginning.",
  "Looking after your health is a way of looking after the people who love you.",
];

function Percent({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min((t - start) / 700, 1);
      setN(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n}%</>;
}

function ThemeIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export default function App() {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem("cardisoft-theme") === "dark";
    } catch {
      return false;
    }
  });
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);
  const [values, setValues] = useState<Patient>({});
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [analyzed, setAnalyzed] = useState<Patient | null>(null);
  const [target, setTarget] = useState<Target>("CAD");
  const [explanations, setExplanations] = useState<Partial<Record<Target, ExplainResponse>>>({});
  const [explainError, setExplainError] = useState("");
  const [explainLoading, setExplainLoading] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("cardisoft-theme", dark ? "dark" : "light");
    } catch {
      /* storage unavailable: ignore */
    }
  }, [dark]);

  async function analyze() {
    const bad = validate(values);
    if (bad.length) {
      setError("Please check: " + bad.join(", "));
      return;
    }
    const payload = buildPayload(values);
    setLoading(true);
    setError("");
    try {
      const r = await predict(payload);
      setResult(r);
      setAnalyzed(payload);
      setExplanations({});
      setExplainError("");
      setTarget("CAD");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Fetch the explanation for the selected target (once per target per analysis)
  useEffect(() => {
    if (!result || !analyzed || explanations[target]) return;
    let cancelled = false;
    setExplainLoading(true);
    setExplainError("");
    explain(target, analyzed)
      .then((e) => !cancelled && setExplanations((p) => ({ ...p, [target]: e })))
      .catch((e) => !cancelled && setExplainError((e as Error).message))
      .finally(() => !cancelled && setExplainLoading(false));
    return () => {
      cancelled = true;
    };
  }, [result, analyzed, target, explanations]);

  const predOf = (t: Target): Pred | null =>
    !result ? null : t === "CAD" ? result.cad : result.vessels[t];

  const expl = explanations[target];
  const chartData = expl
    ? [...expl.features].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 8)
    : [];
  const selected = predOf(target);
  const axis = dark ? "#93a7bd" : "#7b8da1";

  return (
    <div className="page">
      <p className="quote">💙 {quote}</p>
      <header className="top">
          
        <Logo />
        <button className="theme-toggle" onClick={() => setDark((d) => !d)} aria-label="Toggle dark theme">
          <ThemeIcon dark={dark} />
          {dark ? "Light mode" : "Dark mode"}
        </button>
      </header>

      <div className="alert">
        <b>🚑 Emergency (India):</b> call <b>112</b> (national emergency) or <b>108</b> (ambulance). Chest pain,
        trouble breathing or fainting: do not wait for this tool.
      </div>

      <div className="layout">
        {/* ---------- Patient form ---------- */}
        <section className="card rise">
          <h2>🩺 Patient details</h2>
          <button className="btn soft" onClick={() => setValues(SAMPLE)}>
            Load sample patient
          </button>

          {GROUPS.map((g) => {
            const fields = FIELDS.filter((f) => g.keys.includes(f.key));
            const nums = fields.filter((f) => f.type === "number");
            const toggles = fields.filter((f) => f.type === "toggle");
            return (
              <div className="group" key={g.title}>
                <h4>{g.title}</h4>
                {nums.length > 0 && (
                  <div className="num-grid">
                    {nums.map((f) => (
                      <label key={f.key} className="field">
                        <span>{f.label}</span>
                        <input
                          type="number"
                          value={values[f.key] ?? ""}
                          min={f.min}
                          max={f.max}
                          onChange={(e) =>
                            setValues((p) => {
                              const n = { ...p };
                              if (e.target.value === "") delete n[f.key];
                              else n[f.key] = Number(e.target.value);
                              return n;
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
                {toggles.length > 0 && (
                  <div className="chips">
                    {toggles.map((f) => (
                      <button
                        type="button"
                        key={f.key}
                        className={"chip" + (values[f.key] ? " on" : "")}
                        aria-pressed={!!values[f.key]}
                        onClick={() => setValues((p) => ({ ...p, [f.key]: p[f.key] ? 0 : 1 }))}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <button className="btn primary" onClick={analyze} disabled={loading}>
            {loading ? "Analyzing..." : "Analyze"}
          </button>
          {error && <p className="error">{error}</p>}
        </section>

        {/* ---------- Results ---------- */}
        <section>
          {!result ? (
            <div className="card empty rise">
              
              <p>Fill in the patient details (or load the sample patient) and press Analyze.</p>
            </div>
          ) : (
            <>
              <div className="risk-grid">
                {TARGETS.map((t, i) => {
                  const p = predOf(t)!;
                  const pct = Math.round(p.probability * 100);
                  return (
                    <div
                      key={t + pct}
                      className={"card rise risk-card" + (target === t ? " sel" : "")}
                      style={{ animationDelay: `${i * 80}ms` }}
                      onClick={() => setTarget(t)}
                    >
                      <div className="risk-name">{TARGET_LABELS[t]}</div>
                      <div className="pct">
                        <Percent value={pct} />
                      </div>
                      <div className="meter">
                        <span style={{ width: `${pct}%`, background: riskColor(p.probability) }} />
                      </div>
                      <span className={"pill " + (p.prediction === 1 ? "pos" : "neg")}>
                        {p.prediction === 1 ? "Positive" : "Negative"}
                      </span>
                      {(t === "LCX" || t === "RCA") && (
                        <p className="note">Lower validation performance for this vessel</p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex">

                <div className="card">
                  <h3>What influenced this estimate</h3>
                  {selected && (
                    <p style={{ margin: "0 0 8px" }}>
                      {TARGET_LABELS[target]}: <b>{Math.round(selected.probability * 100)}%</b> model-estimated
                      probability, model classification{" "}
                      <span className={"pill " + (selected.prediction === 1 ? "pos" : "neg")}>
                        {selected.prediction === 1 ? "Positive" : "Negative"}
                      </span>
                    </p>
                  )}
                  {explainLoading && <p className="note">Loading explanation...</p>}
                  {explainError && <p className="error">Explanation unavailable: {explainError}</p>}
                  {expl && (
                    <>
                      <div style={{ height: 270 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 10 }}>
                            <XAxis type="number" stroke={axis} />
                            <YAxis type="category" dataKey="name" width={110} stroke={axis} />
                            <Tooltip
                              contentStyle={{
                                background: dark ? "#1b2d47" : "#fff",
                                border: "none",
                                borderRadius: 10,
                                color: dark ? "#dbe6f2" : "#34495e",
                              }}
                            />
                            <ReferenceLine x={0} stroke={axis} />
                            <Bar dataKey="contribution" radius={4}>
                              {chartData.map((c, i) => (
                                <Cell key={i} fill={c.contribution >= 0 ? "#e9657a" : "#6bb6e3"} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="note">
                        Base value {expl.base_value.toFixed(2)}. Rose bars pushed this model output up, blue bars
                        pushed it down. This describes the model's behaviour, not a medical cause.
                      </p>
                    </>
                  )}
                </div>
              </div>

              <details className="card">
                <summary>Patient values and how the model used them ({target})</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Measurement</th>
                      <th>Patient value</th>
                      <th>Model contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FIELDS.map((f) => {
                      const v = analyzed?.[f.key];
                      const c = expl?.features.find((x) => x.name === f.key)?.contribution;
                      const shown =
                        f.type === "toggle" ? (v === 1 ? f.on ?? "Present" : f.off ?? "Absent") : String(v);
                      let label = "n/a";
                      let cls = "";
                      if (c !== undefined) {
                        if (c > NEUTRAL) { label = `▲ Positive (+${c.toFixed(2)})`; cls = "up"; }
                        else if (c < -NEUTRAL) { label = `▼ Negative (${c.toFixed(2)})`; cls = "down"; }
                        else { label = "● Neutral"; }
                      }
                      return (
                        <tr key={f.key}>
                          <td>{f.label}</td>
                          <td>{shown}</td>
                          <td className={cls}>{label}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="note">"n/a" means this feature was not among the explanation values returned.</p>
              </details>
            </>
          )}
        </section>
      </div>

      <p className="notice">
        <b>Clinical Safety Notice:</b> This system is a machine-learning research and decision-support
        prototype intended for educational and demonstration purposes. Its predictions are not a medical
        diagnosis and must not be used as a substitute for qualified clinical assessment, diagnostic
        imaging, laboratory interpretation, or professional medical advice.
      </p>
    </div>
  );
}