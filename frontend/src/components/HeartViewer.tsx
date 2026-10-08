import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
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

const VESSEL_META: Record<Vessel, { full: string; territory: string; mesh: string }> = {
  LAD: { full: "Left Anterior Descending", territory: "Anterior wall + septum", mesh: "LAD_MESH_01" },
  LCX: { full: "Left Circumflex", territory: "Lateral / posterior wall", mesh: "LCX_MESH_02" },
  RCA: { full: "Right Coronary Artery", territory: "Right + inferior wall", mesh: "RCA_MESH_03" },
};

// Technical annotation anchors (scene units, schematic only)
const ANCHORS = {
  aorta: new THREE.Vector3(-0.05, 1.85, 0),
  apex: new THREE.Vector3(0.12, -1.5, 0.25),
  anterior: new THREE.Vector3(0, 0.1, 1.35),
  left: new THREE.Vector3(1.55, 0.1, 0),
  right: new THREE.Vector3(-1.55, 0.1, 0),
};

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

function TechLabel({ position, title, sub }: { position: THREE.Vector3; title: string; sub?: string }) {
  return (
    <Html position={position} center style={{ pointerEvents: "none" }}>
      <div className="tlabel">
        <b>{title}</b>
        {sub && <span>{sub}</span>}
      </div>
    </Html>
  );
}

function VesselMesh(props: {
  name: Vessel;
  probability?: number;
  prediction?: number;
  selected: boolean;
  onSelect: (t: Target) => void;
}) {
  const { name, probability, prediction, selected, onSelect } = props;
  const [hover, setHover] = useState(false);
  const built = useMemo(() => buildVessel(name), [name]);
  const color = probability === undefined ? "#94a3b8" : riskColor(probability);
  const pct = probability === undefined ? "—" : `${(probability * 100).toFixed(0)}%`;
  const cls = prediction === undefined ? "n/a" : prediction === 1 ? "POS" : "NEG";

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
        <div className={"vlabel tech" + (selected ? " sel" : "")}>
          <b>{name} · {pct}</b>
          <span>{VESSEL_META[name].full}</span>
          <span className="vsub">{cls} · {VESSEL_META[name].mesh}</span>
        </div>
      </Html>
    </group>
  );
}

