import { useMemo } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ANATOMY_LANDMARKS } from "../anatomy/exploration";

// One DOM overlay shares the viewport coordinate system with the export canvas.
export type AnatomyOverlayRef = RefObject<HTMLDivElement | null>;
export function AnatomyProjection({ heart, overlay }: { heart: THREE.Object3D; overlay: AnatomyOverlayRef }) {
  const landmarks = useMemo(() => {
    const ray = new THREE.Raycaster();
    return ANATOMY_LANDMARKS.map((landmark) => {
      const normal = new THREE.Vector3(...landmark.normal).normalize();
      const seed = new THREE.Vector3(...landmark.seed);
      ray.set(seed.clone().addScaledVector(normal, 3), normal.clone().negate());
      const hit = ray.intersectObject(heart, true)[0];
      return { ...landmark, normal, anchor: hit?.point.clone().addScaledVector(normal, 0.025) };
    });
  }, [heart]);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const root = overlay.current;
    if (!root) return;
    camera.updateMatrixWorld();
    const rows: { element: HTMLElement; line: SVGLineElement; x: number; y: number; left: boolean }[] = [];
    for (const landmark of landmarks) {
      const element = root.querySelector<HTMLElement>(`[data-landmark="${landmark.id}"]`)!;
      const line = root.querySelector<SVGLineElement>(`[data-line="${landmark.id}"]`)!;
      if (!landmark.anchor) { element.style.visibility = "hidden"; line.style.visibility = "hidden"; continue; }
      projected.copy(landmark.anchor).project(camera);
      direction.subVectors(camera.position, landmark.anchor).normalize();
      const visible = (landmark.id === "apex" || direction.dot(landmark.normal) > 0.12) && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && Math.abs(projected.z) < 1;
      element.style.visibility = visible ? "visible" : "hidden";
      line.style.visibility = visible ? "visible" : "hidden";
      if (visible) rows.push({ element, line, x: (projected.x + 1) * size.width / 2, y: (1 - projected.y) * size.height / 2, left: projected.x < 0 });
    }
    const bounds = root.getBoundingClientRect();
    const occupied = [...root.parentElement!.querySelectorAll<HTMLElement>(".coronary-label")]
      .filter((element) => getComputedStyle(element).visibility !== "hidden")
      .map((element) => { const box = element.getBoundingClientRect(); return { x: box.left - bounds.left, y: box.top - bounds.top, width: box.width, height: box.height }; });
    for (const row of rows.sort((a, b) => a.y - b.y)) {
      const width = row.element.offsetWidth, height = row.element.offsetHeight;
      const x = row.left ? 8 : size.width - width - 8;
      const ideal = THREE.MathUtils.clamp(row.y, 70, size.height - 85);
      // Keep callouts clear of artery buttons, including on narrow phone screens.
      const candidates = Array.from({ length: Math.max(1, Math.floor((size.height - 155) / 4)) }, (_, i) => 70 + i * 4)
        .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal));
      const y = candidates.find((candidate) => occupied.every((box) =>
        x + width + 6 <= box.x || x >= box.x + box.width + 6 || candidate + height + 6 <= box.y || candidate >= box.y + box.height + 6)) ?? ideal;
      row.element.style.left = `${x}px`; row.element.style.top = `${y}px`;
      row.line.setAttribute("x1", String(row.x)); row.line.setAttribute("y1", String(row.y));
      row.line.setAttribute("x2", String(row.left ? x + width : x)); row.line.setAttribute("y2", String(y + height / 2));
      occupied.push({ x, y, width, height });
    }
  });
  return null;
}

export default function AnatomyLabels({ overlay }: { overlay: AnatomyOverlayRef }) {
  return <div ref={overlay} className="anatomy-overlay" aria-label="Illustrative anatomy labels">
    <svg aria-hidden="true">{ANATOMY_LANDMARKS.map(({ id }) => <line key={id} data-line={id} />)}</svg>
    {ANATOMY_LANDMARKS.map(({ id, label }) => <span key={id} data-landmark={id} data-export-label className="anatomy-label">{label}</span>)}
  </div>;
}
