import * as THREE from "three";

// Cut planes registered to the large exposed vessel ends in heart.glb.
// Coordinates use registerHeart's frame. Small coronary surface vessels are excluded.
type Opening = {
  vessel: "aortic" | "pulmonary" | "caval" | "upperVenous" | "pulmonaryVenous";
  center: [number, number, number]; axis: [number, number, number];
  radius: number; depth: number; path?: [number, number, number][];
};
const OPENINGS: Opening[] = [
  { vessel: "aortic", center: [-0.121, 1.151, 0.107], axis: [-0.232, 0.952, 0.199], radius: 0.115, depth: 0.30 },
  { vessel: "aortic", center: [0.115, 1.158, -0.013], axis: [0, 1, 0], radius: 0.10, depth: 0.28 },
  { vessel: "aortic", center: [0.250, 1.145, -0.177], axis: [0.09, 0.995, -0.032], radius: 0.10, depth: 0.30 },
  // The model exposes one pulmonary artery outlet on the patient's left.
  { vessel: "pulmonary", center: [0.598, 0.457, -0.098], axis: [1, 0, 0], radius: 0.13, depth: 0.75,
    path: [[0.598, 0.457, -0.098], [0.46, 0.457, -0.098], [0.34, 0.425, 0.025],
      [0.25, 0.34, 0.16], [0.20, 0.20, 0.28], [0.17, 0.08, 0.31]],
  },
  { vessel: "caval", center: [-0.378, 1.168, 0.058], axis: [0, 1, 0], radius: 0.15, depth: 1.1,
    path: [[-0.378, 1.168, 0.058], [-0.382, 0.97, 0.055], [-0.41, 0.69, 0.03],
      [-0.46, 0.42, -0.015], [-0.50, 0.08, -0.06]],
  },
  { vessel: "caval", center: [-0.417, -1.075, 0], axis: [0, -1, 0], radius: 0.16, depth: 1.05,
    path: [[-0.417, -1.075, 0], [-0.422, -0.88, 0], [-0.455, -0.64, -0.01],
      [-0.51, -0.38, -0.045], [-0.52, -0.03, -0.04]],
  },
  { vessel: "upperVenous", center: [-0.05, 0.995, 0.273], axis: [0.88, 0.18, 0.4], radius: 0.11, depth: 0.58,
    path: [[-0.05, 0.995, 0.273], [-0.18, 0.968, 0.214], [-0.30, 0.89, 0.12],
      [-0.38, 0.73, 0.06], [-0.4, 0.55, 0.04]],
  },
  { vessel: "pulmonaryVenous", center: [0.667, 0.251, -0.264], axis: [1, 0, 0], radius: 0.10, depth: 0.50,
    path: [[0.667, 0.251, -0.264], [0.50, 0.251, -0.264], [0.34, 0.20, -0.29], [0.20, 0.12, -0.29]],
  },
  { vessel: "pulmonaryVenous", center: [0.697, 0.071, -0.298], axis: [1, 0, 0], radius: 0.095, depth: 0.52,
    path: [[0.697, 0.071, -0.298], [0.53, 0.071, -0.298], [0.36, 0.01, -0.31], [0.23, -0.12, -0.28]],
  },
];

type CutVertex = { index: number; point: THREE.Vector3; distance: number };

/** Open the large vessel caps and join their cut edges to an uncapped inner lining.
 * Only replacement geometries are owned here; useGLTF's shared asset is untouched.
 */
