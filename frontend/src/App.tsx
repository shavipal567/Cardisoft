import type { HeartViewerHandle } from "./components/HeartViewer";
import { lazy, Suspense, useEffect, useRef, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  CalendarDays,
  ChevronsDown,
  ChevronsUp,
  ClipboardList,
  Cigarette,
  Droplet,
  Droplets,
  FileUp,
  Gauge,
  Heart,
  HeartPulse,
  Moon,
  PlusCircle,
  Ruler,
  Search,
  Stethoscope,
  Sun,
  Syringe,
  User,
  UserRound,
  UserRoundCheck,
  Users,
  UsersRound,
  Weight,
} from "lucide-react";
import { predict, explain, getInputDefaults, DEMO_MODE } from "./api";
import type { PredictResponse, ExplainResponse, Target, Patient, Pred, InputValues } from "./api";
import { FIELDS, GROUPS, SAMPLE, TARGETS, TARGET_LABELS, riskColor, fieldError, buildPayload } from "./fields";
import { PLAIN_LABEL, band, bandClass } from "./plain";
import Logo from "./components/Logo";
import { FIELD_INFO } from "./fieldInfo";
import FieldStatus from "./components/FieldStatus";
import type { InputSource } from "./components/FieldStatus";
import LoadingStatus from "./components/LoadingStatus";
import FieldInfo from "./components/FieldInfo";
import InputCompleteness from "./components/InputCompleteness";
import InputAccuracy from "./components/InputAccuracy";
import AssessmentTools from "./components/AssessmentTools";
import type { Assessment } from "./assessment";
import ModelInfo from "./components/ModelInfo";
import PatientSummary from "./components/PatientSummary";
import ExplainabilityCard from "./components/ExplainabilityCard";
import CarePlan from "./components/CarePlan";
import ReadAloud from "./components/ReadAloud";
import VoiceInput from "./components/VoiceInput";
import Icon from "./components/Icon";
import type { IconComponent } from "./components/Icon";
import { buildScript } from "./speech/script";
import type { SectionId } from "./speech/script";
import type { Parsed } from "./speech/parse";
import { extractReport, REPORT_ACCEPT } from "./import/report";
import { parsePatientFromText } from "./pdf/fieldMap";
import type { PdfHit } from "./pdf/fieldMap";
import { formatModelProbability } from "./anatomy/stenosis";
import "./App.css";
import "./features.css";
import "./audio.css";
import "./explanation.css";

const HeartViewer = lazy(() => import("./components/HeartViewer"));

type Gender = "" | "Male" | "Female" | "Others";

const QUOTES = [
  "Be gentle with your heart. It works for you every single second.",
  "Small, kind choices today are a gift to your future self.",
  "Rest is part of caring for yourself, too.",
  "Every heartbeat is a quiet new beginning.",
  "Looking after your health is a way of looking after the people who love you.",
  "Progress, not perfection. One steady step at a time.",
];

const GROUP_ICONS: Record<string, IconComponent> = {
  "About the patient": UserRound,
  "Vitals and examination": HeartPulse,
  "Medical history": ClipboardList,
  Symptoms: Stethoscope,
  "ECG findings": HeartPulse,
  "Blood chemistry and lipids": Droplets,
  "Blood count and inflammation": Droplet,
  Echocardiography: HeartPulse,
};

const FIELD_ICONS: Record<string, IconComponent> = {
  PatientName: User,
  Age: CalendarDays,
  Sex: UsersRound,
  Weight,
  Length: Ruler,
  BP: HeartPulse,
  PR: HeartPulse,
  LDL: Droplets,
  HDL: Droplets,
  TG: Droplets,
  FBS: Droplet,
  "Current Smoker": Cigarette,
  "EX-Smoker": Cigarette,
  DM: Syringe,
  FH: Users,
};

