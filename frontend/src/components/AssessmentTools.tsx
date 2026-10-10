import { useEffect, useRef, useState } from "react";
import { explain } from "../api";
import type { Target } from "../api";
import { changedInputs, completeness, displayInput, predictionOf, probabilityChange } from "../assessment";
import type { Assessment, Explanations } from "../assessment";
import { TARGETS, TARGET_LABELS } from "../fields";
import LoadingStatus from "./LoadingStatus";
import InputCompleteness from "./InputCompleteness";

export default function AssessmentTools({ current, explanations, outdated, baseline, setBaseline, captureHeart }: {
  captureHeart: () => HTMLCanvasElement;
  current: Assessment; explanations: Explanations; outdated: boolean;
  baseline: Assessment | null; setBaseline: (snapshot: Assessment | null) => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportStage, setExportStage] = useState("");
  const exportRun = useRef(0);
  useEffect(() => () => { exportRun.current += 1; }, []);
  const comparing = baseline && baseline.id !== current.id;
  const changed = comparing ? changedInputs(baseline, current) : [];

  async function exportReport() {
    // Capture exactly the assessment visible when the user clicks, even if another finishes.
    const run = ++exportRun.current;
    const snapshot = structuredClone(current);
    const comparison = comparing ? structuredClone(baseline) : null;
    const collected: Explanations = { ...explanations };
    const errors: Partial<Record<Target, string>> = {};
    setExporting(true); setExportError(""); setExportStage("Capturing the 3D heart view…");
    try {
      // Capture before any network waits so the image and assessment stay together.
      const heartImage = captureHeart();
      const pending = TARGETS.filter((target) => !collected[target]);
      setExportStage(pending.length ? `Preparing explanations for ${pending.join(", ")}…` : "Building the assessment PDF…");
      const results = await Promise.allSettled(pending.map((target) => explain(target, snapshot.inputs)));
      if (run !== exportRun.current) return;
      results.forEach((result, i) => {
        if (result.status === "fulfilled") collected[pending[i]] = result.value;
        else errors[pending[i]] = "Explanation service unavailable at export time.";
      });
      for (const target of TARGETS) {
        const expected = snapshot.result.context?.models[target]?.version;
        if (expected && collected[target] && collected[target]?.model_version !== expected) {
          delete collected[target];
          errors[target] = "Explanation omitted: its model version could not be matched to this assessment.";
        }
      }
      setExportStage("Building the PDF with inputs, estimates and heart image…");
      const { createAssessmentPdf } = await import("../pdf/report");
      const report = await createAssessmentPdf(snapshot, collected, errors, comparison, heartImage);
      if (run !== exportRun.current) return;
      report.save(`cardisoft-assessment-${snapshot.createdAt.replace(/[:.]/g, "-")}.pdf`);
    } catch (error) {
      if (run === exportRun.current) setExportError(`Report export failed: ${error instanceof Error ? error.message : "Please try again."}`);
    } finally { if (run === exportRun.current) { setExporting(false); setExportStage(""); } }
  }

  return <section className="card assessment-tools" aria-label="Assessment summary and tools">
    <div className="assessment-tools-heading"><div><h3>Assessment snapshot</h3>
      <p className="note">{current.name || "Unnamed patient"} · {new Date(current.createdAt).toLocaleString()}</p></div>
      <div className="assessment-tool-buttons">
        <button className="btn soft" onClick={() => setBaseline(structuredClone(current))} disabled={baseline?.id === current.id}>
          {baseline ? "Replace comparison baseline" : "Use as comparison baseline"}</button>
        <button className="btn primary" onClick={() => void exportReport()} disabled={exporting}>
          {exporting ? "Preparing report…" : "Download PDF report"}</button>
      </div>
    </div>
    {outdated && <p className="note">Exports and comparisons use the last completed assessment, not your unsubmitted form edits.</p>}
    {current.demo && <p className="note">Demo: predictions are fixed examples and are not calculated from these inputs.</p>}
    {exporting && <LoadingStatus label={exportStage} detail="Keep this assessment open while the report is prepared." />}
    {exportError && <p className="error" role="alert">{exportError}</p>}
    <InputCompleteness inputs={current.inputs} effective={current.demo ? undefined : current.result.context?.effective_inputs} submitted />
    {baseline && <div className="assessment-comparison">
      <div className="comparison-heading"><h3>Assessment comparison</h3><button className="btn soft" onClick={() => setBaseline(null)}>Clear comparison</button></div>
      {!comparing ? <p className="note">Baseline saved for this session. Edit the patient details and analyze again to compare. Reloading the page clears the comparison.</p> : <>
        <p className="note">Changes are current minus baseline, in percentage points (pp). This is a comparison of model outputs, not evidence that an input change causes a health outcome.</p>
        {baseline.name !== current.name && <p className="note">These snapshots have different patient names. Check that this is the comparison you intended.</p>}
        <div className="comparison-table-wrap"><table>
          <thead><tr><th>Estimate</th><th>Baseline<br /><small>{baseline.name || "Unnamed"} · {new Date(baseline.createdAt).toLocaleString()}</small></th>
            <th>Current<br /><small>{current.name || "Unnamed"} · {new Date(current.createdAt).toLocaleString()}</small></th><th>Change</th></tr></thead>
          <tbody>{TARGETS.map((target) => {
            const before = predictionOf(baseline, target), after = predictionOf(current, target);
            return <tr key={target}><th>{TARGET_LABELS[target]}</th>
              <td>{(before.probability * 100).toFixed(1)}% · {before.prediction ? "Positive" : "Negative"}</td>
              <td>{(after.probability * 100).toFixed(1)}% · {after.prediction ? "Positive" : "Negative"}</td>
              <td>{probabilityChange(before.probability, after.probability)}</td></tr>;
          })}</tbody>
        </table></div>
        <p className="note">Inputs supplied: {completeness(baseline.inputs).supplied.length} baseline → {completeness(current.inputs).supplied.length} current.</p>
        <details open><summary>Changed inputs ({changed.length})</summary>
          {changed.length === 0 ? <p className="note">No supplied values, defaults, or input sources changed.</p> :
            <div className="comparison-table-wrap"><table><thead><tr><th>Input</th><th>Baseline</th><th>Current</th></tr></thead>
              <tbody>{changed.map((field) => <tr key={field.key}><th>{field.label}</th>
                {[baseline, current].map((snapshot) => <td key={snapshot.id}>
                  {displayInput(field.key, snapshot.inputs, snapshot.result.context?.effective_inputs)}
                  <small className="input-source">{snapshot.inputs[field.key] === undefined ? "Defaulted" : "Supplied"}</small>
                </td>)}</tr>)}</tbody></table></div>}
        </details>
      </>}
    </div>}
  </section>;
}
