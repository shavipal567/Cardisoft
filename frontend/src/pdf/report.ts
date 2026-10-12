import { featureMeta, featureValue, formatContribution, formatOutput, PROVENANCE, statusOf } from "../explanation";
import { jsPDF } from "jspdf";
import type { Target } from "../api";
import { TARGETS, TARGET_LABELS, FIELDS } from "../fields";
import {
  completeness,
  changedInputs,
  displayInput,
  predictionOf,
  probabilityChange,
} from "../assessment";
import type { Assessment, Explanations } from "../assessment";

type ExportErrors = Partial<Record<Target, string>>;

// The built-in PDF font needs plain equivalents for typographic symbols.
const withoutControls = (value: string) => Array.from(value, char =>
  char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? " " : char).join("");
const clean = (value: unknown) => withoutControls(String(value ?? "Unavailable"))
  .replace(/[–—−]/g, "-")
  .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/→/g, "->")
  .replace(/µ/g, "u").replace(/³/g, "^3");

const PAGE_W = 210;
const M = 15;
const W = PAGE_W - M * 2;
const BOTTOM = 280;

const C = {
  navy: [24, 49, 74] as [number, number, number],
  teal: [0, 130, 130] as [number, number, number],
  ink: [43, 54, 67] as [number, number, number],
  muted: [105, 119, 132] as [number, number, number],
  pale: [241, 246, 249] as [number, number, number],
  line: [218, 227, 233] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  red: [185, 64, 64] as [number, number, number],
  amber: [183, 124, 34] as [number, number, number],
  green: [38, 125, 91] as [number, number, number],
};

export async function createAssessmentPdf(
  snapshot: Assessment,
  explanations: Explanations,
  errors: ExportErrors,
  comparison: Assessment | null,
  heartImage: HTMLCanvasElement,
) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  let y = 0;

  const setText = (
    color: [number, number, number],
    size = 9,
    bold = false,
  ) => {
    doc.setTextColor(...color);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
  };
    

  
function drawPageHeader() {
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, PAGE_W, 26, "F");

  // Cardisoft wordmark
  setText(C.navy, 17, true);
  doc.text("Cardi", M, 12);

  const cardiWidth = doc.getTextWidth("Cardi");
  setText(C.teal, 17, true);
  doc.text("soft", M + cardiWidth, 12);

  setText(C.muted, 8);
  doc.text("Heart risk, explained", M,19);

  setText(C.navy, 8, true);
  doc.text("CARDIAC ASSESSMENT", PAGE_W - M, 10, {
    align: "right",
  });

  setText(C.muted, 7.5);
  doc.text(
    snapshot.id
      ? `Report ID: ${snapshot.id.slice(0, 20)}`
      : "Clinical report",
    PAGE_W - M,
    16,
    { align: "right" },
  );

  doc.setDrawColor(...C.teal);
  doc.setLineWidth(0.6);
  doc.line(M, 25, PAGE_W - M, 25);
}


  function newPage() {
    doc.addPage();
    drawPageHeader();
    y = 34;
  }

  function ensureSpace(height: number) {
    if (y + height > BOTTOM) newPage();
  }

  
function section(title: string, subtitle?: string) {
  const headingHeight = subtitle ? 17 : 12;

  // Keep the heading and subtitle away from the bottom of the page.
  ensureSpace(headingHeight + 8);

  // Teal accent beside the heading.
  doc.setFillColor(...C.teal);
  doc.roundedRect(M, y - 4, 1.5, 7, 0.6, 0.6, "F");

  // Section title.
  setText(C.navy, 12, true);
  doc.text(title, M + 5, y + 1);

  y += 7;

  // Optional subtitle.
  if (subtitle) {
    setText(C.muted, 8);
    const subtitleLines = doc.splitTextToSize(
      subtitle,
      W - 5,
    ) as string[];

    doc.text(subtitleLines, M + 5, y);
    y += subtitleLines.length * 4 + 1;
  }

  y += 3;
}

  function paragraph(text: string, indent = 0, fontSize = 9) {
    setText(C.ink, fontSize);
    const lines = doc.splitTextToSize(
      clean(text || "Not available"),
      W - indent,
    ) as string[];

    const lineH = fontSize * 0.48;
    ensureSpace(lines.length * lineH + 4);

    setText(C.ink, fontSize);
    doc.text(lines, M + indent, y);
    y += lines.length * lineH + 4;
  }
  