/** Gentle lub-dub pulse; off when the user prefers reduced motion. */
function Beat({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const reduce = useMemo(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );
  useFrame(({ clock }) => {
    if (!ref.current || reduce) return;
    const ph = (clock.getElapsedTime() % 0.833) / 0.833;
    const beat =
      Math.exp(-Math.pow((ph - 0.12) / 0.07, 2)) +
      0.6 * Math.exp(-Math.pow((ph - 0.32) / 0.08, 2));
    ref.current.scale.setScalar(1 + 0.012 * beat);
  });
  return <group ref={ref}>{children}</group>;
}

interface Props {  probabilities: Partial<Record<Vessel, number>>;
  classifications?: Partial<Record<Vessel, number>>;
  cadProbability?: number;
  cadPrediction?: number;
  selected: Target;
  onSelect: (t: Target) => void;
  dark: boolean;
}

export default function HeartViewer({
  probabilities,
  classifications,
  cadProbability,
  cadPrediction,
  selected,
  onSelect,
  dark,
}: Props) {
  const selMeta = selected === "CAD" ? null : VESSEL_META[selected];
  const selProb = selected === "CAD" ? cadProbability : probabilities[selected];
  const selCls =
    selected === "CAD"
      ? cadPrediction
      : classifications?.[selected];
  return (
    <div className="card">
      <div className="heart-head">
        <h3>Heart view — schematic 3D</h3>
        <span className="tech-tag">R3F · three r186 · proc. mesh · anterior view</span>
      </div>
      <div className="canvas-wrap tech-canvas">
        <Canvas camera={{ position: [0, 0, 4.4], fov: 45 }}>
          <ambientLight intensity={dark ? 0.9 : 1.1} />
          <directionalLight position={[3, 4, 5]} intensity={1.0} />
          <directionalLight position={[-3, -2, -4]} intensity={0.4} />
          <gridHelper args={[9, 18, dark ? "#2d4663" : "#b9d2e6", dark ? "#1d3350" : "#dceaf4"]} position={[0, -1.85, 0]} />
          <Beat>
          <group rotation={[0, 0, 0.45]}>
            <HeartBody dark={dark} />
            {VESSELS.map((v) => (
              <VesselMesh
                key={v}
                name={v}
                probability={probabilities[v]}
                prediction={classifications?.[v]}
                selected={selected === v}
                onSelect={onSelect}
              />
            ))}
            <TechLabel position={ANCHORS.aorta} title="AORTA" sub="orientation stub" />
            <TechLabel position={ANCHORS.apex} title="APEX" sub="inferior tip" />
            <TechLabel position={ANCHORS.anterior} title="ANT" sub="anterior" />
            <TechLabel position={ANCHORS.left} title="L" sub="pt. left" />
            <TechLabel position={ANCHORS.right} title="R" sub="pt. right" />
          </group>
          </Beat>
          <OrbitControls enablePan enableZoom enableRotate minDistance={2.5} maxDistance={8} />
        </Canvas>
        <div className="hud hud-tl">SCHEMATIC — NOT PATIENT ANATOMY · FOV 45° · CAM [0,0,4.4]</div>
        <div className="hud hud-tr">
          {selected === "CAD"
            ? `SEL: CAD · ${cadProbability !== undefined ? `${(cadProbability * 100).toFixed(0)}% ${cadPrediction === 1 ? "POS" : "NEG"}` : "—"}`
            : `SEL: ${selected} · ${selMeta?.mesh} · ${selProb !== undefined ? `${(selProb * 100).toFixed(0)}% ${selCls === 1 ? "POS" : "NEG"}` : "—"}`}
        </div>
        <div className="hud hud-br">HEART ELLIPSOID 0.95×1.20×0.90 · SPH 64×48 · VESSEL TUBE 120×12 R0.055</div>
      </div>
      <table className="spec-table">
        <thead>
          <tr>
            <th>Vessel / mesh</th>
            <th>Territory (schematic)</th>
            <th>P(stenosis)</th>
            <th>Class</th>
            <th>Visual channel</th>
          </tr>
        </thead>
        <tbody>
          {VESSELS.map((v) => {
            const p = probabilities[v];
            const c = classifications?.[v];
            return (
              <tr key={v} className={selected === v ? "sel-row" : ""} onClick={() => onSelect(v)}>
                <td><b>{v}</b> <span className="mono">{VESSEL_META[v].mesh}</span><br /><span className="muted">{VESSEL_META[v].full}</span></td>
                <td>{VESSEL_META[v].territory}</td>
                <td className="mono">{p === undefined ? "—" : `${(p * 100).toFixed(1)}%`}</td>
                <td>
                  <span className={"pill " + (c === 1 ? "pos" : "neg")}>
                    {c === undefined ? "n/a" : c === 1 ? "POS" : "NEG"}
                  </span>
                </td>
                <td><span className="swatch" style={{ background: p === undefined ? "#94a3b8" : riskColor(p) }} /> whole-mesh color + label</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="legend-bar" />
      <div className="legend-labels">
        <span>0% lower model estimate</span>
        <span>100% higher model estimate</span>
      </div>
      <p className="note">
        Drag to rotate, scroll to zoom, right-drag to pan, click a vessel (3D or table row) to select it.
        {selected === "CAD" ? " Overall CAD is selected: click a vessel to inspect it." : ` Selected: ${selected}.`}{" "}
        Each vessel is coloured as a whole by its model-estimated probability; this does not show where a
        narrowing is. A lower estimate does not rule out disease.
      </p>
    </div>
  );
}
