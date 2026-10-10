import * as THREE from "three";
import type { Vessel } from "../api";

// Registration for public/heart.glb, not a generic ellipsoid. In this asset the
// anterior face points along +X. After registration: +X = patient's left,
// +Y = superior, +Z = anterior. Preserve the asset's existing apical tilt.
export function registerHeart(source: THREE.Object3D): THREE.Group {
  const model = source.clone(true);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const scale = 2.4 / box.getSize(new THREE.Vector3()).y;
  const centered = new THREE.Group();
  centered.add(model);
  model.position.sub(box.getCenter(new THREE.Vector3()));
  centered.scale.setScalar(scale);
  const registered = new THREE.Group();
  registered.add(centered);
  registered.rotation.y = -Math.PI / 2;
  registered.updateMatrixWorld(true);
  return registered;
}

// Manually registered landmarks on this illustrative mesh. Fourth component
// is the outward ray angle: 0 anterior, +PI/2 left, -PI/2 right, PI posterior.
// Surface projection is done AFTER interpolation so tubes follow the mesh.
// LAD: anterior interventricular groove, ending at the ventricular apex.
// LCX: left AV groove beneath the left auricle, around the obtuse margin.
// RCA: right AV groove beneath the right auricle, around the acute margin.
// RCA ends at the posterior crux; it is not drawn as if the PDA were its trunk.
type Landmark = [number, number, number, number];
const ROUTES: Record<Vessel, Landmark[]> = {
  LAD: [
    [0.29, 0.10, 0.4, 0], [0.34, -0.13, 0.4, 0],
    [0.34, -0.35, 0.4, 0], [0.28, -0.61, 0.4, 0],
    [0.23, -0.85, 0.3, 0], [0.20, -1.09, 0.2, 0],
  ],
  LCX: [
    [0.29, 0.10, 0.4, 0], [0.42, -0.06, 0.4, 0.35],
    [0.58, -0.16, 0.26, 0.85], [0.65, -0.20, 0.02, Math.PI / 2],
    [0.52, -0.28, -0.28, 2.15], [0.32, -0.38, -0.45, 2.75],
    [0.13, -0.44, -0.5, Math.PI],
  ],
  RCA: [
    [-0.12, 0.08, 0.4, 0], [-0.27, -0.09, 0.4, -0.2],
    [-0.43, -0.29, 0.35, -0.45], [-0.57, -0.48, 0.23, -0.9],
    [-0.62, -0.50, 0, -Math.PI / 2], [-0.48, -0.46, -0.3, -2.1],
    [-0.25, -0.47, -0.5, -2.7], [-0.02, -0.51, -0.5, -Math.PI],
  ],
};

export const VESSELS: Vessel[] = ["LAD", "LCX", "RCA"];
export const VESSEL_META: Record<Vessel, { full: string; course: string }> = {
  LAD: { full: "Left anterior descending", course: "Anterior interventricular groove → apex" },
  LCX: { full: "Left circumflex", course: "Left AV groove → lateral and posterior heart" },
  RCA: { full: "Right coronary artery", course: "Right AV groove → posterior crux" },
};
export const LABEL_FRACTION: Record<Vessel, number> = { LAD: 0.52, LCX: 0.43, RCA: 0.38 };
export const ARTERY_RADIUS = 0.018;
export const SURFACE_OFFSET = 0.022;

export function buildCoronaries(heart: THREE.Object3D) {
  heart.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const meshes: THREE.Mesh[] = [];
  heart.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
  const routes = Object.fromEntries(VESSELS.map((name) => {
    const landmarks = ROUTES[name];
    const seeds = new THREE.CatmullRomCurve3(landmarks.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const angles = new THREE.CatmullRomCurve3(landmarks.map((point) => new THREE.Vector3(point[3], 0, 0)));
    const points: THREE.Vector3[] = [];
    const normals: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) {
      const t = i / 96;
      const seed = seeds.getPoint(t);
      const angle = angles.getPoint(t).x;
      const outward = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
      raycaster.set(seed.clone().addScaledVector(outward, 3), outward.clone().negate());
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (!hit?.face) throw new Error(`Cannot register ${name} on the heart surface`);
      // Offset along the casting ray: irregular vein/texture geometry must
      // not redirect the centreline sideways into an adjacent triangle.
      const normal = outward;
      points.push(hit.point.clone().addScaledVector(normal, SURFACE_OFFSET));
      normals.push(normal);
    }
    return [name, { points, normals }];
  })) as Record<Vessel, { points: THREE.Vector3[]; normals: THREE.Vector3[] }>;

  // A single left-main bifurcation, rather than disconnected LAD/LCX origins.
  routes.LCX.points[0].copy(routes.LAD.points[0]);
  const bifurcation = routes.LAD.points[0];
  const leftMain = [new THREE.Vector3(0.10, 0.23, 0.12), new THREE.Vector3(0.20, 0.16, 0.26), bifurcation.clone()];
  const rightOrigin = [new THREE.Vector3(-0.12, 0.23, 0.12), routes.RCA.points[0].clone()];
  return { routes, leftMain, rightOrigin };
}
