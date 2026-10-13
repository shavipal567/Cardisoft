import type { Vessel } from "../api";

export interface AnatomyRegion {
  id: string;
  title: string;
  description: string;
  color: string;
}

const regions: Record<string, AnatomyRegion> = {
  LAD: { id: "LAD", title: "Left anterior descending artery (LAD)", color: "#FF453A", description: "The LAD descends along the front groove between the ventricles toward the apex. Its branches supply portions of the front of the heart and the interventricular septum. The colour represents one whole-vessel model estimate; it does not locate a narrowing." },
  LCX: { id: "LCX", title: "Left circumflex artery (LCX)", color: "#F4511E", description: "The LCX curves in the groove between the left atrium and ventricle, continuing around the left side toward the back. It commonly gives off branches to the lateral wall; its distal course varies with coronary anatomy." },
  RCA: { id: "RCA", title: "Right coronary artery (RCA)", color: "#D94343", description: "The RCA begins at the aorta and follows the groove between the right atrium and ventricle. Its branches supply parts of the right heart, and its distal branching pattern varies between people." },
  aorta: { id: "aorta", title: "Aorta", color: "#C94F4F", description: "The aorta is the main artery leaving the left ventricle. Its ascending portion carries oxygen-rich blood away from the heart before the aorta distributes it through the body." },
  pulmonary: { id: "pulmonary", title: "Pulmonary trunk", color: "#3267C8", description: "The pulmonary trunk leaves the right ventricle and carries oxygen-poor blood toward the lungs. It divides into the right and left pulmonary arteries." },
  rightAtrium: { id: "rightAtrium", title: "Right atrium", color: "#D9918A", description: "The right atrium receives blood returning from the body through the venae cavae, along with venous blood from the heart muscle. Blood then passes through the tricuspid valve into the right ventricle." },
  leftAtrium: { id: "leftAtrium", title: "Left atrium", color: "#CB8580", description: "The left atrium receives oxygen-rich blood returning from the lungs through the pulmonary veins. It passes blood through the mitral valve into the left ventricle." },
  rightAuricle: { id: "rightAuricle", title: "Right auricle", color: "#D9918A", description: "The right auricle is a small, ridged muscular pouch extending from the right atrium. It adds capacity to the atrium; it is distinct from the main atrial chamber." },
  leftAuricle: { id: "leftAuricle", title: "Left auricle", color: "#CB8580", description: "The left auricle is a small muscular pouch attached to the left atrium. Its folded inner surface is formed by pectinate muscles." },
  rightVentricle: { id: "rightVentricle", title: "Right ventricle", color: "#D58B86", description: "The right ventricle is the lower pumping chamber on the heart's right side. It sends blood through the pulmonary valve into the pulmonary trunk on its way to the lungs." },
  leftVentricle: { id: "leftVentricle", title: "Left ventricle", color: "#B85F60", description: "The left ventricle is the heart's thick-walled main pumping chamber. It sends oxygen-rich blood through the aortic valve into the aorta and systemic circulation." },
  septum: { id: "septum", title: "Cardiac septum", color: "#AD6665", description: "The septum is the wall between the right and left sides of the heart. The supplied model includes atrial and ventricular septal parts, including muscular and membranous tissue." },
  mitralValve: { id: "mitralValve", title: "Mitral valve", color: "#E8D8B5", description: "The mitral valve sits between the left atrium and left ventricle. It opens to let blood enter the ventricle and closes during contraction to limit backflow into the atrium." },
  tricuspidValve: { id: "tricuspidValve", title: "Tricuspid valve", color: "#E8D8B5", description: "The tricuspid valve sits between the right atrium and right ventricle. Its leaflets open for ventricular filling and close during contraction to limit backflow." },
  aorticValve: { id: "aorticValve", title: "Aortic valve", color: "#E8D8B5", description: "The aortic valve lies at the outlet of the left ventricle. It opens as the ventricle contracts and closes to help prevent blood returning from the aorta." },
  pulmonaryValve: { id: "pulmonaryValve", title: "Pulmonary valve", color: "#E8D8B5", description: "The pulmonary valve lies between the right ventricle and pulmonary trunk. It opens during right ventricular contraction and closes to help prevent blood flowing back." },
  coronarySinus: { id: "coronarySinus", title: "Coronary sinus", color: "#4B5DB5", description: "The coronary sinus is a large vein in the back of the heart, in the left atrioventricular groove. It collects blood from several cardiac veins and empties into the right atrium." },
  greatCardiacVein: { id: "greatCardiacVein", title: "Great cardiac vein", color: "#3979D6", description: "The great cardiac vein begins near the apex and travels up the front groove alongside the LAD. It curves around the left side and drains into the coronary sinus." },
  cardiacVeins: { id: "cardiacVeins", title: "Cardiac veins", color: "#3979D6", description: "Cardiac veins collect oxygen-poor blood from the heart muscle. Many drain into the coronary sinus, while some smaller veins empty directly into a heart chamber." },
  conduction: { id: "conduction", title: "Cardiac conduction system", color: "#D8C7A6", description: "This group includes the sinoatrial and atrioventricular nodes, internodal pathways, and conducting bundles. These specialized tissues initiate and carry electrical signals that coordinate the heartbeat." },
  fibrousSkeleton: { id: "fibrousSkeleton", title: "Fibrous skeleton", color: "#D8C7A6", description: "The fibrous skeleton is connective tissue around the heart's valve openings. It supports the valves and electrically separates most atrial muscle from ventricular muscle." },
  myocardium: { id: "myocardium", title: "Heart muscle and internal structures", color: "#C77B78", description: "The myocardium is the muscular wall that contracts to pump blood. This callout also covers supplied internal structures that do not have a more specific hover category; the model is a general reference, not a patient scan." },
};

