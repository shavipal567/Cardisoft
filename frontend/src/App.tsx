import type { HeartViewerHandle } from "./components/HeartViewer";
import { useEffect, useRef, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer, ReferenceLine } from "recharts";
import { predict, explain, getInputDefaults, DEMO_MODE } from "./api";
import type { PredictResponse, ExplainResponse, Target, Patient, Pred, InputValues } from "./api";
import { FIELDS, GROUPS, SAMPLE, TARGETS, TARGET_LABELS, riskColor, fieldError, buildPayload, fieldValueLabel } from "./fields";
import { PLAIN_LABEL, band, bandClass } from "./plain";
import Logo from "./components/Logo";
import { FIELD_INFO } from "./fieldInfo";
import FieldStatus from "./components/FieldStatus";
import type { InputSource } from "./components/FieldStatus";
import LoadingStatus from "./components/LoadingStatus";
import FieldInfo from "./components/FieldInfo";
import InputCompleteness from "./components/InputCompleteness";
import AssessmentTools from "./components/AssessmentTools";
import type { Assessment } from "./assessment";
import ModelInfo from "./components/ModelInfo";
import PatientSummary from "./components/PatientSummary";
import CarePlan from "./components/CarePlan";
import ReadAloud from "./components/ReadAloud";
import VoiceInput from "./components/VoiceInput";
import { buildScript } from "./speech/script";
import type { SectionId } from "./speech/script";
import type { Parsed } from "./speech/parse";
import { extractPdfText } from "./pdf/extractText";
import { parsePatientFromText } from "./pdf/fieldMap";
import type { PdfHit } from "./pdf/fieldMap";
import HeartViewer from "./components/HeartViewer";
import "./App.css";
import "./features.css";
import "./audio.css";

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
  const [fieldSearch, setFieldSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<string[]>([GROUPS[0].title]);
  const [sources, setSources] = useState<Record<string, InputSource>>({});
  const [resetNotice, setResetNotice] = useState("");
  const taskEpoch = useRef(0);
  const inputRef = useRef<HTMLElement>(null);
  const anatomyRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const heartViewer = useRef<HeartViewerHandle>(null);
  const [comparisonBaseline, setComparisonBaseline] = useState<Assessment | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [inputDefaults, setInputDefaults] = useState<InputValues>();
  const [defaultsError, setDefaultsError] = useState("");
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
  const [reading, setReading] = useState<SectionId | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    let cancelled = false;
    getInputDefaults().then((defaults) => { if (!cancelled) setInputDefaults(defaults); })
      .catch((error) => { if (!cancelled) setDefaultsError(String(error)); });
    return () => { cancelled = true; };
  }, []);

  const resultsRef = useRef<HTMLElement>(null);
  const completedFields = Object.keys(buildPayload(values)).length;
  const resultsOutdated = analyzed && FIELDS.some((field) => values[field.key] !== analyzed[field.key]);

  const query = fieldSearch.trim().toLowerCase();
  const matchesField = (key: string, label: string) => !query || `${key} ${label} ${FIELD_INFO[key]?.query ?? ""}`.toLowerCase().includes(query);
  const matchingCount = FIELDS.filter((field) => matchesField(field.key, field.label)).length;
  const errors = Object.fromEntries(FIELDS.map((field) => [field.key, fieldError(field, values[field.key])]));

  function markEntered(key: string) {
    setError(""); setResetNotice("");
    setSources((previous) => ({ ...previous, [key]: "Entered" }));
  }
  function updateField(key: string, value: string, badInput = false) {
    markEntered(key);
    setValues((previous) => {
      const next = { ...previous };
      if (badInput) next[key] = NaN;
      else if (value === "") delete next[key];
      else next[key] = Number(value);
      return next;
    });
  }

  function jumpTo(element: HTMLElement | null) {
    element?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    element?.focus({ preventScroll: true });
  }
  function jumpToResults() { jumpTo(resultsRef.current); }

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
    markEntered("Sex");
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
    setSources(Object.fromEntries(Object.keys(SAMPLE).map((key) => [key, "Sample"])));
    setError(""); setResetNotice(""); setPdfFileName(""); setPdfHits([]); setPdfSkipped([]); setPdfError("");
    setValues(SAMPLE);
    setGender("Male");
    setName("Sample patient");
  }

  function applyParsed(p: Parsed) {
    const parsedValues = { ...p.numbers, ...p.toggles };
    setValues((previous) => ({ ...previous, ...parsedValues }));
    setSources((previous) => ({
      ...previous,
      ...Object.fromEntries(Object.keys(parsedValues).map((key) => [key, "Entered" as InputSource])),
    }));
    setError("");
    if (p.gender) pickGender(p.gender);
    setAnnouncement(`Applied ${p.count} values from voice input. Please review the form, then press Analyze patient.`);
  }

  function resetAssessment() {
    taskEpoch.current += 1;
    setValues({}); setSources({}); setName(""); setGender(""); setFieldSearch(""); setOpenGroups([GROUPS[0].title]);
    setResult(null); setAnalyzed(null); setAnalyzedName(""); setAssessment(null); setComparisonBaseline(null);
    setExplanations({}); setExplainErrors({}); setTarget("CAD"); setError(""); setLoading(false);
    setPdfParsing(false); setPdfFileName(""); setPdfHits([]); setPdfSkipped([]); setPdfError("");
    setResetNotice("New assessment started. Patient details, imports, results and comparison have been cleared.");
    setReading(null); setAnnouncement("New assessment started.");
    requestAnimationFrame(() => { jumpTo(inputRef.current); document.getElementById("patient-name")?.focus({ preventScroll: true }); });
  }

  async function analyze() {
    const bad = FIELDS.filter((field) => fieldError(field, values[field.key]));
    if (bad.length) {
      setError(`Check ${bad.length} highlighted field${bad.length === 1 ? "" : "s"} before analyzing.`);
      setFieldSearch("");
      setOpenGroups((previous) => [...new Set([...previous, ...GROUPS.filter((group) => group.keys.some((key) => bad.some((field) => field.key === key))).map((group) => group.title)])]);
      requestAnimationFrame(() => {
        const input = document.getElementById(`input-${encodeURIComponent(bad[0].key)}`);
        jumpTo(input);
      });
      return;
    }
    const epoch = taskEpoch.current;
    setResetNotice("");
    const payload = buildPayload(values);
    const submittedName = name.trim();
    setLoading(true);
    setError("");
    try {
      const r = await predict(payload);
      if (epoch !== taskEpoch.current) return;
      setResult(r);
      setAnalyzed(payload);
      setAnalyzedName(submittedName);
      setAssessment({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), name: submittedName,
        inputs: { ...payload }, result: r, demo: DEMO_MODE });
      setExplanations({});
      setExplainErrors({});
      setTarget("CAD");
      setAnnouncement(`Analysis complete${submittedName ? " for " + submittedName : ""}. Overall CAD estimate ${Math.round(r.cad.probability * 100)} percent. Use the Listen button to hear the report.`);
    } catch (e) {
      if (epoch === taskEpoch.current) setError((e as Error).message);
    } finally {
      if (epoch === taskEpoch.current) setLoading(false);
    }
  }

  async function onPdfFile(file: File | undefined) {
    if (!file) return;
    const epoch = taskEpoch.current;
    setPdfParsing(true);
    setPdfError("");
    setPdfHits([]);
    setPdfSkipped([]);
    setPdfFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const { text, pages, truncated } = await extractPdfText(buf);
      const parsed = parsePatientFromText(text);
      if (epoch !== taskEpoch.current) return;
      if (parsed.hits.length === 0) {
        setPdfError(`No recognizable values found in ${pages} page(s). Enter values manually.`);
        setPdfHits([]);
        setPdfSkipped([]);
        return;
      }
      setValues((p) => ({ ...p, ...parsed.values }));
      setSources((previous) => ({ ...previous, ...Object.fromEntries(Object.keys(parsed.values).map((key) => [key, "Imported" as InputSource])) }));
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
      if (epoch !== taskEpoch.current) return;
      setPdfError((e as Error).message);
      setPdfHits([]);
      setPdfSkipped([]);
    } finally {
      if (epoch === taskEpoch.current) setPdfParsing(false);
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

  const segments = useMemo(
    () => result && analyzed
      ? buildScript({ clinician, name: analyzedName, result, patient: analyzed, cadExpl: explanations["CAD"] })
      : [],
    [clinician, analyzedName, result, analyzed, explanations],
  );
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
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
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
          <nav className="mobile-section-nav" aria-label="Assessment sections">
            <button onClick={() => jumpTo(inputRef.current)}>Inputs</button>
            <button onClick={jumpToResults} disabled={!result && !loading}>Results</button>
            <button onClick={() => jumpTo(anatomyRef.current)} disabled={!result}>Anatomy</button>
          </nav>
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
          <section id="assessment-inputs" ref={inputRef} tabIndex={-1} className="card rise patient-form" aria-labelledby="patient-heading">
            <div className="form-toolbar">
              <div className="section-heading">
                <span className="step-number">01</span>
                <div><h2 id="patient-heading">Patient details</h2><p className="note">All 54 model inputs are available. Enter what you know; every field is optional.</p></div>
              </div>
              <div className="form-tools">
                {result && <button className="btn soft" onClick={jumpToResults}>View results ↓</button>}
                <button className="btn soft" onClick={resetAssessment}>Start new assessment</button>
                <button className="btn soft" onClick={loadSample} disabled={pdfParsing}>Load sample patient</button>
              </div>
            </div>

            <VoiceInput onApply={applyParsed} />

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

            {resetNotice && <p className="results-update" role="status">{resetNotice}</p>}
            {pdfParsing && <LoadingStatus label="Reading lab PDF…" detail="Extracting measurements locally. You can review the imported values before analyzing." />}
            <div className="field-search-bar">
              <label htmlFor="field-search">Find an input</label>
              <input id="field-search" type="search" value={fieldSearch} placeholder="Search name or abbreviation, e.g. LDL" onChange={(event) => setFieldSearch(event.target.value)} />
              {fieldSearch && <button className="btn soft" onClick={() => setFieldSearch("")}>Clear search</button>}
              <button className="btn soft" disabled={Boolean(query)} onClick={() => setOpenGroups(GROUPS.map((group) => group.title))}>Expand all</button>
              <button className="btn soft" disabled={Boolean(query)} onClick={() => setOpenGroups([])}>Collapse all</button>
            </div>
            <p className="note input-source-key">Entered = your input · Imported = from a PDF · Sample = example data · Default = used when blank</p>
            {query && <p className="note" role="status">{matchingCount} model inputs match “{fieldSearch}”.</p>}
            <div className="form-sections">
            {GROUPS.map((g, groupIndex) => {
              const fields = FIELDS.filter((f) => g.keys.includes(f.key) && matchesField(f.key, f.label));
              const identityMatch = g.title === "About the patient" && (matchesField("PatientName", "Patient name") || matchesField("Gender", "Gender"));
              if (!fields.length && !identityMatch) return null;
              const groupErrors = g.keys.filter((key) => errors[key]).length;
              const nums = fields.filter((f) => f.type === "number");
              const choices = fields.filter((f) => f.type !== "number" && f.key !== "Sex");
              return (
                <details className="form-section" key={g.title} open={Boolean(query) || openGroups.includes(g.title)} onToggle={(event) => {
                  if (query) return;
                  const isOpen = event.currentTarget.open;
                  setOpenGroups((previous) => isOpen ? previous.includes(g.title) ? previous : [...previous, g.title] : previous.filter((title) => title !== g.title));
                }}>
                  <summary><span><span className="group-number">{String(groupIndex + 1).padStart(2, "0")}</span>{g.title}</span>
                    <span className="group-completion">{g.keys.filter((key) => values[key] !== undefined).length}/{g.keys.length} supplied{groupErrors > 0 && <b> · {groupErrors} to fix</b>}</span>
                  </summary>
                  <fieldset className="group form-section-content" aria-label={g.title}>
                  {g.title === "About the patient" && (!query || identityMatch || fields.some((field) => field.key === "Sex")) && (
                    <>
                      <div className="field">
                        <div className="field-heading"><label htmlFor="patient-name">Patient name (optional)</label><FieldInfo fieldKey="PatientName" label="Patient name" /></div>
                        <input
                          id="patient-name"
                          type="text"
                          value={name}
                          maxLength={80}
                          placeholder="Full name"
                          onChange={(e) => setName(e.target.value)}
                        />
                      </div>
                      <p className="note">The name stays in this browser and is not sent to the model.</p>
                      <div className="field-heading"><span className="field-label">Gender (optional)</span><FieldInfo fieldKey="Gender" label="Gender and model sex" /></div>
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
                          <div className="field-heading"><span className="field-label">Sex recorded for the model</span><FieldInfo fieldKey="Sex" label="Sex recorded for the model" /></div>
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
                      <FieldStatus fieldKey="Sex" values={values} source={sources.Sex} defaults={inputDefaults} error={errors.Sex} />
                    </>
                  )}

                  {nums.length > 0 && (
                    <div className="num-grid">
                      {nums.map((f) => (
                        <div key={f.key} className="field" data-source={values[f.key] === undefined ? "default" : (sources[f.key] ?? "Entered").toLowerCase()}>
                          <div className="field-heading"><label htmlFor={`input-${encodeURIComponent(f.key)}`}>{f.label}</label><FieldInfo fieldKey={f.key} label={f.label} /></div>
                          <input
                            type="number"
                            step="any"
                            placeholder="Not provided"
                            id={`input-${encodeURIComponent(f.key)}`}
                            data-feature={f.key}
                            value={Number.isNaN(values[f.key]) ? "" : values[f.key] ?? ""}
                            aria-invalid={Boolean(errors[f.key])}
                            aria-describedby={`input-${encodeURIComponent(f.key)}-source${errors[f.key] ? ` input-${encodeURIComponent(f.key)}-error` : ""}`}
                            min={f.min}
                            max={f.max}
                            onChange={(e) => updateField(f.key, e.target.value, e.target.validity.badInput)}
                          />
                          <FieldStatus fieldKey={f.key} values={values} source={sources[f.key]} defaults={inputDefaults} error={errors[f.key]} />
                        </div>
                      ))}
                    </div>
                  )}
                  {choices.length > 0 && (
                    <div className="num-grid">
                      {choices.map((f) => (
                        <div key={f.key} className="field" data-source={values[f.key] === undefined ? "default" : (sources[f.key] ?? "Entered").toLowerCase()}>
                          <div className="field-heading"><label htmlFor={`input-${encodeURIComponent(f.key)}`}>{f.label}</label><FieldInfo fieldKey={f.key} label={f.label} /></div>
                          <select id={`input-${encodeURIComponent(f.key)}`} data-feature={f.key} value={values[f.key] ?? ""}
                            aria-invalid={Boolean(errors[f.key])} aria-describedby={`input-${encodeURIComponent(f.key)}-source${errors[f.key] ? ` input-${encodeURIComponent(f.key)}-error` : ""}`}
                            onChange={(e) => updateField(f.key, e.target.value)}>
                            <option value="">Not provided</option>
                            {(f.options ?? [{ value: 0, label: "No" }, { value: 1, label: "Yes" }]).map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                          <FieldStatus fieldKey={f.key} values={values} source={sources[f.key]} defaults={inputDefaults} error={errors[f.key]} />
                        </div>
                      ))}
                    </div>
                  )}
                  </fieldset>
                </details>
              );
            })}
            </div>

            <InputCompleteness inputs={values} effective={inputDefaults} defaultsError={defaultsError} />
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
          <section id="assessment-results" className="results-panel" ref={resultsRef} tabIndex={-1} aria-labelledby="results-heading" aria-busy={loading}>
            <div className="section-heading">
              <span className="step-number">02</span>
              <div><h2 id="results-heading">Assessment results</h2><p className="note">{result ? "Select an estimate to explore its explanation." : "Your assessment will appear here."}</p></div>
            </div>
            {loading && <LoadingStatus label="Calculating model estimates…" detail={result ? "Updating the assessment. Previous results remain below until the new estimates are ready." : "Processing the submitted inputs for overall CAD and all three arteries."} />}
            {resultsOutdated && <p className="results-update" role="status">Patient measurements have changed. Select Analyze patient to update these results.</p>}
            {!result ? (loading ? null : (
              <div className="card empty rise">
                <div className="empty-icon" aria-hidden="true">
                  <svg viewBox="0 0 48 48" fill="none"><path d="M24 40S6 29 6 16a10 10 0 0 1 18-6 10 10 0 0 1 18 6c0 13-18 24-18 24Z" /><path d="M10 24h8l4-9 5 17 4-8h7" /></svg>
                </div>
                <span className="eyebrow">READY WHEN YOU ARE</span>
                <h3>Every assessment starts with the details</h3>
                <p>Enter the available patient details and select <b>Analyze patient</b> to see the overall estimate, artery view, and contributing factors.</p>
                <div className="empty-preview"><span>Overall estimate</span><span>3D artery view</span><span>Model explanation</span></div>
              </div>
            )) : (
              <>
                {analyzedName && (
                  <p className="who">
                    Results for <b>{analyzedName}</b>
                  </p>
                )}
                <ReadAloud segments={segments} onSection={setReading} />

                <div className={"risk-grid" + (reading === "summary" || reading === "vessels" ? " reading" : "")}>
                  {TARGETS.map((t, i) => {
                    const p = predOf(t)!;
                    const pct = Math.round(p.probability * 100);
                    return (
                      <button
                        type="button"
                        aria-pressed={target === t}
                        key={t + pct + view}
                        className={"card rise risk-card" + (t === "CAD" ? " overall-risk" : "") + (target === t ? " sel" : "")}
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
                <div id="heart-anatomy" ref={anatomyRef} tabIndex={-1} className="heart-result">
                  <HeartViewer ref={heartViewer}
                    probabilities={probabilities}
                    classifications={classifications}
                    cadProbability={result.cad.probability}
                    cadPrediction={result.cad.prediction}
                    selected={target}
                    onSelect={setTarget}
                    dark={dark}
                  />
                </div>
                <div className={"one-col" + (reading === "factors" ? " reading" : "")}>
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
                      {explainLoading && <LoadingStatus label={`Explaining ${TARGET_LABELS[target]}…`} detail="Calculating which inputs contributed to this estimate." />}
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

                {assessment && <AssessmentTools key={assessment.id} captureHeart={() => {
                  if (!heartViewer.current) throw new Error("The 3D heart is not available. Please wait for the viewer to load.");
                  return heartViewer.current.capturePng();
                }} current={assessment} explanations={explanations} outdated={Boolean(resultsOutdated)} baseline={comparisonBaseline} setBaseline={setComparisonBaseline} />}

                {analyzed && <CarePlan patient={analyzed} result={result} clinician={clinician} />}

                {clinician && (
                  <details className="card">
                    <summary>Patient values and how the model used them ({target})</summary>
                    <table>
                      <thead>
                        <tr>
                          <th>Measurement</th>
                          <th>Value used</th>
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
                              <td>
  {shown}
  {expl?.features.some(
    (x) => x.name === f.key && x.assumed
  ) && (
    <span title="This feature was supplied automatically rather than collected through the form">
      {" "}(auto-supplied)
    </span>
  )}
</td>
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