export function hollowMajorVessels(heart: THREE.Object3D) {
  const geometries: THREE.BufferGeometry[] = [];
  const linings = new Map(Object.entries({
    aortic: { name: "Aortic branch inner wall", color: "#bc6973" },
    pulmonary: { name: "Pulmonary artery inner wall", color: "#438bad" },
    caval: { name: "Vena cava inner wall", color: "#438bad" },
    upperVenous: { name: "Upper venous branch inner wall", color: "#438bad" },
    pulmonaryVenous: { name: "Pulmonary vein inner wall", color: "#bc6973" },
  }).map(([vessel, { name, color }]) => [vessel, {
    name, material: new THREE.MeshStandardMaterial({
      color, roughness: 0.95, metalness: 0, vertexColors: true, side: THREE.FrontSide,
    }),
  }]));
  heart.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  heart.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });

  for (const opening of OPENINGS) {
    const center = new THREE.Vector3(...opening.center);
    const axis = new THREE.Vector3(...opening.axis).normalize();
    const edge = new Map<string, THREE.Vector3>();
    for (const mesh of meshes) {
      const source = mesh.geometry;
      const position = source.getAttribute("position");
      const index = source.getIndex();
      if (!index) continue;
      const world = new THREE.Vector3();
      const relative = new THREE.Vector3();
      const distances = new Float64Array(position.count);
      const nearby = new Uint8Array(position.count);
      let intersects = false;
      for (let i = 0; i < position.count; i++) {
        world.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        relative.subVectors(world, center);
        const distance = relative.dot(axis);
        distances[i] = distance;
        nearby[i] = Number(relative.lengthSq() - distance * distance < opening.radius ** 2);
        if (nearby[i] && distance > 0) intersects = true;
      }
      if (!intersects) continue;

      const attributes = Object.entries(source.attributes);
      const additions = new Map(attributes.map(([name]) => [name, [] as number[]]));
      const kept: number[] = [];
      const intersections = new Map<string, CutVertex>();
      let vertexCount = position.count;
      const vertex = (i: number): CutVertex => ({
        index: i, distance: distances[i],
        point: new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld),
      });
      const intersect = (a: CutVertex, b: CutVertex): CutVertex => {
        const key = `${Math.min(a.index, b.index)}:${Math.max(a.index, b.index)}`;
        const previous = intersections.get(key);
        if (previous) return previous;
        const t = a.distance / (a.distance - b.distance);
        const point = a.point.clone().lerp(b.point, t);
        const result = { index: vertexCount++, point, distance: 0 };
        for (const [name, attribute] of attributes) {
          const values = additions.get(name)!;
          for (let component = 0; component < attribute.itemSize; component++) {
            values.push(THREE.MathUtils.lerp(
              attribute.getComponent(a.index, component), attribute.getComponent(b.index, component), t,
            ));
          }
        }
        intersections.set(key, result);
        // GLB mesh chunks can share the same cut edge. Weld it in world space.
        edge.set(point.toArray().map((v) => v.toFixed(6)).join(","), point);
        return result;
      };

      for (let i = 0; i < index.count; i += 3) {
        const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
        if (!(nearby[a] && nearby[b] && nearby[c]) ||
            (distances[a] <= 0 && distances[b] <= 0 && distances[c] <= 0)) {
          kept.push(a, b, c);
          continue;
        }
        if (distances[a] > 0 && distances[b] > 0 && distances[c] > 0) continue;
        const triangle = [vertex(a), vertex(b), vertex(c)];
        const polygon: CutVertex[] = [];
        for (let j = 0; j < 3; j++) {
          const from = triangle[j], to = triangle[(j + 1) % 3];
          if (from.distance <= 0) polygon.push(from);
          if ((from.distance <= 0) !== (to.distance <= 0)) polygon.push(intersect(from, to));
        }
        for (let j = 1; j < polygon.length - 1; j++) {
          kept.push(polygon[0].index, polygon[j].index, polygon[j + 1].index);
        }
      }
      if (kept.length === index.count && !intersections.size) continue;
      const geometry = source.clone();
      for (const [name, attribute] of attributes) {
        // Some GLB accessors are interleaved; copy their components explicitly.
        const values = new Float32Array(vertexCount * attribute.itemSize);
        for (let i = 0; i < attribute.count; i++) {
          for (let c = 0; c < attribute.itemSize; c++) values[i * attribute.itemSize + c] = attribute.getComponent(i, c);
        }
        values.set(additions.get(name)!, attribute.count * attribute.itemSize);
        geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
      }
      geometry.setIndex(kept);
      mesh.geometry = geometry;
      geometries.push(geometry);
    }

    if (edge.size < 3) continue;
    // A lateral outlet can be parallel to X. Choose a nonparallel seed so its
    // rim has a stable angular order just like the superior aortic openings.
    const u = (Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0))
      .projectOnPlane(axis).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u);
    const angle = (p: THREE.Vector3) => {
      const relative = p.clone().sub(center);
      return Math.atan2(relative.dot(v), relative.dot(u));
    };
    const rim = [...edge.values()].sort((a, b) => angle(a) - angle(b));
    const path = opening.path ? new THREE.CatmullRomCurve3(opening.path.map((p) => new THREE.Vector3(...p))) : null;
    // A rounded annular lip, then a wall extending into the vessel. Both the
    // mouth and deep end remain open: no disk is used to simulate a lumen.
    const rings = [
      { inset: 1, depth: 0, shade: 1 },
      { inset: 0.97, depth: -0.002, shade: 1 },
      { inset: 0.82, depth: 0, shade: 0.90 },
      { inset: 0.77, depth: 0.007, shade: 0.75 },
      { inset: 0.77, depth: 0.04, shade: 0.55 },
      { inset: 0.78, depth: 0.12, shade: 0.32 },
      ...(path ? Array.from({ length: 12 }, (_, i) => {
        const t = (i + 1) / 12;
        return { inset: THREE.MathUtils.lerp(0.78, 0.65, t), depth: THREE.MathUtils.lerp(0.12, opening.depth, t),
          shade: THREE.MathUtils.lerp(0.32, 0.16, t) };
      }) : [{ inset: 0.82, depth: opening.depth, shade: 0.16 }]),
    ];
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    for (const ring of rings) {
      const t = Math.max(0, ring.depth / opening.depth);
      const ringCenter = path && ring.depth > 0 ? path.getPointAt(t) : center.clone().addScaledVector(axis, -ring.depth);
      const rotation = path && ring.depth > 0
        ? new THREE.Quaternion().setFromUnitVectors(axis, path.getTangentAt(t).negate()) : new THREE.Quaternion();
      for (const point of rim) {
        const p = point.clone().sub(center).multiplyScalar(ring.inset).applyQuaternion(rotation).add(ringCenter);
        positions.push(...p.toArray());
        colors.push(ring.shade, ring.shade, ring.shade);
      }
    }
    for (let ring = 0; ring < rings.length - 1; ring++) {
      for (let i = 0; i < rim.length; i++) {
        const next = (i + 1) % rim.length;
        const a = ring * rim.length + i, b = ring * rim.length + next;
        const c = b + rim.length, d = a + rim.length;
        indices.push(a, b, d, b, c, d);
      }
    }
    const lining = new THREE.BufferGeometry();
    lining.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    lining.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    lining.setIndex(indices);
    lining.computeVertexNormals();
    // The ring coordinates above are registered world coordinates, while the
    // heart group itself carries the asset's orientation transform.
    lining.applyMatrix4(heart.matrixWorld.clone().invert());
    const appearance = linings.get(opening.vessel)!;
    const lumen = new THREE.Mesh(lining, appearance.material);
    lumen.name = appearance.name;
    heart.add(lumen);
    geometries.push(lining);
  }
  heart.updateMatrixWorld(true);
  return { dispose: () => {
    geometries.forEach((geometry) => geometry.dispose());
    linings.forEach(({ material }) => material.dispose());
  } };
}