export const ANATOMY_REGIONS = Object.values(regions);
export function regionForPart(name: string, vessel: Vessel | null): AnatomyRegion {
  if (vessel) return regions[vessel];
  const value = name.toLowerCase();
  if (value.includes("coronary sinus")) return regions.coronarySinus;
  if (value.includes("great cardiac vein")) return regions.greatCardiacVein;
  if (value.includes("vein")) return regions.cardiacVeins;
  if (value.includes("left auricle")) return regions.leftAuricle;
  if (value.includes("right auricle")) return regions.rightAuricle;
  if (value.includes("aortic valve") || value.includes("cusp of aortic valve") || value.includes("aortic valve anulus")) return regions.aorticValve;
  if (value.includes("pulmonary valve") || value.includes("cusp of pulmonary valve") || value.includes("pulmonary valve anulus")) return regions.pulmonaryValve;
  if (value.includes("mitral valve") || value.includes("mitral leaflet")) return regions.mitralValve;
  if (value.includes("tricuspid valve") || value.includes("tricuspid leaflet")) return regions.tricuspidValve;
  if (value.includes("atrioventricular bundle") || value.includes("internodal tract") || value.includes("nodal branch")
      || value.includes("sinuatrial node") || value.includes("sinoatrial node") || value.includes("atrioventricular node")) return regions.conduction;
  if (value.includes("fibrous trigone") || value.includes("fibrous ring")) return regions.fibrousSkeleton;
  if (value.includes("interatrial septum") || value.includes("interventricular septum") || value.includes("septal wall") || value.includes("atrioventricular septum")) return regions.septum;
  if (value.includes("left atrium")) return regions.leftAtrium;
  if (value.includes("right atrium")) return regions.rightAtrium;
  if (value.includes("left ventricle")) return regions.leftVentricle;
  if (value.includes("right ventricle")) return regions.rightVentricle;
  if (value.includes("aorta")) return regions.aorta;
  if (value.includes("pulmonary trunk")) return regions.pulmonary;
  return regions.myocardium;
}

export function regionForId(id: string) {
  return regions[id] ?? null;
}
