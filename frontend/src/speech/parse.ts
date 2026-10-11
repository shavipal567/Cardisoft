import { FIELDS } from "../fields";

export interface Parsed {
  numbers: Record<string, number>;
  toggles: Record<string, 0 | 1>;
  gender?: "Male" | "Female";
  rejected: { label: string; value: number; reason: string }[];
  heard: string;
  count: number;
}

const ONES = new Map<string, number>(
  Object.entries({
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19,
  })
);
const TENS = new Map<string, number>(
  Object.entries({ twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 })
);
const isNumWord = (w: string) => ONES.has(w) || TENS.has(w) || w === "hundred";

// "fifty eight" -> "58", "twenty seven point four" -> "27.4", "one hundred and ten" -> "110"
function wordsToDigits(text: string): string {
  const t = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < t.length) {
    if (!isNumWord(t[i])) {
      out.push(t[i]);
      i++;
      continue;
    }
    let cur = 0;
    let j = i;
    while (j < t.length) {
      const w = t[j];
      if (ONES.has(w)) cur += ONES.get(w)!;
      else if (TENS.has(w)) cur += TENS.get(w)!;
      else if (w === "hundred") cur = (cur || 1) * 100;
      else if (w === "and" && cur > 0 && j + 1 < t.length && isNumWord(t[j + 1])) {
        /* "one hundred and ten": skip the "and" */
      } else break;
      j++;
    }
    let s = String(cur);
    if (t[j] === "point") {
      let k = j + 1;
      let dec = "";
      while (k < t.length) {
        const d = t[k];
        if (/^\d$/.test(d)) dec += d;
        else if (ONES.has(d) && ONES.get(d)! <= 9) dec += String(ONES.get(d));
        else break;
        k++;
      }
      if (dec) {
        s += "." + dec;
        j = k;
      }
    }
    out.push(s);
    i = j;
  }
  return out.join(" ");
}

function normalise(raw: string): string {
  let s = raw.toLowerCase().replace(/[,;:!?%]/g, " ").replace(/\.(\s|$)/g, " ").replace(/\s+/g, " ").trim();
  s = wordsToDigits(s);
  s = s.replace(/(\d+)\s+point\s+(\d+)/g, "$1.$2");
  return s;
}

type Kind = "num" | "toggle";
interface Kw { kind: Kind; key: string; re: RegExp }

const KWS: Kw[] = [
  { kind: "toggle", key: "HTN", re: /high blood pressure|hypertensi(?:on|ve)/g },
  { kind: "toggle", key: "DM", re: /diabet(?:es|ic)/g },
  { kind: "toggle", key: "Current Smoker", re: /smok\w*/g },
  { kind: "toggle", key: "FH", re: /family history/g },
  { kind: "toggle", key: "Typical Chest Pain", re: /chest pain|angina/g },
  { kind: "toggle", key: "Q Wave", re: /q[- ]?wave/g },
  { kind: "toggle", key: "St Elevation", re: /s[- ]?t[- ]elevation/g },
  { kind: "toggle", key: "St Depression", re: /s[- ]?t[- ]depression/g },
  { kind: "toggle", key: "Tinversion", re: /t[- ]?wave inversion|t[- ]inversion|tinversion/g },
  { kind: "num", key: "Age", re: /\bage\b|years? old/g },
  { kind: "num", key: "BMI", re: /\bbmi\b|body mass index/g },
  { kind: "num", key: "BP", re: /blood pressure|\bbp\b|systolic/g },
  { kind: "num", key: "PR", re: /pulse(?: rate)?|heart rate/g },
  { kind: "num", key: "FBS", re: /fasting (?:blood )?(?:sugar|glucose)|blood sugar|\bfbs\b|glucose|sugar/g },
  { kind: "num", key: "LDL", re: /\bldl\b/g },
  { kind: "num", key: "HDL", re: /\bhdl\b/g },
  { kind: "num", key: "TG", re: /triglycerides?|\btg\b/g },
  { kind: "num", key: "EF-TTE", re: /ejection fraction|\bef\b/g },
];

interface Match { kind: Kind; key: string; start: number; end: number; text: string }

