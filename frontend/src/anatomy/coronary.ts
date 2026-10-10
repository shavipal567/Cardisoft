import * as THREE from "three";
import type { Vessel } from "../api";
import registered from "./heart-coronaries.json";
export { ARTERY_RADIUS, LABEL_FRACTION, registerHeart, VESSELS, VESSEL_META } from "./registration";

// The million-triangle mesh is raycast offline, not on every patient assessment.
// Regenerate with `npm run anatomy:register` if the GLB or landmarks change.
export function loadCoronaries() {
  const vector = (point: number[]) => new THREE.Vector3(...point as [number, number, number]);
  return {
    routes: Object.fromEntries(Object.entries(registered.routes).map(([name, route]) => [name, {
      points: route.points.map(vector), normals: route.normals.map(vector),
    }])) as Record<Vessel, { points: THREE.Vector3[]; normals: THREE.Vector3[] }>,
    leftMain: registered.leftMain.map(vector),
    rightOrigin: registered.rightOrigin.map(vector),
  };
}