function estimateTableHeight(
  rows: string[][],
  widths: number[],
  fontSize = 8,
) {
  const headerHeight = 9;
  const lineHeight = fontSize * 0.48;
  setText(C.navy, fontSize);

  const rowsHeight = rows.reduce((total, row) => {
    const wrapped = row.map((value, i) =>
      doc.splitTextToSize(
        clean(value ?? "—"),
        Math.max(8, widths[i] - 5),
      ) as string[],
    );

    const rowHeight = Math.max(
      8,
      ...wrapped.map((lines) => lines.length * lineHeight + 4),
    );

    return total + rowHeight;
  }, 0);

  return headerHeight + rowsHeight + 4;
}



  function infoCard(
    title: string,
    value: string,
    x: number,
    top: number,
    width: number,
    height = 23,
  ) {
    doc.setFillColor(...C.pale);
    doc.setDrawColor(...C.line);
    doc.roundedRect(x, top, width, height, 2, 2, "FD");

    setText(C.muted, 7.2);
    doc.text(title.toUpperCase(), x + 4, top + 6);

    setText(C.navy, 11, true);
    const lines = doc.splitTextToSize(clean(value), width - 8) as string[];
    doc.text(lines.slice(0, 2), x + 4, top + 13);
  }

  function table(
  headers: string[],
  rows: string[][],
  widths: number[],
  fontSize = 8,
) {
  const headerHeight = 9;
  const cellPadding = 4;
  const lineHeight = fontSize * 0.48;

  // Measure at the same font size used to render the cells.
  setText(C.navy, fontSize);
  const wrappedRows = rows.map((row) => row.map((value, i) =>
      doc.splitTextToSize(
        clean(value ?? "—"),
        Math.max(8, widths[i] - 5),
      ) as string[],
  ));
  const rowHeights = wrappedRows.map((wrapped) => Math.max(
      8,
      ...wrapped.map((lines) => lines.length * lineHeight + cellPadding),
  ));
  ensureSpace(headerHeight + (rowHeights[0] ?? 0));

  // Draw the table header.
  const drawHeader = () => {
    doc.setFillColor(...C.navy);
    doc.roundedRect(M, y - 4, W, headerHeight, 1.5, 1.5, "F");

    setText(C.white, 7.5, true);

    let x = M + 3;
    headers.forEach((header, i) => {
      doc.text(header, x, y + 1);
      x += widths[i];
    });

    y += headerHeight;
  };

  drawHeader();

  // Long tables continue on a new page with their column headings repeated.
  wrappedRows.forEach((wrapped, rowIndex) => {
    const rowHeight = rowHeights[rowIndex];
    if (y + rowHeight > BOTTOM) {
      newPage();
      drawHeader();
    }

    if (rowIndex % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, y - 4, W, rowHeight, "F");
    }

    let x = M + 3;

    wrapped.forEach((lines, i) => {
      setText(C.navy, fontSize);
      doc.text(lines, x, y + 1);
      x += widths[i];
    });

    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.15);
    doc.line(M, y + rowHeight - 4, M + W, y + rowHeight - 4);

    y += rowHeight;
  });

  y += 4;
}

  // jsPDF already creates page 1. Draw its header without adding a page.
