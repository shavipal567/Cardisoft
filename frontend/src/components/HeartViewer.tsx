import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import type { Target, Vessel } from "../api";
import { riskColor } from "../fields";

// ---------------------------------------------------------------------------
// Anatomical heart surface
// ---------------------------------------------------------------------------
// Broad base (great vessels) tapering to an apex that bends to the patient's
// left and slightly anterior. Two sulci are carved into the surface:
//   - coronary (atrioventricular) sulcus: ring at phi ~= 0.85
//   - anterior interventricular sulcus: groove at theta ~= 0.2, phi > 0.85
// Vessels are generated on this SAME surface so they sit in the sulci.
const A = 0.95; // half-width  (patient left-right)
const B = 1.2; // half-height (base to apex)
const C = 0.9; // half-depth  (anterior-posterior)

const CORONARY_PHI = 0.85;
const AIS_THETA = 0.2;

function toAnatomicalHeart(v: THREE.Vector3, s: number) {
  const theta = Math.atan2(v.x, v.z);
  const phi = Math.acos(THREE.MathUtils.clamp(v.y, -1, 1));

  let x = v.x * A * s;
  let y = v.y * B * s;
  let z = v.z * C * s;

  // apex taper + bend (patient's left, slightly anterior)
  if (y < 0) {
    const t = Math.min(-y / (B * s), 1);
    const pinch = 1 - 0.55 * t * t;
    x *= pinch;
    z *= pinch;
    x += 0.35 * t * t * s;
    z += 0.15 * t * t * s;
  }

  // flatten the base where the great vessels attach
  if (y > 0.55 * B * s) {
    const t = (y - 0.55 * B * s) / (0.45 * B * s);
    y = 0.55 * B * s + (y - 0.55 * B * s) * (1 - 0.18 * t);
  }

  // carve sulci (radial inward displacement)
  let groove = 0.06 * Math.exp(-Math.pow((phi - CORONARY_PHI) / 0.13, 2));
  const aisFade = THREE.MathUtils.smoothstep(phi, CORONARY_PHI - 0.1, CORONARY_PHI + 0.15);
  groove += 0.05 * Math.exp(-Math.pow((theta - AIS_THETA) / 0.13, 2)) * aisFade;

  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  const disp = groove * s;
  x -= (x / len) * disp;
  y -= (y / len) * disp;
  z -= (z / len) * disp;

  v.set(x, y, z);
  return v;
}

// theta: around the heart (0 = anterior, +90deg = patient's left)
// phi: 0 = base, PI = apex
function onSurface(theta: number, phi: number) {
  const v = new THREE.Vector3(
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.cos(theta)
  );
  return toAnatomicalHeart(v, 1.03);
}

// [theta, phi] waypoints. Anatomical routes: LAD down the anterior
// interventricular sulcus, LCX around the left AV groove, RCA around the
// right AV groove toward the crux.
const PATHS: Record<Vessel, [number, number][]> = {
  LAD: [[0.3, 0.5], [0.25, 0.8], [0.22, 1.1], [0.2, 1.5], [0.18, 1.95], [0.16, 2.4], [0.15, 2.6]],
  LCX: [[0.45, 0.65], [0.85, 0.8], [1.35, 0.88], [1.85, 0.95], [2.35, 1.02], [2.8, 1.08]],
  RCA: [[-0.35, 0.65], [-0.8, 0.8], [-1.3, 0.92], [-1.8, 1.08], [-2.3, 1.3], [-2.75, 1.6]],
};
const LABEL_T: Record<Vessel, number> = { LAD: 0.45, LCX: 0.2, RCA: 0.2 };
const VESSELS: Vessel[] = ["LAD", "LCX", "RCA"];

const VESSEL_META: Record<Vessel, { full: string; territory: string; mesh: string }> = {
  LAD: { full: "Left Anterior Descending", territory: "Anterior wall + septum", mesh: "LAD_MESH_01" },
  LCX: { full: "Left Circumflex", territory: "Lateral (marginal) wall", mesh: "LCX_MESH_02" },
  RCA: { full: "Right Coronary Artery", territory: "Right + inferior wall → PDA", mesh: "RCA_MESH_03" },
};

// Technical annotation anchors (scene units, schematic only)
const ANCHORS = {
  aorta: new THREE.Vector3(0.25, 1.5, 0.4),
  pulmonary: new THREE.Vector3(-0.72, 1.35, 0.42),
  svc: new THREE.Vector3(-0.82, 1.5, -0.05),
  apex: new THREE.Vector3(0.45, -1.5, 0.3),
  anterior: new THREE.Vector3(0, 0.25, 1.4),
  posterior: new THREE.Vector3(0, 0.25, -1.4),
  left: new THREE.Vector3(1.6, 0.1, 0),
  right: new THREE.Vector3(-1.6, 0.1, 0),
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

// ---------------------------------------------------------------------------
// Great vessels (anatomical colour convention: red = arterial, blue = venous)
// ---------------------------------------------------------------------------
type GreatVessel = {
  name: string;
  points: [number, number, number][];
  radius: number;
  kind: "arterial" | "venous";
};

const GREAT_VESSELS: GreatVessel[] = [
  {
    name: "AORTA",
    points: [
      [0.0, 0.85, 0.18],
      [0.0, 1.4, 0.12],
      [0.15, 1.8, -0.12],
      [0.42, 1.9, -0.42],
      [0.5, 1.6, -0.66],
      [0.5, 1.15, -0.76],
    ],
    radius: 0.16,
    kind: "arterial",
  },
  {
    name: "PULMONARY TRUNK",
    points: [
      [-0.18, 0.8, 0.42],
      [-0.32, 1.2, 0.34],
      [-0.48, 1.55, 0.08],
      [-0.58, 1.7, -0.22],
    ],
    radius: 0.15,
    kind: "venous",
  },
  {
    name: "SVC",
    points: [
      [-0.5, 0.95, 0.12],
      [-0.56, 1.4, 0.06],
      [-0.58, 1.75, 0.0],
    ],
    radius: 0.11,
    kind: "venous",
  },
  {
    name: "IVC",
    points: [
      [-0.5, 0.85, -0.12],
      [-0.56, 0.45, -0.18],
      [-0.58, 0.05, -0.22],
    ],
    radius: 0.11,
    kind: "venous",
  },
];

function buildTube(points: [number, number, number][], radius: number) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, 64, radius, 12, false);
}

