import type { Vessel } from "../api";

export interface VesselLesion {
  location?: string;
  /** Explicit mapping onto the displayed reference route, by arc length (0–1). */
  start_fraction?: number;
  end_fraction?: number;
  /** Measured diameter reduction, never a model probability. */
  diameter_stenosis_percent?: number;
}

export interface VesselFinding {
  source?: string;
  lesions: VesselLesion[];
}
export type VesselFindings = Partial<Record<Vessel, VesselFinding>>;

function finiteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** Shared display precision for the same model output across the anatomy view. */
export function formatModelProbability(value: number | undefined): string {
  return finiteInRange(value, 0, 1) ? `${(value * 100).toFixed(1)}%` : "Unavailable";
}

export function hasMappedLocation(lesion: VesselLesion): lesion is VesselLesion & { start_fraction: number; end_fraction: number } {
  return finiteInRange(lesion.start_fraction, 0, 1) && finiteInRange(lesion.end_fraction, 0, 1)
    && lesion.start_fraction < lesion.end_fraction;
}

// Keep partial findings useful, but never infer missing measurements, map a text
// location to an invented coordinate, or turn an empty array into "healthy".
export function normalizeVesselFindings(raw: unknown): VesselFindings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const findings: VesselFindings = {};
  for (const vessel of ["LAD", "LCX", "RCA"] as const) {
    const entry = (raw as Record<string, unknown>)[vessel];
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    if (!Array.isArray(value.lesions)) continue;
    const lesions: VesselLesion[] = [];
    for (const item of value.lesions) {
      if (!item || typeof item !== "object") continue;
      const lesion: VesselLesion = {};
      if (typeof item.location === "string" && item.location.trim()) lesion.location = item.location.trim();
      if (finiteInRange(item.diameter_stenosis_percent, 0, 100)) lesion.diameter_stenosis_percent = item.diameter_stenosis_percent;
      if (hasMappedLocation(item)) {
        lesion.start_fraction = item.start_fraction;
        lesion.end_fraction = item.end_fraction;
      }
      if (Object.keys(lesion).length) lesions.push(lesion);
    }
    if (lesions.length) findings[vessel] = {
      lesions,
      ...(typeof value.source === "string" && value.source.trim() ? { source: value.source.trim() } : {}),
    };
  }
  return Object.keys(findings).length ? findings : undefined;
}

export function lumenRadiusFraction(fraction: number, lesions: VesselLesion[]): number {
  let radius = 1;
  for (const lesion of lesions) {
    if (!hasMappedLocation(lesion) || !finiteInRange(lesion.diameter_stenosis_percent, 0, 100)
      || fraction < lesion.start_fraction || fraction > lesion.end_fraction) continue;
    const progress = (fraction - lesion.start_fraction) / (lesion.end_fraction - lesion.start_fraction);
    // The shape is schematic; only the supplied peak diameter reduction is measured.
    const taper = Math.sin(Math.PI * progress) ** 2;
    radius = Math.min(radius, 1 - lesion.diameter_stenosis_percent / 100 * taper);
  }
  return radius;
}
