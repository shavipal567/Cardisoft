import type { ExplainResponse, Patient, PredictResponse, Target } from "./api";
import { buildPlan } from "./careplan";
import { FIELDS, TARGET_LABELS, fieldValueLabel } from "./fields";
import { PLAIN_LABEL, band, plainName } from "./plain";

export type SectionId = "summary" | "vessels" | "factors" | "meaning" | "next" | "urgent" | "limits";

// make abbreviations, percentages and emergency numbers sound right when read aloud
const FIX: [RegExp, string][] = [
  [/\bLAD\b/g, "L A D"], [/\bLCX\b/g, "L C X"], [/\bRCA\b/g, "R C A"], [/\bCAD\b/g, "C A D"],
  [/\bLDL\b/g, "L D L"], [/\bHDL\b/g, "H D L"], [/\bECG\b/g, "E C G"], [/\bBMI\b/g, "B M I"], [/\bBP\b/g, "B P"],
  [/\b112\b/g, "one one two"], [/\b108\b/g, "one zero eight"], [/%/g, " percent"],
];
export const spoken = (s: string) => FIX.reduce((t, [re, to]) => t.replace(re, to), s);

export interface Section {
  id: SectionId;
  title: string;
  paras?: string[];
  bullets?: string[];
  say: string; // short audio
  more?: string; // extra audio, only in the full version
}

const pct = (p: number) => Math.round(p * 100);
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const list = (a: string[]) => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);

// One-line reasons. General background only: have a clinician review before the demo.
const WHY: Record<string, string> = {
  Age: "The chance of narrowed arteries generally rises with age.",
  "Typical Chest Pain": "Chest pain with this pattern can be a sign the heart is not getting enough blood.",
  "EF-TTE": "Lower values can mean the heart muscle is under strain.",
  BP: "High blood pressure puts extra strain on artery walls over time.",
  LDL: "High LDL cholesterol can build up inside artery walls.",
  HDL: "HDL helps clear cholesterol, so low levels are less protective.",
  TG: "High blood fats are linked to a higher chance of artery disease.",
  FBS: "High blood sugar over time can damage blood vessels.",
  BMI: "Extra weight can raise blood pressure, sugar and cholesterol.",
  DM: "Diabetes raises the chance of artery disease.",
  HTN: "Long-term high blood pressure strains the arteries.",
  "Current Smoker": "Smoking damages artery walls.",
  FH: "Heart disease in the family can raise your own chance.",
  "Q Wave": "This heart-tracing (ECG) change can point to earlier heart damage.",
  "St Elevation": "This heart-tracing (ECG) change can point to reduced blood flow to the heart.",
  "St Depression": "This heart-tracing (ECG) change can point to reduced blood flow to the heart.",
  Tinversion: "This heart-tracing (ECG) change can point to reduced blood flow to the heart.",
};

const MEANING = {
  patient: {
    higher: "The model sees a pattern that is often found in people with narrowed heart arteries. That is a reason to talk to a doctor soon about whether tests, such as a stress test or a scan of the heart's arteries, are needed.",
    moderate: "The model is not sure either way. It is worth mentioning these results at your next doctor visit, especially if you have symptoms.",
    lower: "The model sees fewer of the usual warning patterns. That is reassuring, but it does not rule out a problem, especially if you have chest pain or breathlessness.",
  },
  clinician: {
    higher: "Pattern consistent with obstructive coronary disease. Correlate with symptoms and consider confirmatory testing (stress testing or coronary imaging) per local guidelines.",
    moderate: "Intermediate probability. Interpret alongside clinical assessment.",
    lower: "Lower estimate. It does not exclude CAD, particularly for LCX and RCA where validation performance is weaker.",
  },
} as const;

const URGENT =
  "Call 112 or 108 right away for chest pain or pressure lasting more than a few minutes, pain spreading to the arm, jaw or back, shortness of breath, a cold sweat, or fainting. Do not wait for this tool.";

const LIMITS = [
  "The model learned from records of 303 patients from a single source and has not been tested on outside patients.",
  "It is less reliable for the LCX and RCA arteries.",
  "Measurements that were not entered are replaced by typical values, so results are less personal.",
  "It estimates a chance. It cannot show where a narrowing is or how severe it is.",
  "It is not a diagnosis.",
];