function vesselColor(kind: "arterial" | "venous", dark: boolean) {
  if (kind === "arterial") return dark ? "#b03040" : "#d64545";
  return dark ? "#3a5a9a" : "#4a7fc1";
}

function myocardiumColor(dark: boolean) {
  return dark ? "#4a2d38" : "#a04a58";
}

function Auricles({ dark }: { dark: boolean }) {
  const color = myocardiumColor(dark);
  return (
    <group>
      {/* right auricle: broad flap wrapping toward the aorta */}
      <mesh position={[-0.5, 1.0, 0.42]} rotation={[0.2, 0.3, -0.4]} scale={[0.34, 0.26, 0.2]}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      {/* left auricle: narrow, curved, over the pulmonary trunk */}
      <mesh position={[0.55, 0.92, 0.38]} rotation={[0.3, -0.4, 0.5]} scale={[0.24, 0.2, 0.34]}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
    </group>
  );
}

function HeartBody({ dark }: { dark: boolean }) {
  const geometry = useMemo(() => {
    const g = new THREE.SphereGeometry(1, 96, 64);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      toAnatomicalHeart(v, 1);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }, []);

  const greatVessels = useMemo(
    () => GREAT_VESSELS.map((gv) => ({ ...gv, geometry: buildTube(gv.points, gv.radius) })),
    []
  );

  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={myocardiumColor(dark)} roughness={0.85} />
      </mesh>
      {greatVessels.map((gv) => (
        <mesh key={gv.name} geometry={gv.geometry}>
          <meshStandardMaterial color={vesselColor(gv.kind, dark)} roughness={0.7} />
        </mesh>
      ))}
      <Auricles dark={dark} />
    </group>
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

interface Props {
  probabilities: Partial<Record<Vessel, number>>;
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
        <h3>Heart view — anatomical 3D</h3>
        <span className="tech-tag">R3F · three r186 · proc. mesh · anterior view</span>
      </div>
      <div className="canvas-wrap tech-canvas">
        <Canvas camera={{ position: [0, 0, 4.8], fov: 45 }}>
          <ambientLight intensity={dark ? 0.9 : 1.1} />
          <directionalLight position={[3, 4, 5]} intensity={1.0} />
          <directionalLight position={[-3, -2, -4]} intensity={0.4} />
          <gridHelper args={[9, 18, dark ? "#2d4663" : "#b9d2e6", dark ? "#1d3350" : "#dceaf4"]} position={[0, -1.95, 0]} />
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
            <TechLabel position={ANCHORS.aorta} title="AORTA" sub="ascending + arch" />
            <TechLabel position={ANCHORS.pulmonary} title="PULM TRUNK" sub="venous" />
            <TechLabel position={ANCHORS.svc} title="SVC" sub="superior vena cava" />
            <TechLabel position={ANCHORS.apex} title="APEX" sub="inferior tip" />
            <TechLabel position={ANCHORS.anterior} title="ANT" sub="anterior" />
            <TechLabel position={ANCHORS.posterior} title="POST" sub="posterior" />
            <TechLabel position={ANCHORS.left} title="L" sub="pt. left" />
            <TechLabel position={ANCHORS.right} title="R" sub="pt. right" />
          </group>
          </Beat>
          <OrbitControls enablePan enableZoom enableRotate minDistance={2.5} maxDistance={8} />
        </Canvas>
        <div className="hud hud-tl">ANATOMICAL — SCHEMATIC · FOV 45° · CAM [0,0,4.8]</div>
        <div className="hud hud-tr">
          {selected === "CAD"
            ? `SEL: CAD · ${cadProbability !== undefined ? `${(cadProbability * 100).toFixed(0)}% ${cadPrediction === 1 ? "POS" : "NEG"}` : "—"}`
            : `SEL: ${selected} · ${selMeta?.mesh} · ${selProb !== undefined ? `${(selProb * 100).toFixed(0)}% ${selCls === 1 ? "POS" : "NEG"}` : "—"}`}
        </div>
        <div className="hud hud-br">PROCEDURAL MYOCARDIUM · SULCI + GREAT VESSELS · VESSEL TUBE 120×12 R0.055</div>
      </div>
      <table className="spec-table">
        <thead>
          <tr>
            <th>Vessel / mesh</th>
            <th>Territory (anatomical)</th>
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
