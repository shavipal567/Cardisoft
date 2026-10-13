import { useMemo, useEffect } from "react";
import * as THREE from "three";
import { useLoader } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import type { Vessel } from "../api";
import parts from "./heartParts.json";
import { probabilityColor, REFERENCE_COLOR } from "../viewer/probability";
import type { AnatomyOverlayRef } from "../components/AnatomyLabels";
import { AnatomyProjection } from "../components/AnatomyLabels";
import { ANATOMY_REGIONS, regionForPart } from "./regions";

const urls = parts.map(({ file }) => `/heart-parts/${encodeURIComponent(file)}`);
type Props = {
  probabilities: Partial<Record<Vessel, number>>;
  selected: Vessel | "CAD";
  onSelect: (vessel: Vessel) => void;
  probabilityColors: boolean;
  focus: boolean;
  opacity: number;
  isolate: boolean;
  anatomyOverlay?: AnatomyOverlayRef;
  hoveredRegion: string | null;
  onRegionHover: (region: string | null) => void;
};

/** Loads the original part OBJ files directly and registers their millimetre,
 * Z-up coordinates into the viewer's X-left/Y-superior/Z-anterior frame. */
export default function AnatomicalHeart({ probabilities, selected, onSelect, probabilityColors, focus, opacity, isolate, anatomyOverlay, hoveredRegion, onRegionHover }: Props) {
  const loaded = useLoader(OBJLoader, urls);
  const { heart, materials } = useMemo(() => {
    const heart = new THREE.Group();
    heart.name = "FMA postnatal anatomical heart (OBJ parts)";
    const regionMaterials = Object.fromEntries(ANATOMY_REGIONS.map(({ id }) => [id, new THREE.MeshStandardMaterial({ color: "#a96160", roughness: .88, metalness: 0 })])) as Record<string, THREE.MeshStandardMaterial>;
    const materials = {
      regions: regionMaterials,
      LAD: new THREE.MeshStandardMaterial({ color: REFERENCE_COLOR, roughness: .56, metalness: 0 }),
      LCX: new THREE.MeshStandardMaterial({ color: REFERENCE_COLOR, roughness: .56, metalness: 0 }),
      RCA: new THREE.MeshStandardMaterial({ color: REFERENCE_COLOR, roughness: .56, metalness: 0 }),
    };

    loaded.forEach((source, index) => {
      const part = source.clone(true);
      const meta = parts[index];
      const vessel = meta.vessel as Vessel | null;
      const region = regionForPart(meta.name, vessel);
      part.name = meta.name;
      part.userData.vessel = vessel;
      part.userData.regionId = region.id;
      part.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry = node.geometry.clone();
        node.material = vessel ? materials[vessel] : materials.regions[region.id];
        node.userData.vessel = vessel;
        node.userData.regionId = region.id;
        node.userData.partName = meta.name;
        node.castShadow = true;
        node.receiveShadow = true;
      });
      heart.add(part);
    });

    heart.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(heart);
    const center = bounds.getCenter(new THREE.Vector3());
    const dimensions = bounds.getSize(new THREE.Vector3());
    // Files are millimetres with superior on +Z. A -90° X rotation maps the
    // source's anterior -Y direction to the viewer's +Z anterior direction.
    const scale = 2.4 / dimensions.z;
    heart.position.copy(center).negate();
    const registered = new THREE.Group();
    registered.name = heart.name;
    registered.rotation.x = -Math.PI / 2;
    registered.scale.setScalar(scale);
    registered.add(heart);
    registered.updateMatrixWorld(true);
    return { heart: registered, materials };
  }, [loaded]);

  useEffect(() => {
    const faded = Math.min(1, Math.max(0, opacity));
    for (const [id, material] of Object.entries(materials.regions)) {
      material.color.set(focus ? "#8d7774" : "#a96160");
      material.emissive.set(hoveredRegion === id ? "#ffd36a" : "#000000");
      material.emissiveIntensity = hoveredRegion === id ? .65 : 0;
      material.opacity = isolate ? .14 : faded;
      material.transparent = isolate || faded < 1;
      material.depthWrite = !material.transparent;
    }
    for (const vessel of ["LAD", "LCX", "RCA"] as const) {
      const material = materials[vessel];
      material.color.set(probabilityColors ? probabilityColor(probabilities[vessel]) : REFERENCE_COLOR);
      material.emissive.set(hoveredRegion === vessel ? "#fff0b0" : "#000000");
      material.emissiveIntensity = hoveredRegion === vessel ? .65 : 0;
      const dim = isolate && selected !== vessel && selected !== "CAD";
      material.opacity = dim ? .16 : 1;
      material.transparent = dim;
      material.depthWrite = !dim;
    }
  }, [materials, probabilities, probabilityColors, focus, opacity, isolate, selected, hoveredRegion]);

  useEffect(() => () => {
    heart.traverse((node) => { if (node instanceof THREE.Mesh) node.geometry.dispose(); });
    Object.values(materials.regions).forEach((material) => material.dispose());
    for (const vessel of ["LAD", "LCX", "RCA"] as const) materials[vessel].dispose();
  }, [heart, materials]);

  return <>
    <primitive object={heart} onClick={(event: ThreeEvent<MouseEvent>) => {
      const vessel = event.object.userData.vessel as Vessel | undefined;
      if (vessel) { event.stopPropagation(); onSelect(vessel); }
    }} onPointerOver={(event: ThreeEvent<PointerEvent>) => {
      const region = event.object.userData.regionId as string | undefined;
      if (region) {
        event.stopPropagation();
        onRegionHover(region);
        (event.nativeEvent.target as HTMLCanvasElement).style.cursor = event.object.userData.vessel ? "pointer" : "help";
      }
    }} onPointerMove={(event: ThreeEvent<PointerEvent>) => {
      const region = event.object.userData.regionId as string | undefined;
      if (region) {
        event.stopPropagation();
        onRegionHover(region);
      }
    }} onPointerOut={(event: ThreeEvent<PointerEvent>) => {
      onRegionHover(null);
      (event.nativeEvent.target as HTMLCanvasElement).style.cursor = "grab";
    }} />
    {anatomyOverlay && <AnatomyProjection heart={heart} overlay={anatomyOverlay} />}
  </>;
}
