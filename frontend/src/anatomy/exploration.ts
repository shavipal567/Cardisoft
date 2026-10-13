import type { Vessel } from "../api";

export type View = "Anterior" | "Left lateral" | "Posterior" | "Right lateral";
export const VIEWS: Record<View, [number, number, number]> = {
  Anterior: [0, 0.1, 4.5], "Left lateral": [4.5, 0.1, 0],
  Posterior: [0, 0.1, -4.5], "Right lateral": [-4.5, 0.1, 0],
};

// Educational callouts use the supplied part bounds where possible. They label
// visible structures; they do not claim chamber segmentation or patient anatomy.
// Seeds are projected onto the actual mesh along their outward normal once loaded.
export const ANATOMY_LANDMARKS: { id: string; label: string; seed: [number, number, number]; normal: [number, number, number]; parts?: string[]; edge?: "center" | "inferior" }[] = [
  { id: "aorta", label: "Ascending aorta", seed: [0, 0.62, 0], normal: [0, 0, 1], parts: ["Ascending aorta proper"] },
  { id: "pulmonary", label: "Pulmonary trunk", seed: [0.30, 0.30, 0], normal: [0, 0, 1], parts: ["Pulmonary trunk proper"] },
  { id: "ra", label: "Right atrium", seed: [-0.45, 0.0, 0], normal: [-0.5, 0, 1], parts: ["Anterior wall proper of right atrium"] },
  { id: "rv", label: "Right ventricle outflow", seed: [-0.08, -0.55, 0], normal: [0, 0, 1], parts: ["Wall of outflow part of right ventricle"] },
  { id: "lv", label: "Left ventricle", seed: [0.50, -0.62, 0], normal: [1, 0, 0.6], parts: ["Free wall of left ventricle"] },
  { id: "la", label: "Left atrium (posterior)", seed: [0.10, -0.02, 0], normal: [0, 0, -1], parts: ["Posterior wall of left atrium"] },
  { id: "apex", label: "Apex", seed: [0.20, -1.02, 0], normal: [0, -1, 0], parts: ["Free wall of left ventricle"], edge: "inferior" },
  { id: "left-auricle", label: "Left auricle", seed: [0.45, 0.25, 0], normal: [0, 0, 1], parts: ["Wall of left auricle"] },
  { id: "right-auricle", label: "Right auricle", seed: [-0.35, 0.35, 0], normal: [0, 0, 1], parts: ["Wall of right auricle proper"] },
  { id: "coronary-sinus", label: "Coronary sinus", seed: [0.25, -0.25, 0], normal: [0, 0, -1], parts: ["Coronary sinus"] },
  { id: "great-cardiac-vein", label: "Great cardiac vein", seed: [0.40, -0.2, 0], normal: [0, 0, 1], parts: ["Great cardiac vein"] },
];

export const ANATOMY_TOUR: { title: string; view: View; vessel?: Vessel; text: string }[] = [
  { title: "Meet the heart", view: "Anterior", text: "The front view shows the right ventricle prominently. The aorta and pulmonary trunk leave the upper heart; the apex is its lower tip. Callouts follow the supplied anatomical part meshes." },
  { title: "Follow the LAD", view: "Anterior", vessel: "LAD", text: "Inspect the supplied model's LAD and its included branches. The entire LAD tree uses one colour for its vessel-level estimate; no lesion location is predicted." },
  { title: "Around the left side", view: "Left lateral", vessel: "LCX", text: "The left circumflex follows the groove between the left atrium and left ventricle, curving toward the back. This side view helps reveal its course." },
  { title: "Behind the heart", view: "Posterior", vessel: "LCX", text: "The left atrium lies toward the back of the heart. Follow the circumflex toward this posterior surface; hidden front-facing labels are suppressed." },
  { title: "Follow the RCA", view: "Right lateral", vessel: "RCA", text: "Inspect the supplied model's RCA and its included branches. The entire RCA tree uses one colour for its vessel-level estimate; no lesion location is predicted." },
];
