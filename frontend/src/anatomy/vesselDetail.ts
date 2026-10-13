import * as THREE from "three";
import type { Vessel } from "../api";
import { loadCoronaries } from "./coronary";

const routes = loadCoronaries().routes;
const VIEW_DIRECTIONS: Record<Vessel, [number, number, number]> = {
  LAD: [0, 0, 1], LCX: [1, 0, 0], RCA: [-1, 0, 0],
};

/** Projection of the reference route only: no lesion, plaque or lumen inference. */
export function vesselDetail(vessel: Vessel) {
  const curve = new THREE.CatmullRomCurve3(routes[vessel].points);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10);
  camera.position.set(...VIEW_DIRECTIONS[vessel]).multiplyScalar(4);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const points = curve.getSpacedPoints(96).map((p) => p.project(camera));
  const box = new THREE.Box3().setFromPoints(points);
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const scale = Math.min(240 / Math.max(size.x, .01), 96 / Math.max(size.y, .01));
  const centerline = points.map((p, i) => `${i ? "L" : "M"}${(150 + (p.x - center.x) * scale).toFixed(2)},${(62 - (p.y - center.y) * scale).toFixed(2)}`).join(" ");
  return { centerline, viewBox: "0 0 300 124" };
}