drawPageHeader();
y = 34;

  setText(C.navy, 19, true);
  doc.text("Cardiac assessment", M, y + 3);
  setText(C.teal, 10, true);
  doc.text("Patient report and model analysis", M, y + 10);
  y += 18;

  const date = new Date(snapshot.createdAt);
  const dateText = Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString();

  const complete = completeness(snapshot.inputs);

  infoCard(
    "Patient",
    snapshot.name || "Unnamed patient",
    M,
    y,
    85,
    25,
  );
  infoCard(
    "Assessment date",
    dateText,
    M + 89,
    y,
    W - 89,
    25,
  );
  y += 30;

  infoCard(
    "Data completeness",
    `${complete.percent}% (${complete.supplied.length}/${FIELDS.length} fields supplied)`,
    M,
    y,
    85,
    25,
  );
  infoCard(
    "Report mode",
    snapshot.demo ? "Demo data" : "Assessment results",
    M + 89,
    y,
    W - 89,
    25,
  );
  y += 32;

  section("Executive summary", "A concise overview of this assessment");

  const predictions = TARGETS.map((target) => ({
    target,
    pred: predictionOf(snapshot, target),
  })).sort((a, b) => b.pred.probability - a.pred.probability);

  const highest = predictions[0];

  if (highest) {
    paragraph(
      `Among the targets evaluated, ${TARGET_LABELS[highest.target]} has the highest model-estimated probability at ${(highest.pred.probability * 100).toFixed(1)}%. This identifies the largest estimate within this report; it does not establish a diagnosis or determine clinical urgency.`,
    );
  }

  paragraph(
    `${complete.supplied.length} of ${FIELDS.length} available patient fields were supplied (${complete.percent}% completeness). Missing or defaulted inputs may affect model outputs.`,
  );

  paragraph(
    "The classifications and probabilities below are outputs of prediction models. They must be reviewed in clinical context by a qualified healthcare professional.",
  );

  
  
const predictionHeaders = [
  "Assessment target",
  "Estimated probability",
  "Model classification",
];

const predictionRows = TARGETS.map((target) => {
  const pred = predictionOf(snapshot, target);

  return [
    TARGET_LABELS[target],
    `${(pred.probability * 100).toFixed(1)}%`,
    pred.prediction === 1 ? "Positive" : "Negative",
  ];
});

const predictionWidths = [62, 54, 58];

ensureSpace(
  20 +
    estimateTableHeight(predictionRows, predictionWidths, 8.5) +
    4,
);

section(
  "Summary of model estimates",
  "Predictions generated from the available assessment inputs",
);

table(
  predictionHeaders,
  predictionRows,
  predictionWidths,
  8.5,
);


  paragraph(
    "Interpretation: Probabilities and classifications are model outputs. They are not confirmed diagnoses and should be reviewed by a qualified healthcare professional in the context of the patient's clinical presentation.",
    0,
    8,
  );


  const validation = snapshot.result.context?.input_validation;
  if (!snapshot.demo && validation?.status === "available") {
    section("Test accuracy with available inputs");
    paragraph("Held-out test records retain the same supplied fields; omitted fields use the same defaults. These exploratory cohort scores are not the chance that this patient's prediction is correct.", 0, 9);
    if (complete.supplied.length === 0) paragraph("No patient measurements were supplied. Predictions use defaults only and are not personalized.");
    const pc = (value: number) => `${(value * 100).toFixed(1)}%`;
    table(["Target", "Test accuracy", "95% interval", "Recall", "All inputs"], TARGETS.map((target) => {
      const score = validation.targets[target];
      return [target, `${pc(score.accuracy)} (${score.correct}/${score.n_test})`,
        `${pc(score.accuracy_interval.low)} - ${pc(score.accuracy_interval.high)}`,
        score.recall === null ? "N/A" : pc(score.recall), pc(score.full_input_accuracy)];
    }), [20, 43, 48, 30, 37]);
    paragraph("95% Wilson intervals reflect sampling uncertainty on a small, single-source test set. Accuracy depends on which inputs are available, not just their count. More inputs do not guarantee a higher score.", 0, 9);
  } else {
    paragraph(snapshot.demo ? "Accuracy for these inputs was not evaluated in demo mode."
      : "Accuracy for these inputs is unavailable; input coverage is not an accuracy estimate.", 0, 9);
  }

  // Patient input details
  const inputRows = FIELDS.map((field) => {
    const entered = snapshot.inputs[field.key] !== undefined;
    const effective = snapshot.result.context?.effective_inputs?.[field.key];
    const defaulted = snapshot.result.context?.defaulted_inputs?.includes(field.key) ?? false;

    let status = entered ? "Provided" : "Not provided";
    if (!entered && (defaulted || effective !== undefined)) status = "Default/effective value";

    return [
      field.label,
      displayInput(
        field.key,
        snapshot.inputs,
        snapshot.result.context?.effective_inputs,
      ),
      status,
    ];
  });

  const inputHeaders = ["Patient field", "Value", "Status"];
  const inputWidths = [65, 75, 40];

