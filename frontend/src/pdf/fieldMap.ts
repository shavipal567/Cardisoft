import type { Patient } from "../api";
import { FIELDS } from "../fields";

export type Confidence = "high" | "medium" | "low";

export interface PdfHit {
  key: string;
  value: number;
  confidence: Confidence;
  snippet: string;
}

export interface PdfParseResult {
  values: Patient;
  hits: PdfHit[];
  skipped: { key: string; reason: string; snippet: string }[];
}

const NEG = /\b(no|not|absent|negative|normal|denies|denied|nil|none|without|non|never|former|ex|quit|stopped)\b/i;

function snippetAround(text: string, idx: number, len = 110): string {
  const s = Math.max(0, idx - 40);
  return text.slice(s, idx + len).replace(/\s+/g, " ").trim().slice(0, 130);
}

function clampToField(key: string, v: number): boolean {
  const f = FIELDS.find((x) => x.key === key);
  if (!f || f.type !== "number") return true;
  return v >= (f.min ?? -Infinity) && v <= (f.max ?? Infinity);
}

interface NumSpec {
  key: string;
  aliases: RegExp[];
}

/** Ordered aliases — most specific first (HDL before generic lipid, etc.). */
const NUM_SPECS: NumSpec[] = [
  { key: "Age", aliases: [/\bage\s*(?:is|:|=)?\s*(\d{2,3})\s*(?:y|yr|year)?/i, /\b(\d{2,3})\s*(?:y\/o|years?\s*old)\b/i] },
  { key: "BMI", aliases: [/\bBMI\s*[-:=]?\s*(\d{2,4}(?:\.\d+)?)/i, /\bbody\s*mass\s*index\s*[-:=]?\s*(\d{2,4}(?:\.\d+)?)/i] },
  { key: "BP", aliases: [/\b(?:systolic|sys|NIBP|BP)\s*[-:=]?\s*(\d{2,4})\s*(?:\/\s*\d{2,3})?\s*(?:mm\s*hg)?/i, /\bBP\s*(\d{2,4})\s*\/\s*\d{2,3}/i] },
  { key: "PR", aliases: [/\b(?:pulse(?:\s*rate)?|heart\s*rate|\bHR\b|\bPR\b)\s*[-:=]?\s*(\d{2,4})\s*(?:bpm)?/i] },
  { key: "FBS", aliases: [/\b(?:fasting\s*(?:blood\s*)?(?:sugar|glucose)|FBS|FBG)\s*[-:=]?\s*(\d{2,4}(?:\.\d+)?)/i] },
  { key: "LDL", aliases: [/\bLDL(?:-C)?\s*[-:=]?\s*(\d{2,4}(?:\.\d+)?)/i, /\blow\s*density\s*lipoprotein\s*[-:=]?\s*(\d{2,4}(?:\.\d+)?)/i] },
  { key: "HDL", aliases: [/\bHDL(?:-C)?\s*[-:=]?\s*(\d{2,4}(?:\.\d+)?)/i, /\bhigh\s*density\s*lipoprotein\s*[-:=]?\s*(\d{2,4}(?:\.\d+)?)/i] },
  { key: "TG", aliases: [/\b(?:triglycerides?|TG|trig)\s*[-:=]?\s*(\d{2,4}(?:\.\d+)?)/i] },
  { key: "EF-TTE", aliases: [/\b(?:ejection\s*fraction|LVEF|\bEF\b)(?:\s*\([^)]*\))?\s*[-:=]?\s*(\d{2,4}(?:\.\d+)?)\s*%?/i] },
];

const TOGGLE_SPECS: { key: string; positive: RegExp; negatedByContext?: boolean }[] = [
  { key: "Sex", positive: /\b(male|female|sex\s*:\s*[mf]\b|gender\s*:\s*[mf]\b)/i },
  { key: "DM", positive: /\b(diabetes(?:\s*mellitus)?|T2DM|T1DM|\bDM\b|hyperglycemia)/i },
  { key: "HTN", positive: /\b(hypertension|\bHTN\b|hypertensive)/i },
  { key: "Current Smoker", positive: /\b(smok(?:er|ing)?|cigarette|tobacco|packs?\s*(?:per\s*day|\/day|day))/i },
  { key: "FH", positive: /\b(family\s*history|FH\b.{0,20}(?:cad|cvd|heart)|father.{0,30}heart|mother.{0,30}heart)/i },
  { key: "Typical Chest Pain", positive: /\b(typical\s*(?:angina|chest\s*pain)|exertional\s*chest\s*pain|pressure.{0,15}chest|angina\b)/i },
  { key: "Q Wave", positive: /\b(q[\s-]?wave|pathological\s*q\b)/i },
  { key: "St Elevation", positive: /\b(st[\s-]?elev|stemi|st\s*segment\s*elev)/i },
  { key: "St Depression", positive: /\b(st[\s-]?dep|st\s*segment\s*dep)/i },
  { key: "Tinversion", positive: /\b(t[\s-]?invers|inverted\s*t\b|t\s*wave\s*invers)/i },
];

