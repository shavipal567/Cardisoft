import { useEffect, useRef, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer, ReferenceLine } from "recharts";
import { predict, explain, DEMO_MODE } from "./api";
import type { PredictResponse, ExplainResponse, Target, Patient, Pred } from "./api";
import { FIELDS, GROUPS, SAMPLE, TARGETS, TARGET_LABELS, riskColor, validate, buildPayload, fieldValueLabel } from "./fields";
import { PLAIN_LABEL, band, bandClass } from "./plain";
import Logo from "./components/Logo";
import ModelInfo from "./components/ModelInfo";
import PatientSummary from "./components/PatientSummary";
import CarePlan from "./components/CarePlan";
import { extractPdfText } from "./pdf/extractText";
import { parsePatientFromText } from "./pdf/fieldMap";
import type { PdfHit } from "./pdf/fieldMap";
import HeartViewer from "./components/HeartViewer";
import "./App.css";
import "./features.css";

const NEUTRAL = 0.005; // |contribution| below this is shown as neutral

type Gender = "" | "Male" | "Female" | "Others";

const QUOTES = [
  "Be gentle with your heart. It works for you every single second.",
  "Small, kind choices today are a gift to your future self.",
  "Rest is part of caring for yourself, too.",
  "Every heartbeat is a quiet new beginning.",
  "Looking after your health is a way of looking after the people who love you.",
  "Progress, not perfection. One steady step at a time.",
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
  const [view, setView] = useState<"clinician" | "patient">("clinician");
  const [tab, setTab] = useState<"assessment" | "model">("assessment");
  const [name, setName] = useState("");
  const [analyzedName, setAnalyzedName] = useState("");
  const [gender, setGender] = useState<Gender>("");
  const [values, setValues] = useState<Patient>({});
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [analyzed, setAnalyzed] = useState<Patient | null>(null);
  const [target, setTarget] = useState<Target>("CAD");
  const [explanations, setExplanations] = useState<Partial<Record<Target, ExplainResponse>>>({});
  const [explainErrors, setExplainErrors] = useState<Partial<Record<Target, string>>>({});
  const explainError = explainErrors[target] ?? "";
  const explainLoading = !!result && !explanations[target] && !explainError;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pdfFileName, setPdfFileName] = useState("");
  const [pdfHits, setPdfHits] = useState<PdfHit[]>([]);
  const [pdfSkipped, setPdfSkipped] = useState<{ key: string; reason: string }[]>([]);
  const [pdfError, setPdfError] = useState("");

  const resultsRef = useRef<HTMLElement>(null);
  const completedFields = Object.keys(buildPayload(values)).length;
  const resultsOutdated = analyzed && FIELDS.some((field) => values[field.key] !== analyzed[field.key]);

  function updateField(key: string, value: string) {
    setValues((previous) => {
      const next = { ...previous };
      if (value === "") delete next[key];
      else next[key] = Number(value);
      return next;
    });
  }

  function jumpToResults() {
    resultsRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    resultsRef.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (result) jumpToResults();
  }, [result]);

  const clinician = view === "clinician";
  const showModel = clinician && tab === "model";

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem("cardisoft-theme", dark ? "dark" : "light");
    } catch {
      /* storage unavailable: ignore */
    }
  }, [dark]);

  function setSex(v: number | undefined) {
    setValues((p) => {
      const n = { ...p };
      if (v === undefined) delete n.Sex;
      else n.Sex = v;
      return n;
    });
  }

  function pickGender(g: Gender) {
    setGender(g);
    if (g === "Male") setSex(1);
    else if (g === "Female") setSex(0);
    else setSex(undefined); // others: the person picks the sex used by the model below
  }

  function loadSample() {
    setValues(SAMPLE);
    setGender("Male");
    setName("Sample patient");
  }

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
      setAnalyzedName(name.trim());
      setExplanations({});
      setExplainErrors({});
      setTarget("CAD");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onPdfFile(file: File | undefined) {
    if (!file) return;
    setPdfParsing(true);
    setPdfError("");
    setPdfHits([]);
    setPdfSkipped([]);
    setPdfFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const { text, pages, truncated } = await extractPdfText(buf);
      const parsed = parsePatientFromText(text);
      if (parsed.hits.length === 0) {
        setPdfError(`No recognizable values found in ${pages} page(s). Enter values manually.`);
        setPdfHits([]);
        setPdfSkipped([]);
        return;
      }
      setValues((p) => ({ ...p, ...parsed.values }));
      if (parsed.values.Sex === 0 || parsed.values.Sex === 1) {
        const importedGender = parsed.values.Sex === 1 ? "Male" : "Female";
        setGender((previous) => previous === "Others" ? previous : importedGender);
      }
      setPdfHits(parsed.hits);
      setPdfSkipped([
        ...parsed.skipped.map((s) => ({ key: s.key, reason: s.reason })),
        ...(truncated ? [{ key: "PDF", reason: `only first ${pages} pages scanned` }] : []),
      ]);
    } catch (e) {
      setPdfError((e as Error).message);
      setPdfHits([]);
      setPdfSkipped([]);
    } finally {
      setPdfParsing(false);
    }
  }

  // Fetch the explanation for the selected target (once per target per analysis)
  useEffect(() => {
    if (!result || !analyzed || explanations[target] || explainErrors[target]) return;
    let cancelled = false;
    explain(target, analyzed)
      .then((e) => !cancelled && setExplanations((p) => ({ ...p, [target]: e })))
      .catch((e) => !cancelled && setExplainErrors((p) => ({ ...p, [target]: (e as Error).message })));
    return () => {
      cancelled = true;
    };
  }, [result, analyzed, target, explanations, explainErrors]);

  const predOf = (t: Target): Pred | null =>
    !result ? null : t === "CAD" ? result.cad : result.vessels[t];
  const probabilities = result
    ? {
        LAD: result.vessels.LAD.probability,
        LCX: result.vessels.LCX.probability,
        RCA: result.vessels.RCA.probability,
      }
    : {};
  const classifications = result
    ? {
        LAD: result.vessels.LAD.prediction,
        LCX: result.vessels.LCX.prediction,
        RCA: result.vessels.RCA.prediction,
      }
    : {};

  const expl = explanations[target];
  const chartData = expl
    ? [...expl.features]
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .slice(0, 8)
        .map((f) => ({ ...f, label: f.assumed ? `${f.name} (default)` : f.name }))
    : [];
  const selected = predOf(target);
  const axis = dark ? "#93a7bd" : "#7b8da1";

  return (
    <div className="page">
      <header className="top">
        <Logo />
        <div className="controls">
          <div className="seg" role="group" aria-label="Choose view">
            <button
              className={clinician ? "on" : ""}
              onClick={() => setView("clinician")}
              aria-pressed={clinician}
            >
              Clinician
            </button>
            <button
              className={!clinician ? "on" : ""}
              onClick={() => {
                setView("patient");
                setTab("assessment");
              }}
              aria-pressed={!clinician}
            >
              Patient
            </button>
          </div>
          <button className="theme-toggle" onClick={() => setDark((d) => !d)} aria-label="Toggle dark theme">
            <ThemeIcon dark={dark} />
            {dark ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </header>

      <div className={"data-mode " + (DEMO_MODE ? "demo" : "live")} role="status">
        <b>{DEMO_MODE ? "Demo mode" : "Live model mode"}</b>
        <span>{DEMO_MODE ? "Fixed example predictions and explanations — changing inputs does not change these results." : "Assessments are calculated by the saved models from your submitted measurements."}</span>
      </div>
      <div className="alert">
        <b>🚑 Emergency (India):</b> call <b>112</b> (national emergency) or <b>108</b> (ambulance). Chest pain,
        trouble breathing or fainting: do not wait for this tool.
      </div>

      {clinician && (
        <nav className="tabs" aria-label="Main navigation">
          <button className={"tab" + (tab === "assessment" ? " on" : "")} onClick={() => setTab("assessment")}>
            Assessment
          </button>
          <button className={"tab" + (tab === "model" ? " on" : "")} onClick={() => setTab("model")}>
            Model info
          </button>
        </nav>
      )}

      {showModel ? (
        <ModelInfo />
      ) : (
        <main className="assessment">
          <div className="assessment-heading">
            <div>
              <p className="eyebrow">HEART HEALTH ASSESSMENT</p>
              <h1>A clearer view of heart health</h1>
              <p>Enter patient measurements, then explore the estimates and their contributing factors.</p>
            </div>
            <span className="workspace-badge">Research prototype</span>
          </div>
        <div className="layout">
          {/* ---------- Patient form ---------- */}
          <section className="card rise patient-form" aria-labelledby="patient-heading">
            <div className="form-toolbar">
              <div className="section-heading">
                <span className="step-number">01</span>
                <div><h2 id="patient-heading">Patient details</h2><p className="note">All 54 model inputs are available. Enter what you know; every field is optional.</p></div>
              </div>
              <div className="form-tools">
                {result && <button className="btn soft" onClick={jumpToResults}>View results ↓</button>}
                <button className="btn soft" onClick={loadSample} disabled={pdfParsing}>Load sample patient</button>
              </div>
            </div>

            {clinician && (
          <details className="pdf-box">
            <summary>Import measurements from a lab PDF <span>Optional</span></summary>
            <div className="pdf-content">
            <label className="btn soft pdf-btn" aria-busy={pdfParsing}>
              {pdfParsing ? "Reading PDF..." : "📄 Scan lab PDF"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="pdf-input"
                aria-label="Scan lab PDF"
                disabled={pdfParsing}
                onChange={(e) => {
                  void onPdfFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="note">Text PDFs only. Parsing runs in your browser — no file is uploaded. Verify values against the original before Analyze.</p>
            {pdfFileName && !pdfError && pdfHits.length > 0 && (
              <p className="note pdf-ok">
                {pdfFileName}: filled {pdfHits.length} field{pdfHits.length === 1 ? "" : "s"} — review below, then press Analyze.
              </p>
            )}
            {pdfError && <p className="error">{pdfError}</p>}
            {pdfHits.length > 0 && (
              <ul className="pdf-hits">
                {pdfHits.map((h) => (
                  <li key={h.key}>
                    <b>{h.key}</b> = {h.value}
                    <span className={"conf " + h.confidence}>{h.confidence}</span>
                  </li>
                ))}
              </ul>
            )}
            {pdfSkipped.length > 0 && (
              <p className="note">Skipped: {pdfSkipped.map((s) => `${s.key} (${s.reason})`).join("; ")}</p>
            )}
            </div>
          </details>
            )}

            <div className="form-sections">
            {GROUPS.map((g, groupIndex) => {
              const fields = FIELDS.filter((f) => g.keys.includes(f.key));
              const nums = fields.filter((f) => f.type === "number");
              const choices = fields.filter((f) => f.type !== "number" && f.key !== "Sex");
              return (
                <fieldset className="group form-section" key={g.title}>
                  <legend><span className="group-number">{String(groupIndex + 1).padStart(2, "0")}</span>{g.title}</legend>
                  {g.title === "About the patient" && (
                    <>
                      <label className="field">
                        <span>Patient name (optional)</span>
                        <input
                          type="text"
                          value={name}
                          maxLength={80}
                          placeholder="Full name"
                          onChange={(e) => setName(e.target.value)}
                        />
                      </label>
                      <p className="note">The name stays in this browser and is not sent to the model.</p>
                      <span className="field-label">Gender (optional)</span>
                      <div className="radios">
                        {(["", "Male", "Female", "Others"] as const).map((o) => (
                          <label key={o} className="check">
                            <input
                              type="radio"
                              name="gender"
                              checked={gender === o}
                              onChange={() => pickGender(o)}
                            />
                            <span>{o || "Not provided"}</span>
                          </label>
                        ))}
                      </div>
                      {gender === "Others" && (
                        <>
                          <span className="field-label">Sex recorded for the model</span>
                          <div className="radios">
                            {(
                              [
                                ["Not provided", undefined],
                                ["Male", 1],
                                ["Female", 0],
                              ] as const
                            ).map(([label, v]) => (
                              <label key={label} className="check">
                                <input
                                  type="radio"
                                  name="modelSex"
                                  checked={values.Sex === v}
                                  onChange={() => setSex(v)}
                                />
                                <span>{label}</span>
                              </label>
                            ))}
                          </div>
                          <p className="note">
                            The training data only has male and female records, so those are the available model categories. Leave blank to use the default.
                            Choose what the clinician uses as the reference for these measurements. This is not a
                            statement about identity.
                          </p>
                        </>
                      )}
                    </>
                  )}

                  {nums.length > 0 && (
                    <div className="num-grid">
                      {nums.map((f) => (
                        <label key={f.key} className="field">
                          <span>{f.label}</span>
                          <input
                            type="number"
                            step="any"
                            placeholder="Not provided"
                            data-feature={f.key}
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
                  {choices.length > 0 && (
                    <div className="num-grid">
                      {choices.map((f) => (
                        <label key={f.key} className="field">
                          <span>{f.label}</span>
                          <select data-feature={f.key} value={values[f.key] ?? ""}
                            onChange={(e) => updateField(f.key, e.target.value)}>
                            <option value="">Not provided</option>
                            {(f.options ?? [{ value: 0, label: "No" }, { value: 1, label: "Yes" }]).map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              );
            })}
            </div>

            <div className="form-actions">
              <div className="form-progress">
                <b>{completedFields} of {FIELDS.length} inputs provided</b>
                <progress value={completedFields} max={FIELDS.length} aria-label="Measurement completion" />
                <span>Optional fields can be left blank.</span>
              </div>
              <button className="btn primary" onClick={analyze} disabled={loading || pdfParsing}>
                {loading ? "Analyzing..." : "Analyze patient"}
              </button>
              {error && <p className="error" role="alert">{error}</p>}
            </div>
            <p className="note">
              Blank fields use preset defaults, not measured patient values. Providing more known measurements makes the assessment more specific to the patient.
            </p>
          </section>

          {/* ---------- Results ---------- */}
          <section className="results-panel" ref={resultsRef} tabIndex={-1} aria-labelledby="results-heading" aria-busy={loading}>
            <div className="section-heading">
              <span className="step-number">02</span>
              <div><h2 id="results-heading">Assessment results</h2><p className="note">{result ? "Select an estimate to explore its explanation." : "Your assessment will appear here."}</p></div>
            </div>
            {resultsOutdated && <p className="results-update" role="status">Patient measurements have changed. Select Analyze patient to update these results.</p>}
            {!result ? (
              <div className="card empty rise">
                <div className="empty-icon" aria-hidden="true">
                  <svg viewBox="0 0 48 48" fill="none"><path d="M24 40S6 29 6 16a10 10 0 0 1 18-6 10 10 0 0 1 18 6c0 13-18 24-18 24Z" /><path d="M10 24h8l4-9 5 17 4-8h7" /></svg>
                </div>
                <span className="eyebrow">READY WHEN YOU ARE</span>
                <h3>Every assessment starts with the details</h3>
                <p>Enter the available patient details and select <b>Analyze patient</b> to see the overall estimate, artery view, and contributing factors.</p>
                <div className="empty-preview"><span>Overall estimate</span><span>3D artery view</span><span>Model explanation</span></div>
              </div>
            ) : (
              <>
                {analyzedName && (
                  <p className="who">
                    Results for <b>{analyzedName}</b>
                  </p>
                )}
                <div className="risk-grid">
                  {TARGETS.map((t, i) => {
                    const p = predOf(t)!;
                    const pct = Math.round(p.probability * 100);
                    return (
                      <button
                        type="button"
                        aria-pressed={target === t}
                        key={t + pct + view}
                        className={"card rise risk-card" + (target === t ? " sel" : "")}
                        style={{ animationDelay: `${i * 80}ms` }}
                        onClick={() => setTarget(t)}
                      >
                        <div className="risk-name">{clinician ? TARGET_LABELS[t] : PLAIN_LABEL[t]}</div>
                        <div className="pct">
                          <Percent value={pct} />
                        </div>
                        <div className="meter">
                          <span style={{ width: `${pct}%`, background: riskColor(p.probability) }} />
                        </div>
                        {clinician ? (
                          <span className={"pill " + (p.prediction === 1 ? "pos" : "neg")}>
                            {p.prediction === 1 ? "Positive" : "Negative"}
                          </span>
                        ) : (
                          <span className={"pill " + bandClass(p.probability)}>
                            {band(p.probability)} estimate
                          </span>
                        )}
                        {(t === "LCX" || t === "RCA") && (
                          <p className="note">
                            {clinician
                              ? "Lower validation performance for this vessel"
                              : "The model is less sure about this artery"}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="results-detail-grid">
                <div className="heart-result">
                  <HeartViewer
                    probabilities={probabilities}
                    classifications={classifications}
                    cadProbability={result.cad.probability}
                    cadPrediction={result.cad.prediction}
                    selected={target}
                    onSelect={setTarget}
                    dark={dark}
                  />
                </div>
                <div className="one-col">
                  {explainError && <p className="error" role="alert">Explanation unavailable: {explainError}</p>}
                  {!clinician && selected ? (
                    <PatientSummary target={target} pred={selected} expl={expl} loading={explainLoading} />
                  ) : (
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
                      {expl && (
                        <>
                          <div style={{ height: 300 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 10 }}>
                                <XAxis type="number" stroke={axis} />
                                <YAxis type="category" dataKey="label" width={150} stroke={axis} />
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
                                    <Cell
                                      key={i}
                                      fill={expl.signed === false ? "#8fb8d6" : c.contribution >= 0 ? "#e9657a" : "#6bb6e3"}
                                    />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                          <p className="note">
                            {expl.signed === false
                              ? expl.note ??
                                "These bars show how much the model relies on each input, not whether it raises or lowers the estimate."
                              : `${expl.note ?? "Illustrative demo contributions."} Base probability ${(expl.base_value * 100).toFixed(1)}%. The chart shows the eight largest contributions; the full table includes all collected measurements.`}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>

                </div>

                {analyzed && <CarePlan patient={analyzed} result={result} clinician={clinician} />}

                {clinician && (
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
                            v === undefined ? `Not provided — default: ${expl?.features.find((x) => x.name === f.key)?.value ?? "pending"}` : fieldValueLabel(f.key, v);
                          let label = "n/a";
                          let cls = "";
                          if (c !== undefined && expl?.signed === false) {
                            label = `Importance ${(c * 100).toFixed(0)}%`;
                          } else if (c !== undefined) {
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
                )}
              </>
            )}
          </section>
        </div>
        </main>
      )}

      <p className="quote">💙 {quote}</p>
      <p className="notice">
        <b>Clinical Safety Notice:</b> This system is a machine-learning research and decision-support
        prototype intended for educational and demonstration purposes. Its predictions are not a medical
        diagnosis and must not be used as a substitute for qualified clinical assessment, diagnostic
        imaging, laboratory interpretation, or professional medical advice.
      </p>
    </div>
  );
}