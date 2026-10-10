import { jsPDF } from "jspdf";
import type { Target } from "../api";
import type { Assessment, Explanations } from "../assessment";
import { changedInputs, completeness, displayInput, predictionOf, probabilityChange } from "../assessment";
import { FIELDS, TARGETS } from "../fields";

const withoutControls = (value: string) => Array.from(value, (char) =>
  char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char).join("");

const clean = (value: unknown) => withoutControls(String(value ?? "Unavailable")).replace(/[–—]/g, "-")
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/→/g, "->")
  .replace(/µ/g, "u").replace(/³/g, "^3");

export async function createAssessmentPdf(current: Assessment, explanations: Explanations,
  explanationErrors: Partial<Record<Target, string>>, baseline: Assessment | null = null, heartImage?: HTMLCanvasElement) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: "Cardisoft assessment report", author: "Cardisoft", subject: "Research model assessment" });
  const left = 16, width = 178, bottom = 278;
  let y = 20;
  const newPage = () => { doc.addPage(); y = 20; };
  const ensure = (height: number) => { if (y + height > bottom) newPage(); };
  function paragraph(value: string, size = 10) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(size); doc.setTextColor(39, 56, 73);
    const lines: string[] = doc.splitTextToSize(clean(value), width);
    for (const line of lines) { ensure(5); doc.text(line, left, y); y += 5; }
    y += 3;
  }
  function heading(value: string) {
    ensure(22); y += 5;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(29, 79, 107);
    doc.text(value, left, y); y += 8;
  }
  function table(headers: string[], rows: string[][], widths: number[]) {
    function row(cells: string[], header: boolean, index: number) {
      doc.setFont("helvetica", header ? "bold" : "normal"); doc.setFontSize(9);
      const wrapped: string[][] = cells.map((cell, i) => doc.splitTextToSize(clean(cell), widths[i] - 4));
      const height = Math.max(...wrapped.map((lines) => lines.length)) * 4.5 + 5;
      if (y + height > bottom) { newPage(); if (!header) row(headers, true, 0); }
      doc.setFillColor(...(header ? [228, 237, 243] : index % 2 ? [246, 249, 251] : [255, 255, 255]) as [number, number, number]);
      doc.rect(left, y, width, height, "F"); doc.setTextColor(39, 56, 73);
      let x = left;
      wrapped.forEach((lines, i) => { doc.text(lines, x + 2, y + 4.5, { lineHeightFactor: 1.4 }); x += widths[i]; });
      y += height;
    }
    ensure(20); row(headers, true, 0); rows.forEach((cells, i) => row(cells, false, i)); y += 5;
  }
  function patientName(name: string) {
    const text = `Patient: ${name || "Unnamed patient"}`;
    if (/^[\x20-\x7e]*$/.test(text)) { paragraph(text); return; }
    // Browser fonts preserve non-Latin names instead of silently substituting glyphs
    // unsupported by the PDF's built-in Helvetica font. No HTML is interpreted.
    const canvas = document.createElement("canvas"); canvas.width = 1400; canvas.height = 80;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot render the patient name.");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#273849"; context.font = "32px sans-serif"; context.textBaseline = "middle";
    context.fillText(withoutControls(text), 0, 40, 1380);
    ensure(13); doc.addImage(canvas.toDataURL("image/png"), "PNG", left, y - 4, width, 10.2); y += 12;
  }

  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(29, 79, 107);
  doc.text("Cardisoft", left, y); y += 9;
  paragraph("ASSESSMENT REPORT", 12);
  paragraph(current.demo ? "DEMO - Fixed example outputs; not calculated from the supplied inputs." : "LIVE MODEL - Snapshot of a completed assessment.");
  patientName(current.name);
  paragraph(`Assessed: ${new Date(current.createdAt).toISOString()} | Report generated: ${new Date().toISOString()}`, 9);
  paragraph(`Assessment ID: ${current.id}`, 9);
  paragraph("Research and educational prototype. Uncalibrated model estimates are not a diagnosis, a treatment recommendation or lesion localization. Input coverage is not prediction confidence.", 9);

  heading("Prediction summary");
  table(["Target", "Estimated probability", "Model classification"], TARGETS.map((target) => {
    const p = predictionOf(current, target);
    return [target, `${(p.probability * 100).toFixed(1)}%`, p.prediction ? "Positive" : "Negative"];
  }), [32, 73, 73]);

  if (heartImage) {
    newPage();
    heading("3D heart view");
    paragraph("View captured when this report was requested. Percentages show model-estimated stenosis probability, not the percentage of artery narrowing. Anatomy and vessel routes are illustrative.", 9);
    const scale = Math.min(width / heartImage.width, (bottom - y - 8) / heartImage.height);
    const imageWidth = heartImage.width * scale, imageHeight = heartImage.height * scale;
    doc.addImage(heartImage.toDataURL("image/png"), "PNG", left + (width - imageWidth) / 2, y, imageWidth, imageHeight);
    newPage();
  }

  const { supplied, missing, percent } = completeness(current.inputs);
  heading("Input completeness");
  paragraph(`${supplied.length} of ${FIELDS.length} inputs supplied (${percent}%); ${missing.length} defaulted.`);
  if (current.demo) paragraph("Demo inputs are recorded for review only; no patient-specific inference was performed.");
  else if (!current.result.context) paragraph("The server did not return effective inputs or model versions. Default values and artifact identity are unavailable for this snapshot.");
  table(["Input", "Value used", "Source"], FIELDS.map((field) => [field.label,
    displayInput(field.key, current.inputs, current.demo ? undefined : current.result.context?.effective_inputs),
    current.inputs[field.key] === undefined ? "Preset default" : "Supplied",
  ]), [85, 58, 35]);

  heading("Model identity");
  if (current.demo) paragraph("Demo fixtures. No fitted model was invoked for these predictions.");
  else if (current.result.context) {
    paragraph("Artifact version is SHA-256 of the loaded preprocessor and model bytes. Training revision identifies the recorded training code revision.", 9);
    table(["Target / model", "Artifact version / training revision"], TARGETS.map((target) => {
      const model = current.result.context!.models[target];
      return [`${target}: ${model.name}`, `${model.version}\nTraining: ${model.training_revision}`];
    }), [58, 120]);
  } else paragraph("Model identity unavailable from this server response.");

  heading("What influenced the estimates");
  paragraph("Top contributions for each target are shown below. Positive contributions raise the model estimate; negative contributions lower it relative to the explanation baseline. These are model associations, not causal effects. Values marked defaulted are not measured patient inputs.", 9);
  for (const target of TARGETS) {
    heading(`${target} explanation`);
    const explanation = explanations[target];
    if (!explanation) { paragraph(explanationErrors[target] ?? "Explanation unavailable."); continue; }
    paragraph(`${current.demo ? "Illustrative demo" : explanation.method ?? "Method unavailable"}; baseline probability ${(explanation.base_value * 100).toFixed(1)}%.`, 9);
    if (explanation.note) paragraph(explanation.note, 8);
    const features = [...explanation.features].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 10);
    table(["Input", "Recorded value", explanation.signed === false ? "Importance" : "Contribution"], features.map((feature) => [
      FIELDS.find((field) => field.key === feature.name)?.label ?? feature.name,
      `${feature.value}${feature.assumed ? " (default)" : ""}`,
      explanation.signed === false ? `${(feature.contribution * 100).toFixed(2)}%`
        : `${feature.contribution >= 0 ? "+" : ""}${(feature.contribution * 100).toFixed(2)} pp`,
    ]), [80, 57, 41]);
  }

  if (baseline && baseline.id !== current.id) {
    heading("Comparison with saved baseline");
    patientName(baseline.name);
    paragraph(`Baseline: ${baseline.createdAt} | ID: ${baseline.id}`, 9);
    paragraph(`Baseline mode: ${baseline.demo ? "demo" : "live"}. Changes are current minus baseline; they do not establish causation.`, 9);
    table(["Target", "Baseline", "Current", "Change"], TARGETS.map((target) => {
      const a = predictionOf(baseline, target), b = predictionOf(current, target);
      return [target, `${(a.probability * 100).toFixed(1)}%`, `${(b.probability * 100).toFixed(1)}%`, probabilityChange(a.probability, b.probability)];
    }), [35, 48, 48, 47]);
    const changes = changedInputs(baseline, current);
    paragraph(`${changes.length} changed inputs. Baseline supplied ${completeness(baseline.inputs).supplied.length} of ${FIELDS.length} inputs.`);
    if (changes.length) table(["Input", "Baseline", "Current"], changes.map((field) => [field.label,
      ...[baseline, current].map((snapshot) => `${displayInput(field.key, snapshot.inputs, snapshot.result.context?.effective_inputs)} (${snapshot.inputs[field.key] === undefined ? "default" : "supplied"})`),
    ]), [70, 54, 54]);
  }
  for (let page = 1; page <= doc.getNumberOfPages(); page++) {
    doc.setPage(page); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(100, 115, 130);
    doc.text("Cardisoft | Research prototype | Not a medical diagnosis", left, 288);
    doc.text(`${page} / ${doc.getNumberOfPages()}`, 194, 288, { align: "right" });
  }
  return doc;
}
