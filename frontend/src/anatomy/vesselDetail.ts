import * as THREE from "three";
import type { Vessel } from "../api";
import { loadCoronaries } from "./coronary";
import { hasMappedLocation, lumenRadiusFraction } from "./stenosis";
import type { VesselLesion } from "./stenosis";

const routes = loadCoronaries().routes;
// Display scale only; the reference route has no measured vessel diameter.
const LUMEN_RADIUS = 14;
const WALL_RADIUS = 20;
const VIEW_DIRECTIONS: Record<Vessel, [number, number, number]> = {
  LAD: [0, 0, 1], LCX: [1, 0, 0], RCA: [-1, 0, 0],
};

// A lightweight SVG projection of the SAME registered routes as the heart.
// No second WebGL context, image download or patient-dependent geometry rebuild.
export function vesselDetail(vessel: Vessel, lesions: VesselLesion[] = []) {
  const mapped = lesions.filter(hasMappedLocation);
  // Example placement is purely educational. It never becomes a lesion record
  // or derives a location/measurement from the model's probability.
  const plaqueIsExample = !mapped.length && !(lesions.length > 0 && lesions.every((lesion) => lesion.diameter_stenosis_percent === 0));
  const plaqueSegments = plaqueIsExample
    ? [{ start_fraction: 0.36, end_fraction: 0.69 }]
    : mapped.filter((lesion) => lesion.diameter_stenosis_percent !== 0);
  const curve = new THREE.CatmullRomCurve3(routes[vessel].points);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(...VIEW_DIRECTIONS[vessel]).multiplyScalar(4);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const projected = (fraction: number) => curve.getPointAt(fraction).project(camera);
  // Rotate the same artery projection into a compact longitudinal cutaway.
  // This is a schematic orientation, not a new patient-specific vessel route.
  const axis = projected(1).sub(projected(0));
  const angle = -Math.atan2(axis.y, axis.x);
  // Unroll arc length horizontally and retain smoothed projected curvature.
  // A thickened literal projection can self-intersect where LCX turns behind
  // the heart. This schematic deliberately does not reproduce surface jitter.
  const schematic = new THREE.CatmullRomCurve3(Array.from({ length: 7 }, (_, i) => {
    const fraction = i / 6, p = projected(fraction);
    return new THREE.Vector3(fraction * axis.length(), p.x * Math.sin(angle) + p.y * Math.cos(angle), 0);
  }));
  const project = (fraction: number) => schematic.getPoint(fraction);
  // Include exact lesion boundaries and centers, including very short lesions.
  const fractions = [...new Set([
    ...Array.from({ length: 161 }, (_, i) => i / 160),
    ...[...mapped, ...plaqueSegments].flatMap((lesion) => Array.from({ length: 25 }, (_, i) =>
      lesion.start_fraction + (lesion.end_fraction - lesion.start_fraction) * i / 24)),
  ])].sort((a, b) => a - b);
  const points = fractions.map(project);
  const minX = Math.min(...points.map((p) => p.x)), maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)), maxY = Math.max(...points.map((p) => p.y));
  const scale = Math.min(224 / Math.max(maxX - minX, 0.01), 62 / Math.max(maxY - minY, 0.01));
  const toScreen = (p: THREE.Vector3) => ({ x: 150 + (p.x - (minX + maxX) / 2) * scale, y: 62 - (p.y - (minY + maxY) / 2) * scale });
  const samples = points.map((p, i) => {
    const point = toScreen(p);
    const before = toScreen(project(Math.max(0, fractions[i] - 0.0001)));
    const after = toScreen(project(Math.min(1, fractions[i] + 0.0001)));
    const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
    return { ...point, t: fractions[i], nx: -(after.y - before.y) / length, ny: (after.x - before.x) / length };
  });
  const path = (values: { x: number; y: number }[]) => values.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const ribbon = (subset: typeof samples) => {
    const edge = (side: number) => subset.map((p) => {
      const width = LUMEN_RADIUS * lumenRadiusFraction(p.t, lesions) * side;
      return { x: p.x + p.nx * width, y: p.y + p.ny * width };
    });
    return `${path([...edge(1), ...edge(-1).reverse()])} Z`;
  };
  const plaques = plaqueSegments.flatMap((segment) => {
    const subset = samples.filter((p) => p.t >= segment.start_fraction && p.t <= segment.end_fraction);
    const measured = "diameter_stenosis_percent" in segment && segment.diameter_stenosis_percent !== undefined;
    // Follow the inner wall, filling the space up to the existing measured
    // lumen where available. Otherwise show a modest, one-sided example bulge.
    // No plaque segmentation, composition or volume is inferred.
    return (measured ? [1, -1] : [1]).map((side) => {
      const edge = (inner: boolean) => subset.map((p) => {
        const progress = (p.t - segment.start_fraction) / (segment.end_fraction - segment.start_fraction);
        const radius = lumenRadiusFraction(p.t, lesions);
        const depth = measured ? LUMEN_RADIUS * (1 - radius)
          : LUMEN_RADIUS * .98 * Math.sin(Math.PI * progress) ** 1.4 * (.92 + .08 * Math.cos(6 * Math.PI * progress));
        const width = side * (LUMEN_RADIUS - (inner ? depth : 0));
        return { x: p.x + p.nx * width, y: p.y + p.ny * width };
      });
      return { path: `${path([...edge(false), ...edge(true).reverse()])} Z`, cap: path(edge(true)) };
    });
  });
  return {
    plaques, plaqueIsExample,
    viewBox: "0 0 300 124",
    centerline: path(samples), lumen: ribbon(samples), start: samples[0], end: samples.at(-1)!,
    wallHighlight: path(samples.map((p) => ({ x: p.x - p.nx * (WALL_RADIUS - 3), y: p.y - p.ny * (WALL_RADIUS - 3) }))),
    wallRim: path(samples.map((p) => ({ x: p.x + p.nx * (WALL_RADIUS - 2), y: p.y + p.ny * (WALL_RADIUS - 2) }))),
    ends: [samples[0], samples.at(-1)!].map((p) => ({ ...p, angle: Math.atan2(-p.nx, p.ny) * 180 / Math.PI })),
    markers: lesions.flatMap((lesion, index) => {
      if (!hasMappedLocation(lesion)) return [];
      const midpoint = toScreen(project((lesion.start_fraction + lesion.end_fraction) / 2));
      return [{ index, ...midpoint, labelX: Math.min(288, midpoint.x + 22), labelY: midpoint.y < 36 ? midpoint.y + 22 : midpoint.y - 22,
        path: ribbon(samples.filter((p) => p.t >= lesion.start_fraction && p.t <= lesion.end_fraction)),
      }];
    }),
  };
}
