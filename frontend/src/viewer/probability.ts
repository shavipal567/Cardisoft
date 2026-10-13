import type { Vessel } from "../api";

// Display anchors, not diagnostic thresholds or anatomical narrowing ranges.
// Interpolation is in sRGB so canvas, SVG, CSS and unlit vessel materials agree.
export const PROBABILITY_STOPS = [
  { value: 0, color: "#2563eb", name: "Blue" },
  { value: .25, color: "#06b6d4", name: "Cyan" },
  { value: .5, color: "#facc15", name: "Yellow" },
  { value: .75, color: "#f97316", name: "Orange" },
  { value: 1, color: "#dc2626", name: "Red" },
] as const;
export const UNAVAILABLE_COLOR = "#94a3b8";
export const REFERENCE_COLOR = "#d4b6a4";
export const PROBABILITY_GRADIENT = `linear-gradient(to right, ${PROBABILITY_STOPS.map((s) => `${s.color} ${s.value * 100}%`).join(", ")})`;

export function validProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function probabilityColor(value: number | undefined): string {
  if (!validProbability(value)) return UNAVAILABLE_COLOR;
  const position = value * (PROBABILITY_STOPS.length - 1);
  const i = Math.min(Math.floor(position), PROBABILITY_STOPS.length - 2);
  const from = parseInt(PROBABILITY_STOPS[i].color.slice(1), 16);
  const to = parseInt(PROBABILITY_STOPS[i + 1].color.slice(1), 16);
  const rgb = [16, 8, 0].map((shift) => {
    const a = (from >> shift) & 255, b = (to >> shift) & 255;
    return Math.round(a + (b - a) * (position - i)).toString(16).padStart(2, "0");
  });
  return `#${rgb.join("")}`;
}

export function compareProbabilities(probabilities: Partial<Record<Vessel, number>>) {
  const available = (["LAD", "LCX", "RCA"] as Vessel[]).filter((v) => validProbability(probabilities[v]));
  const maximum = available.length ? Math.max(...available.map((v) => probabilities[v]!)) : undefined;
  return { highest: available.filter((v) => probabilities[v] === maximum), complete: available.length === 3 };
}