function Percent({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min((t - start) / 700, 1);
      setN(value * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{formatModelProbability(n)}</>;
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
  const [reading, setReading] = useState<SectionId | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [reportParsing, setReportParsing] = useState(false);
  const [reportFileName, setReportFileName] = useState("");
  const [reportHits, setReportHits] = useState<PdfHit[]>([]);
  const [reportSkipped, setReportSkipped] = useState<{ key: string; reason: string }[]>([]);
  const [reportError, setReportError] = useState("");
  const [reportProgress, setReportProgress] = useState("");
  const importController = useRef<AbortController | null>(null);

  useEffect(() => () => { importController.current?.abort(); }, []);

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
    setError(""); setResetNotice(""); setReportFileName(""); setReportHits([]); setReportSkipped([]); setReportError("");
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
    importController.current?.abort();
    importController.current = null;
    setValues({}); setSources({}); setName(""); setGender(""); setFieldSearch(""); setOpenGroups([GROUPS[0].title]);
    setResult(null); setAnalyzed(null); setAnalyzedName(""); setAssessment(null); setComparisonBaseline(null);
    setExplanations({}); setExplainErrors({}); setTarget("CAD"); setError(""); setLoading(false);
    setReportParsing(false); setReportFileName(""); setReportHits([]); setReportSkipped([]); setReportError("");
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

  function cancelImport() {
    importController.current?.abort();
    importController.current = null;
    setReportParsing(false);
    setReportFileName("");
    setReportError("");
  }

  async function onReportFile(file: File | undefined) {
    if (!file) return;
    const epoch = taskEpoch.current;
    importController.current?.abort();
    const controller = new AbortController();
    importController.current = controller;
    const isCurrent = () => epoch === taskEpoch.current && importController.current === controller && !controller.signal.aborted;
    setReportParsing(true);
    setReportProgress("Opening report…");
    setReportError("");
    setReportHits([]);
    setReportSkipped([]);
    setReportFileName(file.name);
    try {
      const { text, pages, truncated, kind } = await extractReport(file, {
        signal: controller.signal,
        onProgress: (message) => { if (isCurrent()) setReportProgress(message); },
      });
      const parsed = parsePatientFromText(text);
      if (!isCurrent()) return;
      if (parsed.hits.length === 0) {
        setReportError(kind === "image"
          ? "Text was read, but no supported measurements were recognized. Try a clearer image or enter values manually."
          : `No recognizable values found in ${pages} page(s). Enter values manually.`);
        setReportHits([]);
        setReportSkipped([]);
        return;
      }
      setValues((p) => ({ ...p, ...parsed.values }));
      setSources((previous) => ({ ...previous, ...Object.fromEntries(Object.keys(parsed.values).map((key) => [key, "Imported" as InputSource])) }));
      if (parsed.values.Sex === 0 || parsed.values.Sex === 1) {
        const importedGender = parsed.values.Sex === 1 ? "Male" : "Female";
        setGender((previous) => previous === "Others" ? previous : importedGender);
      }
      setReportHits(parsed.hits);
      setReportSkipped([
        ...parsed.skipped.map((s) => ({ key: s.key, reason: s.reason })),
        ...(truncated ? [{ key: "PDF", reason: "report reached the page or text limit; some content was not read" }] : []),
      ]);
    } catch (e) {
      if (!isCurrent()) return;
      setReportError(e instanceof Error ? e.message : "The report could not be read. Try another file.");
      setReportHits([]);
      setReportSkipped([]);
    } finally {
      if (isCurrent()) {
        importController.current = null;
        setReportParsing(false);
      }
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
  const selected = predOf(target);

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
            <Icon component={dark ? Moon : Sun} size={18} />
            {dark ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </header>

      <div className={"data-mode " + (DEMO_MODE ? "demo" : "live")} role="status">
        <b>{DEMO_MODE ? "Demo mode" : "Live model mode"}</b>
        <span>{DEMO_MODE ? "Fixed example predictions and explanations — changing inputs does not change these results." : "Assessments are calculated by the saved models from your submitted measurements."}</span>
      </div>
      <div className="alert">
        <span className="alert-icon"><Icon component={AlertTriangle} size={18} /></span>
        <span><b>Emergency (India):</b> call <b>112</b> (national emergency) or <b>108</b> (ambulance). Chest pain,
        trouble breathing or fainting: do not wait for this tool.</span>
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
                  <div><h2 id="patient-heading"><Icon component={UserRound} size={20} className="icon-gap" />Patient details</h2><p className="note">All 54 model inputs are available. Enter what you know; every field is optional.</p></div>
                </div>
              <div className="form-tools">
                {result && (
                  <button className="btn soft" onClick={jumpToResults}>
                    <Icon component={ArrowDown} size={16} className="icon-gap-sm" />View results
                  </button>
                )}
                <button className="btn soft" onClick={resetAssessment}>
                  <Icon component={PlusCircle} size={18} className="icon-gap-sm" />Start new assessment
                </button>
                <button className="btn soft" onClick={loadSample} disabled={reportParsing}>
                  <Icon component={UserRoundCheck} size={18} className="icon-gap-sm" />Load sample patient
                </button>
              </div>
            </div>

            <VoiceInput onApply={applyParsed} />

            {clinician && (
          <details className="pdf-box accordion">
            <summary><Icon component={FileUp} size={18} className="icon-gap" />Import measurements from a report <span>PDF or image · Optional</span></summary>
            <div className="pdf-content">
            <label className="btn soft pdf-btn" aria-busy={reportParsing}>
              {reportParsing ? "Reading report…" : "Choose PDF or image"}
              <input
                type="file"
                accept={REPORT_ACCEPT}
                className="pdf-input"
                aria-label="Import PDF or report image"
                disabled={reportParsing}
                onChange={(e) => {
                  void onReportFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {reportParsing && <button className="btn soft" onClick={cancelImport}>Cancel import</button>}
            <p className="note">Choose a text PDF or a PNG, JPEG, WebP or BMP image (up to 15 MB). Use a clear, upright image of printed English text. Files are read in your browser.</p>
            <p className="note">Recognized measurements fill matching fields and may replace existing values. Review them against the original report before Analyze.</p>
            {reportFileName && !reportError && reportHits.length > 0 && (
              <p className="note pdf-ok" role="status">
                {reportFileName}: filled {reportHits.length} field{reportHits.length === 1 ? "" : "s"} — review below, then press Analyze.
              </p>
            )}
            {reportError && <p className="error" role="alert">{reportError}</p>}
            {reportHits.length > 0 && (
              <ul className="pdf-hits">
                {reportHits.map((h) => (
                  <li key={h.key} title={h.snippet}>
                    <b>{h.key}</b> = {h.value}
                    <span className={"conf " + h.confidence}>{h.confidence}</span>
                  </li>
                ))}
              </ul>
            )}
            {reportSkipped.length > 0 && (
              <p className="note">Skipped: {reportSkipped.map((s) => `${s.key} (${s.reason})`).join("; ")}</p>
            )}
            </div>
          </details>
            )}

            {resetNotice && <p className="results-update" role="status">{resetNotice}</p>}
            {reportParsing && <LoadingStatus label={reportProgress} detail="Extracting measurements locally. Review imported values before analyzing." />}
            <div className="field-search-bar">
              <label htmlFor="field-search">Find an input</label>
              <div className="field-search-input">
                <Icon component={Search} size={16} />
                <input id="field-search" type="search" value={fieldSearch} placeholder="Search name or abbreviation, e.g. LDL" onChange={(event) => setFieldSearch(event.target.value)} />
              </div>
              {fieldSearch && <button className="btn soft" onClick={() => setFieldSearch("")}>Clear search</button>}
              <button className="btn soft" disabled={Boolean(query)} onClick={() => setOpenGroups(GROUPS.map((group) => group.title))}>
                <Icon component={ChevronsDown} size={16} className="icon-gap-sm" />Expand all
              </button>
              <button className="btn soft" disabled={Boolean(query)} onClick={() => setOpenGroups([])}>
                <Icon component={ChevronsUp} size={16} className="icon-gap-sm" />Collapse all
              </button>
            </div>
            <p className="note input-source-key">Entered = your input · Imported = from a report · Sample = example data · Default = used when blank</p>
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
                  <summary><span><span className="group-number">{String(groupIndex + 1).padStart(2, "0")}</span><Icon component={GROUP_ICONS[g.title] ?? ClipboardList} size={18} className="icon-gap-sm" />{g.title}</span>
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
                          <div className="field-heading">
                            <label htmlFor={`input-${encodeURIComponent(f.key)}`}>
                              {FIELD_ICONS[f.key] && <Icon component={FIELD_ICONS[f.key]} size={16} className="icon-gap-sm" />}{f.label}
                            </label>
                            <FieldInfo fieldKey={f.key} label={f.label} />
                          </div>
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
                          <div className="field-heading">
                            <label htmlFor={`input-${encodeURIComponent(f.key)}`}>
                              {FIELD_ICONS[f.key] && <Icon component={FIELD_ICONS[f.key]} size={16} className="icon-gap-sm" />}{f.label}
                            </label>
                            <FieldInfo fieldKey={f.key} label={f.label} />
                          </div>
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
              <button className="btn primary" onClick={analyze} disabled={loading || reportParsing}>
                <Icon component={HeartPulse} size={18} className="icon-gap-sm" />
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
              <div><h2 id="results-heading"><Icon component={HeartPulse} size={20} className="icon-gap" />Assessment results</h2><p className="note">{result ? "Select an estimate to explore its explanation." : "Your assessment will appear here."}</p></div>
            </div>
            {loading && <LoadingStatus label="Calculating model estimates…" detail={result ? "Updating the assessment. Previous results remain below until the new estimates are ready." : "Processing the submitted inputs for overall CAD and all three arteries."} />}
            {resultsOutdated && <p className="results-update" role="status">Patient measurements have changed. Select Analyze patient to update these results.</p>}
            {!result ? (loading ? null : (
                <div className="card empty rise">
                  <div className="empty-icon" aria-hidden="true">
                    <Icon component={HeartPulse} size={38} />
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
                    const pct = p.probability * 100;
                    return (
                      <button
                        type="button"
                        aria-pressed={target === t}
                        key={t + pct + view}
                        className={"card rise risk-card" + (t === "CAD" ? " overall-risk" : "") + (target === t ? " sel" : "")}
                        style={{ animationDelay: `${i * 80}ms` }}
                        onClick={() => setTarget(t)}
                      >
                        <div className="risk-name">{t === "CAD" && <Icon component={Gauge} size={16} className="icon-gap-sm" />}{clinician ? TARGET_LABELS[t] : PLAIN_LABEL[t]}</div>
                        <div className="pct">
                          <Percent value={p.probability} />
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

                {assessment && <InputAccuracy assessment={assessment} outdated={Boolean(resultsOutdated)} />}

                <div className="results-detail-grid">
                <div id="heart-anatomy" ref={anatomyRef} tabIndex={-1} className="heart-result">
                  <Suspense fallback={<LoadingStatus label="Loading 3D heart viewer…" detail="Preparing interactive coronary anatomy." />}>
                  <HeartViewer ref={heartViewer}
                    probabilities={probabilities}
                    classifications={classifications}
                    vesselFindings={result.vessel_findings}
                    cadProbability={result.cad.probability}
                    cadPrediction={result.cad.prediction}
                    selected={target}
                    onSelect={setTarget}
                    dark={dark}
                  />
                  </Suspense>
                </div>
                <div className={"one-col" + (reading === "factors" ? " reading" : "")}>
                  {explainError && <p className="error" role="alert">Explanation unavailable: {explainError}</p>}
                  {!clinician && selected ? (
                    <PatientSummary target={target} pred={selected} expl={expl} loading={explainLoading} />
                  ) : (
                    selected && <ExplainabilityCard key={`${assessment?.id}-${target}`}
                      target={target} prediction={selected} explanation={expl} context={result.context}
                      loading={explainLoading} error={explainError} demo={DEMO_MODE}
                      onRetry={() => {
                        setExplanations(previous => { const next = { ...previous }; delete next[target]; return next; });
                        setExplainErrors(previous => { const next = { ...previous }; delete next[target]; return next; });
                      }} />
                  )}
                </div>

                </div>

                {assessment && <AssessmentTools key={assessment.id} captureHeart={() => {
                  if (!heartViewer.current) throw new Error("The 3D heart is not available. Please wait for the viewer to load.");
                  return heartViewer.current.capturePng();
                }} current={assessment} explanations={explanations} outdated={Boolean(resultsOutdated)} baseline={comparisonBaseline} setBaseline={setComparisonBaseline} />}

                {analyzed && <CarePlan patient={analyzed} result={result} clinician={clinician} />}


              </>
            )}
          </section>
        </div>
        </main>
      )}

      <p className="quote"><Icon component={Heart} size={16} className="icon-gap-sm" /> {quote}</p>
      <p className="notice">
        <b>Clinical Safety Notice:</b> This system is a machine-learning research and decision-support
        prototype intended for educational and demonstration purposes. Its predictions are not a medical
        diagnosis and must not be used as a substitute for qualified clinical assessment, diagnostic
        imaging, laboratory interpretation, or professional medical advice.
      </p>
    </div>
  );
}