const isNeg = (w: string) => /^(no|not|non|never|without|negative|denies|absent|false|none)$/.test(w) || /n't$/.test(w);
const FILLER = new Set(["a", "an", "any", "the", "of", "have", "has", "had", "history", "evidence", "signs", "known"]);
const NUM = /\d+(?:\.\d+)?/;

export function parseSpeech(raw: string): Parsed {
  const text = normalise(raw);
  const numbers: Record<string, number> = {};
  const toggles: Record<string, 0 | 1> = {};
  const rejected: Parsed["rejected"] = [];

  // gender (the model only knows male or female; "transgender" must be chosen on the form)
  let gender: Parsed["gender"];
  if (/\b(female|woman|lady|girl)\b/.test(text)) gender = "Female";
  else if (/\b(male|man|boy|gentleman)\b/.test(text)) gender = "Male";

  // find every keyword; on overlap keep the one that starts first (so "high blood pressure" beats "blood pressure")
  const all: Match[] = [];
  for (const k of KWS) {
    k.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = k.re.exec(text))) {
      all.push({ kind: k.kind, key: k.key, start: m.index, end: m.index + m[0].length, text: m[0] });
      if (m[0].length === 0) k.re.lastIndex++;
    }
  }
  all.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kw: Match[] = [];
  let lastEnd = -1;
  for (const m of all) {
    if (m.start >= lastEnd) {
      kw.push(m);
      lastEnd = m.end;
    }
  }

  // words between keywords: decide which keyword each negation/yes word belongs to
  const gaps: string[][] = [];
  for (let i = 0; i <= kw.length; i++) {
    const from = i === 0 ? 0 : kw[i - 1].end;
    const to = i === kw.length ? text.length : kw[i].start;
    gaps.push(text.slice(from, to).split(/\s+/).filter(Boolean));
  }
  const pre: string[][] = kw.map(() => []);
  const post: string[][] = kw.map(() => []);
  if (kw.length) pre[0] = gaps[0];
  for (let i = 1; i <= kw.length; i++) {
    const g = gaps[i];
    const prev = i - 1;
    if (i === kw.length) {
      post[prev] = g; // text after the last keyword
      continue;
    }
    let negIdx = -1;
    g.forEach((w, n) => {
      if (isNeg(w)) negIdx = n;
    });
    const tail = negIdx >= 0 ? g.slice(negIdx + 1) : [];
    if (negIdx >= 0 && tail.length <= 2 && tail.every((w) => FILLER.has(w))) {
      // "... not a smoker", "no diabetes": the negation belongs to the NEXT keyword
      if (negIdx === 0 && tail.length === 0 && kw[prev].kind === "toggle" && pre[prev].length === 0) {
        post[prev] = g; // "diabetes no ...": a lone "no" right after a keyword answers that keyword
      } else {
        post[prev] = g.slice(0, negIdx);
        pre[i] = g.slice(negIdx);
      }
    } else {
      post[prev] = g;
    }
  }

  kw.forEach((m, i) => {
    if (m.kind === "toggle") {
      const near = [...pre[i].slice(-3), ...post[i].slice(0, 3)];
      toggles[m.key] = near.some(isNeg) ? 0 : 1;
      return;
    }
    // number: the first number after the keyword; "58 years old" has it before
    const seg = text.slice(m.end, i + 1 < kw.length ? kw[i + 1].start : text.length);
    let found = NUM.exec(seg)?.[0];
    if (!found && /year|old/.test(m.text)) {
      const before = text.slice(i === 0 ? 0 : kw[i - 1].end, m.start);
      const all = before.match(/\d+(?:\.\d+)?/g);
      if (all) found = all[all.length - 1];
    }
    if (found === undefined) return;
    const value = parseFloat(found);
    const f = FIELDS.find((x) => x.key === m.key);
    if (f && ((f.min !== undefined && value < f.min) || (f.max !== undefined && value > f.max))) {
      rejected.push({ label: f.label, value, reason: `outside the allowed range ${f.min} to ${f.max}` });
      return;
    }
    numbers[m.key] = value;
  });

  const count = Object.keys(numbers).length + Object.keys(toggles).length + (gender ? 1 : 0);
  return { numbers, toggles, gender, rejected, heard: text, count };
}
