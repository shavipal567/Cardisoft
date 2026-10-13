import * as THREE from "three";
import type { Vessel } from "../api";
import parts from "./heartParts.json";
import frame from "./heartPartsFrame.json";

const center = frame.min.map((value, axis) => (value + frame.max[axis]) / 2);
const rawBounds = Object.fromEntries((["LAD", "LCX", "RCA"] as const).map((vessel) => {
  const trunks = parts.filter((part) => part.vessel === vessel && part.name.toLowerCase().includes("trunk of") && part.bounds);
  const min = [0, 1, 2].map((axis) => Math.min(...trunks.map((part) => part.bounds![0][axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...trunks.map((part) => part.bounds![1][axis])));
  return [vessel, min.map((value, axis) => (value + max[axis]) / 2)];
})) as Record<Vessel, number[]>;

function registered(point: number[]) {
  return new THREE.Vector3(
    (point[0] - center[0]) * frame.scale,
    (point[2] - center[2]) * frame.scale,
    -(point[1] - center[1]) * frame.scale,
  );
}

export function heartPartAnchor(names: string[], edge: "center" | "inferior" = "center"): THREE.Vector3 | null {
  const matches = parts.filter((part) => names.includes(part.name) && part.bounds);
  if (!matches.length) return null;
  const min = [0, 1, 2].map((axis) => Math.min(...matches.map((part) => part.bounds![0][axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...matches.map((part) => part.bounds![1][axis])));
  const point = min.map((value, axis) => edge === "inferior" && axis === 2 ? value : (value + max[axis]) / 2);
  return registered(point);
}

const outward: Record<Vessel, THREE.Vector3> = {
  LAD: new THREE.Vector3(0, 0, 1), LCX: new THREE.Vector3(1, 0, 0), RCA: new THREE.Vector3(-1, 0, 0),
};

export const HEART_PART_ANCHORS = Object.fromEntries((["LAD", "LCX", "RCA"] as const).map((vessel) => [vessel, {
  anchor: registered(rawBounds[vessel]),
  normal: outward[vessel],
}])) as Record<Vessel, { anchor: THREE.Vector3; normal: THREE.Vector3 }>;
export const HEART_PART_CENTERS = Object.fromEntries((["LAD", "LCX", "RCA"] as const).map((vessel) =>
  [vessel, HEART_PART_ANCHORS[vessel].anchor.clone()])) as Record<Vessel, THREE.Vector3>;