// Ensure the heading and table header start together.
ensureSpace(35);

section("Patient information", "Values supplied to the assessment");

table(inputHeaders, inputRows, inputWidths, 7.5);


  section("Model identity");
  if (snapshot.demo) paragraph("Demo fixtures. No fitted model was invoked for these predictions.");
  else if (snapshot.result.context) {
    paragraph("Artifact version is SHA-256 of the loaded preprocessor and model bytes. Training revision identifies the recorded training code revision.", 0, 9);
    table(["Target / model", "Artifact version / training revision"], TARGETS.map((target) => {
      const model = snapshot.result.context!.models?.[target];
      return [`${target}: ${model?.name ?? "Model unavailable"}`, model ? `${model.version}\nTraining: ${model.training_revision}` : "Identifier unavailable"];
    }), [58, 120]);
  } else paragraph("Model identity unavailable from this server response.");


  // Detailed model explanations
  section("Feature explanations", "Factors reported by the prediction models");

  paragraph(
    "Feature contributions describe model behaviour. They do not prove that a feature caused disease or that changing it will change a patient's outcome.",
    0,
    8,
  );

  for (const target of TARGETS) {
    ensureSpace(18);

    const explanation = explanations[target];

    if (!explanation) {
      paragraph(
        errors[target] || "An explanation was not available for this target.",
      );
      continue;
    }

    const details: string[] = [];
    if (explanation.method) details.push(`Method: ${explanation.method}`);
    if (explanation.model_version) details.push(`Model version: ${explanation.model_version}`);

    if (details.length) paragraph(details.join("  |  "), 0, 8);
    if (explanation.note) paragraph(explanation.note, 0, 8);

    if (explanation.signed === false) {
      paragraph(
        "The explanation reports importance only. Direction of influence cannot be inferred.",
        0,
        8,
      );
    }

    paragraph(
      `Baseline model output: ${formatOutput(explanation.base_value, explanation.output_space)}.`,
      0,
      8,
    );
    const features = [...explanation.features]
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 10);

    if (!features.length) {
      paragraph("No feature contributions were available.");
    } else {
      const featureHeaders = ["Input", "Value used / source", explanation.signed === false ? "Importance" : "Contribution"];
      const featureRows = features.map((feature) => [
        featureMeta(feature.name).label,
        `${featureValue(feature)}${feature.value !== null && featureMeta(feature.name).unit ? ` ${featureMeta(feature.name).unit}` : ""} (${PROVENANCE[statusOf(feature)].label})`,
        formatContribution(feature.contribution, explanation.output_space),
      ]);
      const featureWidths = [80, 57, 43];
      ensureSpace(35);
      section(TARGET_LABELS[target]);
      table(featureHeaders, featureRows, featureWidths, 7);
    }

  }

  // Optional comparison
  if (comparison) {
    section("Assessment comparison", "Current results compared with the selected baseline");

    paragraph(
      `Baseline: ${comparison.name || "Unnamed patient"} — ${new Date(comparison.createdAt).toLocaleString()}`,
    );
    paragraph(
      `Current: ${snapshot.name || "Unnamed patient"} — ${dateText}`,
    );
    paragraph(
      "Changes are current minus baseline, expressed in percentage points. A change in a model estimate does not establish that a particular input caused that change.",
      0,
      8,
    );

    table(
      ["Target", "Baseline", "Current", "Change"],
      TARGETS.map((target) => {
        const before = predictionOf(comparison, target);
        const after = predictionOf(snapshot, target);
        return [
          TARGET_LABELS[target],
          `${(before.probability * 100).toFixed(1)}%`,
          `${(after.probability * 100).toFixed(1)}%`,
          probabilityChange(before.probability, after.probability),
        ];
      }),
      [55, 40, 40, 45],
    );

    section("Changed patient inputs");

    const changed = changedInputs(comparison, snapshot);

    if (!changed.length) {
      paragraph("No input values or effective defaults changed.");
    } else {
      
const changedHeaders = ["Field", "Baseline", "Current"];

const changedRows = changed.map((field) => [
  field.label,
  displayInput(
    field.key,
    comparison.inputs,
    comparison.result.context?.effective_inputs,
  ),
  displayInput(
    field.key,
    snapshot.inputs,
    snapshot.result.context?.effective_inputs,
  ),
]);

const changedWidths = [55, 62, 63];

ensureSpace(
  20 + estimateTableHeight(changedRows, changedWidths, 7.5) + 4,
);

table(changedHeaders, changedRows, changedWidths, 7.5);

    }
  }

  // Optional heart image
  section("3D heart visualization", "Visual reference captured from the application");

  try {
  if (heartImage?.width > 0 && heartImage?.height > 0) {
    const imageData = heartImage.toDataURL("image/png");

    if (imageData.startsWith("data:image/png;base64,")) {
      const maxW = W;
      const maxH = 82;
      const scale = Math.min(
        maxW / heartImage.width,
        maxH / heartImage.height,
      );

      const imageW = heartImage.width * scale;
      const imageH = heartImage.height * scale;

      ensureSpace(imageH + 7);

      doc.addImage(
        imageData,
        "PNG",
        M + (W - imageW) / 2,
        y,
        imageW,
        imageH,
      );

      y += imageH + 8;
    } else {
      paragraph("The heart visualization was not available in PNG format.");
    }
  } else {
    paragraph("No heart visualization was available for this report.");
  }
} catch (error) {
  console.error("Heart image export failed:", error);
  paragraph("The heart visualization could not be embedded in this PDF.");
}
  // Limitations and safety
  section("Important limitations and safety");

  paragraph(
    "This report presents estimates from a prediction model, not a confirmed medical diagnosis. Model performance may vary across patients and clinical settings. Missing values may be replaced by defaults, and feature explanations describe model behaviour rather than proving medical cause and effect.",
  );

  paragraph(
    "Do not use this report alone to make medical decisions or delay care. Review results with a qualified healthcare professional.",
  );

  paragraph(
    "If you experience chest pain or pressure, pain spreading to the arm, jaw or back, shortness of breath, cold sweat, or fainting, seek emergency medical help immediately. In India, call 112 or 108 where available.",
  );

  // Consistent footers on all pages
  const pageCount = doc.getNumberOfPages();

  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);

    doc.setDrawColor(...C.line);
    doc.line(M, 285, PAGE_W - M, 285);

    setText(C.muted, 7.5);
    doc.text(
      "CARDISOFT  |  Confidential patient assessment",
      M,
      290,
    );
    doc.text(
      `Page ${i} of ${pageCount}`,
      PAGE_W - M,
      290,
      { align: "right" },
    );
  }

  return doc;
}
