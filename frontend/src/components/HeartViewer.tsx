import { useMemo, useState } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import type { Target, Vessel } from "../api";
import { riskColor } from "../fields";

// Stylised heart: an ellipsoid with a pinched apex. Vessels are generated on the SAME surface.
const A = 0.95;
const B = 1.2;
const C = 0.9;

function toHeart(v: THREE.Vector3, s: number) {
  v.set(v.x * A * s, v.y * B * s, v.z * C * s);
  if (v.y < 0) {
    const k = 1 - 0.45 * Math.min(-v.y / (B * s), 1);
    v.x *= k;
    v.z *= k;
  }
  return v;
}

// theta: around the heart (0 = front, +90deg = patient's left), phi: 0 = top, PI = apex
function onSurface(theta: number, phi: number) {
  const v = new THREE.Vector3(
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta)
  );
  return toHeart(v, 1.03);
}

// [theta, phi] waypoints. Schematic routes only, not patient anatomy.
const PATHS: Record<Vessel, [number, number][]> = {
  LAD: [[0.45, 0.55], [0.35, 0.95], [0.28, 1.4], [0.22, 1.85], [0.15, 2.3], [0.1, 2.65]],
  LCX: [[0.55, 0.7], [0.95, 0.8], [1.45, 0.92], [1.95, 1.0], [2.5, 1.08], [2.95, 1.12]],
  RCA: [[-0.45, 0.7], [-0.9, 0.85], [-1.4, 1.05], [-1.9, 1.3], [-2.4, 1.6], [-2.85, 1.95]],
};
const LABEL_T: Record<Vessel, number> = { LAD: 0.45, LCX: 0.2, RCA: 0.2 };
const VESSELS: Vessel[] = ["LAD", "LCX", "RCA"];

function buildVessel(name: Vessel) {
  const param = new THREE.CatmullRomCurve3(PATHS[name].map(([t, p]) => new THREE.Vector3(t, p, 0)));
  const pts = param.getPoints(60).map((q) => onSurface(q.x, q.y));
  const curve = new THREE.CatmullRomCurve3(pts);
  return {
    geometry: new THREE.TubeGeometry(curve, 120, 0.055, 12, false),
    labelAt: curve.getPoint(LABEL_T[name]).multiplyScalar(1.25),
  };
}

function HeartBody({ dark }: { dark: boolean }) {
  const geometry = useMemo(() => {
    const g = new THREE.SphereGeometry(1, 64, 48);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      toHeart(v, 1);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }, []);

  return (
    <>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={dark ? "#3a5272" : "#d9e4f2"} roughness={0.85} />
      </mesh>
      {/* aorta stub, for orientation only */}
      <mesh position={[-0.05, 1.3, 0]}>
        <cylinderGeometry args={[0.2, 0.22, 0.7, 24]} />
        <meshStandardMaterial color={dark ? "#4a6485" : "#c3d3e6"} roughness={0.8} />
      </mesh>
    </>
  );
}

function VesselMesh(props: {
  name: Vessel;
  probability?: number;
  selected: boolean;
  onSelect: (t: Target) => void;
}) {
  const { name, probability, selected, onSelect } = props;
  const [hover, setHover] = useState(false);
  const built = useMemo(() => buildVessel(name), [name]);
  const color = probability === undefined ? "#94a3b8" : riskColor(probability);
  const label = probability === undefined ? name : `${name} ${(probability * 100).toFixed(0)}%`;

  return (
    <group>
      <mesh
        geometry={built.geometry}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(name);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "auto";
        }}
      >
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 0.55 : hover ? 0.35 : 0.1}
        />
      </mesh>
      <Html position={built.labelAt} center style={{ pointerEvents: "none" }}>
        <div className={"vlabel" + (selected ? " sel" : "")}>{label}</div>
      </Html>
    </group>
  );
}

interface Props {
  probabilities: Partial<Record<Vessel, number>>;
  selected: Target;
  onSelect: (t: Target) => void;
  dark: boolean;
}

export default function HeartViewer({ probabilities, selected, onSelect, dark }: Props) {
  return (
    <div className="card">
      <h3>Heart view</h3>
      <div className="canvas-wrap">
        <Canvas camera={{ position: [0, 0, 4.4], fov: 45 }}>
          <ambientLight intensity={dark ? 0.9 : 1.1} />
          <directionalLight position={[3, 4, 5]} intensity={1.0} />
          <directionalLight position={[-3, -2, -4]} intensity={0.4} />
          <group rotation={[0, 0, 0.45]}>
            <HeartBody dark={dark} />
            {VESSELS.map((v) => (
              <VesselMesh
                key={v}
                name={v}
                probability={probabilities[v]}
                selected={selected === v}
                onSelect={onSelect}
              />
            ))}
          </group>
          <OrbitControls enablePan enableZoom enableRotate minDistance={2.5} maxDistance={8} />
        </Canvas>
      </div>
      <div className="legend-bar" />
      <div className="legend-labels">
        <span>0% lower model estimate</span>
        <span>100% higher model estimate</span>
      </div>
      <p className="note">
        Drag to rotate, scroll to zoom, right-drag to pan, click a vessel to select it.
        {selected === "CAD" ? " Overall CAD is selected: click a vessel to inspect it." : ` Selected: ${selected}.`}{" "}
        Each vessel is coloured as a whole by its model-estimated probability; this does not show where a
        narrowing is. A lower estimate does not rule out disease.
      </p>
    </div>
  );
}