export function buildReport(a: {
  clinician: boolean;
  name: string;
  result: PredictResponse;
  patient: Patient;
  expl?: ExplainResponse;
}): Section[] {
  const { clinician, name, result, patient, expl } = a;
  const get = (t: Target) => (t === "CAD" ? result.cad : result.vessels[t]);
  const arts = ["LAD", "LCX", "RCA"] as const;
  const hi = result.cad.probability;
  const b = band(hi);
  const label = (n: string) => FIELDS.find((f) => f.key === n)?.label ?? n;
  const nameOf = (n: string) => (clinician ? label(n) : plainName(n) !== n ? plainName(n) : label(n));
  const show = (n: string, raw: number | string) => (patient[n] !== undefined ? fieldValueLabel(n, patient[n]) : String(raw));

  // what drove the overall estimate (only inputs that were actually entered)
  const own = expl ? expl.features.filter((f) => !f.assumed) : [];
  const signed = expl?.signed !== false;
  const up = signed ? own.filter((f) => f.contribution > 0.005).sort((x, y) => y.contribution - x.contribution).slice(0, 3) : [];
  const down = signed ? own.filter((f) => f.contribution < -0.005).sort((x, y) => x.contribution - y.contribution).slice(0, 2) : [];
  const top = signed ? [] : [...own].sort((x, y) => y.contribution - x.contribution).slice(0, 4);

  const bottom = clinician
    ? `Overall CAD probability ${pct(hi)}%, model classification ${result.cad.prediction === 1 ? "positive" : "negative"}. This is model output only and not a diagnosis.`
    : `The model estimates a ${b} chance, about ${pct(hi)}% (roughly ${Math.round(hi * 10)} in 10), that at least one of your main heart arteries is narrowed by 50% or more. This is an estimate to start a conversation with a doctor. It is not a diagnosis.`;

  const groups = (["higher", "moderate", "lower"] as const)
    .map((bd) => {
      const m = arts.filter((x) => band(result.vessels[x].probability) === bd);
      return m.length ? `${bd} for ${list(m.map((x) => (clinician ? x : "the " + PLAIN_LABEL[x].toLowerCase())))}` : "";
    })
    .filter(Boolean);

  const plan = buildPlan(patient, result, clinician);
  const steps = plan.items.slice(0, clinician ? 4 : 3);

  const factorBullets = [
    ...up.map((f) => (clinician ? `${nameOf(f.name)} ${show(f.name, f.value)}: +${pct(f.contribution)} points` : `${nameOf(f.name)} (${show(f.name, f.value)}) raised it. ${WHY[f.name] ?? ""}`)),
    ...down.map((f) => (clinician ? `${nameOf(f.name)} ${show(f.name, f.value)}: ${pct(f.contribution)} points` : `${nameOf(f.name)} (${show(f.name, f.value)}) lowered it.`)),
    ...top.map((f) => `${nameOf(f.name)}: the model relies on this input a lot`),
  ];

  return [
    {
      id: "summary",
      title: "Bottom line",
      paras: [bottom],
      say: `${name ? `Report for ${name}. ` : ""}${bottom}`,
    },
    {
      id: "vessels",
      title: "Results at a glance",
      bullets: (["CAD", ...arts] as Target[]).map(
        (t) =>
          `${clinician ? TARGET_LABELS[t] : PLAIN_LABEL[t]}: ${pct(get(t).probability)}% (${band(get(t).probability)}${clinician ? `, ${get(t).prediction === 1 ? "positive" : "negative"}` : ""})`
      ),
      say: `By artery, the estimate is ${list(groups)}. The model is less sure about the side and right side arteries.`,
    },
    {
      id: "factors",
      title: "Why the model said this",
      paras: factorBullets.length ? undefined : ["The detailed explanation is still loading."],
      bullets: factorBullets.length ? factorBullets : undefined,
      say: factorBullets.length
        ? `The main reasons: ${list((up.length ? up : top).map((f) => low(nameOf(f.name))))} ${up.length ? "raised" : "mattered most to"} the estimate${down.length ? `, while ${list(down.map((f) => low(nameOf(f.name))))} lowered it` : ""}.`
        : "",
      more: clinician ? "" : up.slice(0, 2).map((f) => WHY[f.name] ?? "").join(" "),
    },
    {
      id: "meaning",
      title: "What this could mean",
      paras: [MEANING[clinician ? "clinician" : "patient"][b]],
      say: MEANING[clinician ? "clinician" : "patient"][b],
      more:
        !clinician && band(result.vessels.LAD.probability) === "higher"
          ? "The front artery, called LAD, feeds a large part of the heart's main pumping chamber, which is why doctors look at it closely."
          : "",
    },
    {
      id: "next",
      title: clinician ? "Considerations" : "What you can do next",
      bullets: steps.map((s) => `${s.title}: ${s.text}`),
      say: clinician
        ? `Considerations: ${list(steps.map((s) => s.title.toLowerCase()))}.`
        : `What you can do next: ${list(steps.map((s) => s.title.toLowerCase()))}. Take these results to a doctor and ask what they mean for you.`,
      more: steps.map((s) => s.text).join(" "),
    },
    { id: "urgent", title: "When to get urgent help", paras: [URGENT], say: URGENT },
    {
      id: "limits",
      title: "How reliable this is",
      bullets: LIMITS,
      say: "Please remember: this estimate comes from a small set of patients, it is less reliable for two of the arteries, and it is not a diagnosis.",
      more: LIMITS.join(" "),
    },
  ];
}