function ageFromDob(text: string): { age: number; snippet: string } | null {
  const m = text.match(/\b(?:DOB|date\s*of\s*birth)\s*[-:=]?\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i);
  if (!m) return null;
  const birth = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const mm = now.getMonth() - birth.getMonth();
  if (mm < 0 || (mm === 0 && now.getDate() < birth.getDate())) age--;
  if (age < 20 || age > 100) return null;
  return { age, snippet: snippetAround(text, m.index ?? 0) };
}

export function parsePatientFromText(text: string): PdfParseResult {
  const values: Patient = {};
  const hits: PdfHit[] = [];
  const skipped: PdfParseResult["skipped"] = [];
  const lines = text.split(/\n|;|(?<=\.)\s+(?=[A-Z])/);

  for (const spec of NUM_SPECS) {
    let found: { v: number; snippet: string; explicit: boolean } | null = null;
    for (const re of spec.aliases) {
      const m = text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
      if (!m) continue;
      // Re-run without /g to get groups of first in-range hit
      const g = new RegExp(re.source, "i");
      let exec: RegExpExecArray | null;
      const rx = new RegExp(g.source, "gi");
      while ((exec = rx.exec(text)) !== null) {
        const v = Number(exec[1]);
        if (!Number.isFinite(v)) continue;
        if (!clampToField(spec.key, v)) {
          skipped.push({ key: spec.key, reason: `out-of-range (${v})`, snippet: snippetAround(text, exec.index) });
          continue;
        }
        found = { v, snippet: snippetAround(text, exec.index), explicit: /[:=]/.test(exec[0]) };
        break;
      }
      if (found) break;
    }
    if (found) {
      values[spec.key] = Math.round(found.v * 10) / 10;
      hits.push({ key: spec.key, value: values[spec.key], confidence: found.explicit ? "high" : "medium", snippet: found.snippet });
    }
  }

  // DOB fallback for Age
  if (values.Age === undefined) {
    const dob = ageFromDob(text);
    if (dob) {
      values.Age = dob.age;
      hits.push({ key: "Age", value: dob.age, confidence: "medium", snippet: dob.snippet });
    }
  }

  for (const spec of TOGGLE_SPECS) {
    const matches: { negated: boolean; snippet: string }[] = [];
    for (const line of lines) {
      const m = line.match(spec.positive);
      if (!m || m.index === undefined) continue;
      const before = line.slice(Math.max(0, m.index - 30), m.index);
      const negated = NEG.test(before) || NEG.test(line.slice(m.index, m.index + m[0].length + 20).split(/,|\band\b/i)[0] ?? "");
      matches.push({ negated, snippet: snippetAround(line, m.index) });
    }
    if (matches.length === 0) continue;

    if (spec.key === "Sex") {
      const lower = matches.map((x) => x.snippet.toLowerCase()).join(" ");
      const isFemale = /\bfemale\b|\bwoman\b|sex\s*:\s*f\b|gender\s*:\s*f\b/.test(lower);
      const isMale = /\bmale\b|\bman\b|sex\s*:\s*m\b|gender\s*:\s*m\b/.test(lower);
      if (isFemale && !isMale) {
        values.Sex = 0;
        hits.push({ key: "Sex", value: 0, confidence: "high", snippet: matches[0].snippet });
      } else if (isMale && !isFemale) {
        values.Sex = 1;
        hits.push({ key: "Sex", value: 1, confidence: "high", snippet: matches[0].snippet });
      } else if (isFemale || isMale) {
        skipped.push({ key: "Sex", reason: "conflicting sex mentions", snippet: matches[0].snippet });
      }
      continue;
    }

    if (spec.key === "Current Smoker" && /ex[\s-]?smoker|former\s*smoker|quit\s*smok|stopped\s*smok/i.test(text)) {
      const hasCurrent = matches.some((x) => !x.negated && /current|active/i.test(x.snippet));
      if (!hasCurrent) {
        values["Current Smoker"] = 0;
        const ex = text.match(/ex[\s-]?smoker|former\s*smoker|quit\s*smok/i);
        hits.push({ key: "Current Smoker", value: 0, confidence: "medium", snippet: ex ? snippetAround(text, ex.index ?? 0) : matches[0].snippet });
        continue;
      }
    }

    const positive = matches.filter((x) => !x.negated);
    const negated = matches.filter((x) => x.negated);
    if (positive.length > 0) {
      values[spec.key] = 1;
      hits.push({ key: spec.key, value: 1, confidence: positive.length >= 2 ? "high" : "medium", snippet: positive[0].snippet });
    } else if (negated.length > 0) {
      values[spec.key] = 0;
      hits.push({ key: spec.key, value: 0, confidence: "medium", snippet: negated[0].snippet });
    }
  }

  return { values, hits, skipped };
}
