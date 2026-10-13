import * as THREE from "three";
import { vesselRadius } from "./registration";

export function taperedTube(points: THREE.Vector3[], proximal = .019, distal = .0085, extra = 0) {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const segments = Math.max(64, points.length * 2), radial = 12;
  const geometry = new THREE.TubeGeometry(curve, segments, 1, radial, false);
  const position = geometry.getAttribute("position");
  const vertex = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, center = curve.getPointAt(t);
    const radius = vesselRadius(t, proximal, distal) + extra;
    for (let j = 0; j <= radial; j++) {
      const index = i * (radial + 1) + j;
      vertex.fromBufferAttribute(position, index).sub(center).multiplyScalar(radius).add(center);
      position.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
