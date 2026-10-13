import { useMemo } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Vessel } from "../api";
import { VESSELS } from "../anatomy/coronary";
import { HEART_PART_ANCHORS } from "../anatomy/heartPartAnchors";

export type LabelElements = RefObject<Partial<Record<Vessel, HTMLButtonElement>>>;
export default function VesselLabels({ labels, leaders, transparent }: {
  labels: LabelElements; leaders: RefObject<SVGSVGElement | null>; transparent: boolean;
}) {
  const anchors = useMemo(() => {
    return VESSELS.map((name) => {
      const { anchor, normal } = HEART_PART_ANCHORS[name];
      const position = anchor.clone().addScaledVector(normal, .3);
      position.x += name === "RCA" ? -.18 : .18;
      if (name === "LCX") position.y += .1;
      return { name, anchor, position, normal };
    });
  }, []);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld();
    const occupied: { x: number; y: number; w: number; h: number }[] = [];
    for (const { name, anchor, position, normal } of anchors) {
      const label = labels.current[name], line = leaders.current?.querySelector(`[data-vessel="${name}"]`);
      if (!label || !line) continue;
      projected.copy(anchor).project(camera);
      direction.subVectors(camera.position, anchor).normalize();
      // Conservative surface-facing culling avoids raycasting a million-triangle
      // mesh every animation frame. No occlusion query is needed on transparent anatomy.
      const visible = Math.abs(projected.z) < 1 && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1
        && (transparent || direction.dot(normal) > .14);
      // DOM refs are intentionally updated outside React during R3F frames.
      label.style.setProperty("visibility", visible ? "visible" : "hidden");
      line.setAttribute("visibility", visible ? "visible" : "hidden");
      if (!visible) continue;
      const ax = (projected.x + 1) * size.width / 2, ay = (1 - projected.y) * size.height / 2;
      projected.copy(position).project(camera);
      const w = label.offsetWidth, h = label.offsetHeight;
      const x = THREE.MathUtils.clamp((projected.x + 1) * size.width / 2, w / 2 + 8, size.width - w / 2 - 8);
      let y = THREE.MathUtils.clamp((1 - projected.y) * size.height / 2, 65 + h / 2, size.height - 80 - h / 2);
      for (const box of occupied) {
        if (Math.abs(x - box.x) < (w + box.w) / 2 + 8 && Math.abs(y - box.y) < (h + box.h) / 2 + 8) {
          y = THREE.MathUtils.clamp(box.y + (h + box.h) / 2 + 8, 65 + h / 2, size.height - 80 - h / 2);
        }
      }
      label.style.setProperty("left", `${x.toFixed(2)}px`); label.style.setProperty("top", `${y.toFixed(2)}px`);
      line.setAttribute("x1", String(ax)); line.setAttribute("y1", String(ay));
      line.setAttribute("x2", String(THREE.MathUtils.clamp(ax, x - w / 2, x + w / 2)));
      line.setAttribute("y2", String(THREE.MathUtils.clamp(ay, y - h / 2, y + h / 2)));
      occupied.push({ x, y, w, h });
    }
  }, -.5);
  return null;
}
