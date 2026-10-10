import type { Vessel } from "../api";

export type View = "Anterior" | "Left lateral" | "Posterior" | "Right lateral";
export const VIEWS: Record<View, [number, number, number]> = {
  Anterior: [0, 0.1, 4.5], "Left lateral": [4.5, 0.1, 0],
  Posterior: [0, 0.1, -4.5], "Right lateral": [-4.5, 0.1, 0],
};

// Approximate external regions in registerHeart coordinates. These are manually
// registered educational landmarks, not segmentation of the asset's chambers.
// Seeds are projected onto the actual mesh along their outward normal once loaded.
export const ANATOMY_LANDMARKS: { id: string; label: string; seed: [number, number, number]; normal: [number, number, number] }[] = [
  { id: "aorta", label: "Aorta", seed: [0, 0.62, 0], normal: [0, 0, 1] },
  { id: "pulmonary", label: "Pulmonary trunk", seed: [0.30, 0.30, 0], normal: [0, 0, 1] },
  { id: "ra", label: "Right atrium", seed: [-0.45, 0.0, 0], normal: [-0.5, 0, 1] },
  { id: "rv", label: "Right ventricle", seed: [-0.08, -0.55, 0], normal: [0, 0, 1] },
  { id: "lv", label: "Left ventricle", seed: [0.50, -0.62, 0], normal: [1, 0, 0.6] },
  { id: "la", label: "Left atrium", seed: [0.10, -0.02, 0], normal: [0, 0, -1] },
  { id: "apex", label: "Apex", seed: [0.20, -1.02, 0], normal: [0, -1, 0] },
];

export const ANATOMY_TOUR: { title: string; view: View; vessel?: Vessel; text: string }[] = [
  { title: "Meet the heart", view: "Anterior", text: "The front view shows the right ventricle prominently. The aorta and pulmonary trunk leave the upper heart; the apex is its lower tip. Labels mark approximate external regions." },
  { title: "Follow the LAD", view: "Anterior", vessel: "LAD", text: "The left anterior descending artery follows the groove between the ventricles toward the apex. The LAD reference path is emphasized; the other arteries are dimmed." },
  { title: "Around the left side", view: "Left lateral", vessel: "LCX", text: "The left circumflex follows the groove between the left atrium and left ventricle, curving toward the back. This side view helps reveal its course." },
  { title: "Behind the heart", view: "Posterior", vessel: "LCX", text: "The left atrium lies toward the back of the heart. Follow the circumflex toward this posterior surface; hidden front-facing labels are suppressed." },
  { title: "Follow the RCA", view: "Right lateral", vessel: "RCA", text: "The right coronary artery follows the groove between the right atrium and right ventricle toward the posterior heart. These are reference routes, not locations of patient-specific lesions." },
];
