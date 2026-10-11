import type { ExplainResponse, Patient, PredictResponse } from "../api";
import { FIELDS } from "../fields";
import { band, plainName } from "../plain";

// Keep the updated section IDs and spoken-text fixes.
export type SectionId =
  | "summary"
  | "vessels"
  | "factors"
  | "meaning"
  | "next"
  | "urgent"
  | "limits";

export interface Segment { id: SectionId; text: string }

const FIX: [RegExp, string][] = [
  [/\bLAD\b/g, "L A D"], [/\bLCX\b/g, "L C X"], [/\bRCA\b/g, "R C A"], [/\bCAD\b/g, "C A D"],
  [/\bLDL\b/g, "L D L"], [/\bHDL\b/g, "H D L"], [/\bECG\b/g, "E C G"], [/\bBMI\b/g, "B M I"], [/\bBP\b/g, "B P"],
  [/\b112\b/g, "one one two"], [/\b108\b/g, "one zero eight"], [/%/g, " percent"],
];

// Make abbreviations, percentages and emergency numbers sound right when read aloud.
export const spoken = (s: string) => FIX.reduce((text, [re, replacement]) => text.replace(re, replacement), s);

const pct = (p: number) => Math.round(p * 100);
const join = (a: string[]) => a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
const labelOf = (name: string) => {
  const f = FIELDS.find((x) => x.key === name);
  return (f ? f.label : name).replace(/\s*\(.*?\)\s*/g, " ").trim();
};

const SAY_VESSEL = {
  LAD: "the artery at the front of the heart, called LAD",
  LCX: "the artery that wraps around the side and back, called LCX",
  RCA: "the artery on the right side and underside, called RCA",
} as const;

function patientDetails(patient: Patient): string[] {
  return FIELDS.flatMap((field) => {
    const value = patient[field.key];
    if (value === undefined || value === null || (typeof value === "number" && Number.isNaN(value))) return [];
    const label = labelOf(field.key);
    const spokenValue = field.type === "toggle"
      ? value === 1 ? (field.on ?? "present") : (field.off ?? "absent")
      : String(value);
    return [`${label}: ${spokenValue}.`];
  });
}

export function buildScript(a: {
  clinician: boolean;
  name: string;
  result: PredictResponse;
  patient: Patient;
  cadExpl?: ExplainResponse;
}): Segment[] {
  const { clinician, name, result, patient, cadExpl } = a;
  const seg: Segment[] = [];
  const add = (id: SectionId, text: string) => seg.push({ id, text: spoken(text) });
  const v = result.vessels;
  const own = cadExpl ? cadExpl.features.filter((f) => !f.assumed) : [];
  const signed = cadExpl?.signed !== false;

  // Read entered patient values first, then only the analysis.
  const details = patientDetails(patient);
  if (details.length) {
    add("summary", `${name ? `Patient ${name}. ` : ""}Patient details. ${details.join(" ")}`);
  } else if (name) {
    add("summary", `Patient ${name}. No patient measurements have been entered.`);
  }

  if (clinician) {
    add("meaning", "Analysis results. Clinical summary. This is model output only and is not a diagnosis.");
    add("summary", `Overall CAD: probability ${pct(result.cad.probability)} percent, model classification ${result.cad.prediction === 1 ? "positive" : "negative"}.`);
    add("vessels", (["LAD", "LCX", "RCA"] as const)
      .map((t) => `${t}: ${pct(v[t].probability)} percent, ${v[t].prediction === 1 ? "positive" : "negative"}.`)
      .join(" "));

    if (own.length) {
      if (signed) {
        const top = [...own].sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution)).slice(0, 4);
        add("factors", "Main contributors to the overall CAD estimate: " + join(top.map((f) => `${labelOf(f.name)} ${f.contribution >= 0 ? "raised" : "lowered"} it`)) + ".");
      } else {
        const top = [...own].sort((x, y) => y.contribution - x.contribution).slice(0, 4);
        add("factors", "Most influential inputs for the overall CAD model: " + join(top.map((f) => labelOf(f.name))) + ".");
      }
    }
  } else {
    add("meaning", `${name ? `Results for ${name}. ` : ""}Analysis results. This is a computer estimate, not a diagnosis.`);
    add("summary", `For the heart's arteries overall, the model estimates a ${band(result.cad.probability)} chance, about ${pct(result.cad.probability)} percent, that at least one main artery is narrowed by fifty percent or more.`);
    (["LAD", "LCX", "RCA"] as const).forEach((t) => {
      add("vessels", `For ${SAY_VESSEL[t]}, the estimate is ${band(v[t].probability)}, about ${pct(v[t].probability)} percent.`);
    });

    if (own.length) {
      if (signed) {
        const up = own.filter((f) => f.contribution > 0.005).sort((x, y) => y.contribution - x.contribution).slice(0, 3);
        const down = own.filter((f) => f.contribution < -0.005).sort((x, y) => x.contribution - y.contribution).slice(0, 3);
        if (up.length) add("factors", "Things that made the overall estimate higher: " + join(up.map((f) => plainName(f.name))) + ".");
        if (down.length) add("factors", "Things that made it lower: " + join(down.map((f) => plainName(f.name))) + ".");
      } else {
        const top = [...own].sort((x, y) => y.contribution - x.contribution).slice(0, 4);
        add("factors", "What the model paid most attention to: " + join(top.map((f) => plainName(f.name))) + ".");
      }
    }
  }

  // Care-plan recommendations, ambulance/emergency instructions, and the safety notice
  // are intentionally omitted from read-aloud; they remain visible on the page.
  return seg;
}
