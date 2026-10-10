import { Component, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentRef, ReactNode, RefObject } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html, Line, useGLTF } from "@react-three/drei";
import type { Target, Vessel } from "../api";
import { riskColor } from "../fields";
import { ARTERY_RADIUS, loadCoronaries, LABEL_FRACTION, registerHeart, VESSELS, VESSEL_META } from "../anatomy/coronary";

const GLB_URL = "/heart.glb";
useGLTF.preload(GLB_URL);

type View = "Anterior" | "Left lateral" | "Posterior" | "Right lateral";
const VIEWS: Record<View, [number, number, number]> = {
  Anterior: [0, 0.1, 4.5],
  "Left lateral": [4.5, 0.1, 0],
  Posterior: [0, 0.1, -4.5],
  "Right lateral": [-4.5, 0.1, 0],
};

class HeartErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    return this.state.error
      ? <p className="error" role="alert">The 3D heart could not be loaded. Vessel estimates remain available below.</p>
      : this.props.children;
  }
}

function CameraControls({ view, revision, onRotate }: { view: View; revision: number; onRotate: () => void }) {
  const { camera, size } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  useEffect(() => {
    const framing = Math.max(1, 1.12 / (size.width / size.height));
    camera.position.set(...VIEWS[view]).multiplyScalar(framing);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, -0.05, 0);
    controls.current?.target.set(0, -0.05, 0);
    controls.current?.update();
  }, [camera, view, revision, size.width, size.height]);
  return <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={3} maxDistance={9}
    minPolarAngle={0.2} maxPolarAngle={Math.PI - 0.2} onStart={onRotate} />;
}

function Artery({ points, color, selected = false, onSelect }: {
  points: THREE.Vector3[]; color: string; selected?: boolean; onSelect?: () => void;
}) {
  const [geometry, outline] = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(points);
    const segments = Math.max(64, points.length * 2);
    return [
      new THREE.TubeGeometry(curve, segments, ARTERY_RADIUS * 1.6, 12, false),
      new THREE.TubeGeometry(curve, segments, ARTERY_RADIUS * 2.3, 12, false),
    ];
  }, [points]);
  useEffect(() => () => { geometry.dispose(); outline.dispose(); }, [geometry, outline]);
  return <group onClick={onSelect ? (event) => { event.stopPropagation(); onSelect(); } : undefined}>
    <mesh geometry={outline} renderOrder={1}>
      <meshBasicMaterial color={selected ? "#ffffff" : "#101d2b"} side={THREE.BackSide}
        depthWrite={false} toneMapped={false} />
    </mesh>
    <mesh geometry={geometry} renderOrder={2}>
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  </group>;
}

type LabelElements = RefObject<Partial<Record<Vessel, HTMLButtonElement>>>;

// Labels live in the main React DOM root. Project their anchors from R3F;
// independent Html roots can lose their first label on Suspense/StrictMode remounts.
function VesselLabel({ name, route, occluder, labels }: {
  name: Vessel; route: { points: THREE.Vector3[]; normals: THREE.Vector3[] };
  occluder: THREE.Object3D; labels: LabelElements;
}) {
  const index = Math.round(LABEL_FRACTION[name] * (route.points.length - 1));
  const anchor = route.points[index];
  const position = useMemo(() => {
    const p = anchor.clone().addScaledVector(route.normals[index], 0.38);
    p.x += name === "RCA" ? -0.30 : 0.30;
    if (name === "LCX") p.y += 0.12;
    return p;
  }, [anchor, route, index, name]);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const projected = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const label = labels.current[name];
    if (!label) return;
    camera.updateMatrixWorld();
    projected.copy(position).project(camera);
    direction.subVectors(position, camera.position);
    const distance = direction.length();
    ray.set(camera.position, direction.normalize());
    const hit = ray.intersectObject(occluder, true)[0];
    const visible = projected.z > -1 && projected.z < 1 && (!hit || hit.distance > distance);
    label.style.setProperty("visibility", visible ? "visible" : "hidden");
    const halfWidth = label.offsetWidth / 2 + 6;
    const halfHeight = label.offsetHeight / 2 + 6;
    label.style.setProperty("left", `${THREE.MathUtils.clamp((projected.x + 1) * size.width / 2, halfWidth, size.width - halfWidth)}px`);
    label.style.setProperty("top", `${THREE.MathUtils.clamp((1 - projected.y) * size.height / 2, halfHeight, size.height - halfHeight)}px`);
  });
  return <Line points={[anchor, position]} color="#d4dce7" lineWidth={1} />;
}

function RegisteredHeart({ probabilities, selected, onSelect, labels, focus, showRoutes }: Pick<Props, "probabilities" | "selected" | "onSelect"> & { labels: LabelElements; focus: boolean; showRoutes: boolean }) {
  const gltf = useGLTF(GLB_URL);
  const invalidate = useThree((state) => state.invalidate);
  const { heart, materials } = useMemo(() => {
    const heart = registerHeart(gltf.scene);
    const materials = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    heart.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const source of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!materials.has(source)) materials.set(source, new THREE.MeshStandardMaterial({
          color: "#617586", roughness: 0.95, metalness: 0, side: source.side,
        }));
      }
    });
    return { heart, materials };
  }, [gltf.scene]);
  useEffect(() => {
    const originals = new Map([...materials].map(([source, muted]) => [muted, source]));
    heart.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const swap = (material: THREE.Material) => {
        const source = originals.get(material as THREE.MeshStandardMaterial) ?? material;
        return focus ? materials.get(source) ?? source : source;
      };
      object.material = Array.isArray(object.material) ? object.material.map(swap) : swap(object.material);
    });
    invalidate();
  }, [heart, materials, focus, invalidate]);
  useEffect(() => () => { materials.forEach((material) => material.dispose()); }, [materials]);
  const arteries = useMemo(() => loadCoronaries(), []);
  return <>
    <primitive object={heart} />
    {showRoutes && <>
    <Artery points={arteries.leftMain} color="#e6cba4" />
    <Artery points={arteries.rightOrigin} color={probabilities.RCA === undefined ? "#d7c7b6" : riskColor(probabilities.RCA)} />
    {VESSELS.map((name) => <group key={name}>
      <Artery points={arteries.routes[name].points}
        color={probabilities[name] === undefined ? "#d7c7b6" : riskColor(probabilities[name])}
        selected={selected === name} onSelect={() => onSelect(name)} />
      <VesselLabel name={name} route={arteries.routes[name]} occluder={heart} labels={labels} />
    </group>)}
    </>}
  </>;
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

export default function HeartViewer({ probabilities, classifications, selected, onSelect, dark }: Props) {
  const labels = useRef<Partial<Record<Vessel, HTMLButtonElement>>>({});
  const [focus, setFocus] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [view, setView] = useState<View>("Anterior");
  const [revision, setRevision] = useState(0);
  const [rotated, setRotated] = useState(false);
  return <div className="card coronary-viewer">
    <div className="heart-head">
      <h3>Heart anatomy</h3>
      <span className="tech-tag">Illustrative 3D model</span>
    </div>
    <div className="heart-view-controls" role="group" aria-label="Heart viewing direction">
      {(Object.keys(VIEWS) as View[]).map((name) => <button key={name} aria-pressed={!rotated && view === name}
        onClick={() => { setView(name); setRevision((n) => n + 1); setRotated(false); }}>{name}</button>)}
    </div>
    <div className="heart-route-control">
      <label><input type="checkbox" checked={showRoutes}
        onChange={(event) => { setShowRoutes(event.target.checked); if (!event.target.checked) setFocus(false); }} />
        Show LAD, LCX and RCA highlights</label>
      <p className="note">Highlights follow mapped reference courses on the heart surface; they are not verified segmentations of the GLB’s native vessels.</p>
    </div>
    {showRoutes && <div className="heart-display-controls" role="group" aria-label="Heart colour display">
      <button aria-pressed={focus} onClick={() => setFocus(true)}>Vessel focus</button>
      <button aria-pressed={!focus} onClick={() => setFocus(false)}>Original colours</button>
      <span>{focus ? "Muted heart surface highlights the coronary arteries." : "Original heart colours with outlined coronary arteries."}</span>
    </div>}
    <div className="heart-locate-controls" role="group" aria-label="Locate coronary artery">
      {VESSELS.map((name) => <button key={name} aria-pressed={selected === name}
        onClick={() => {
          setShowRoutes(true);
          setView(name === "LCX" ? "Left lateral" : "Anterior");
          setRevision((n) => n + 1);
          setRotated(false);
          onSelect(name);
        }}>
        <b>{name}</b><span>{VESSEL_META[name].full}</span>
      </button>)}
    </div>
    <HeartErrorBoundary>
      <div className="canvas-wrap tech-canvas" role="group" aria-label="Interactive coronary artery model">
        <Canvas frameloop="demand" camera={{ position: VIEWS.Anterior, fov: 40 }} dpr={[1, 1.5]}>
          <ambientLight intensity={dark ? 1.3 : 1.6} />
          <directionalLight position={[2, 4, 5]} intensity={2} />
          <directionalLight position={[-3, 1, -4]} intensity={1.4} />
          <Suspense fallback={<Html center><span className="heart-loading">Loading heart anatomy…</span></Html>}>
            <RegisteredHeart probabilities={probabilities} selected={selected} onSelect={onSelect} labels={labels} focus={focus} showRoutes={showRoutes} />
          </Suspense>
          <CameraControls view={view} revision={revision} onRotate={() => setRotated(true)} />
        </Canvas>
        {showRoutes && VESSELS.map((name) => <button key={name}
          ref={(element) => { if (element) labels.current[name] = element; else delete labels.current[name]; }}
          className={"coronary-label" + (selected === name ? " selected" : "")}
          aria-label={`Select ${VESSEL_META[name].full}`} aria-pressed={selected === name}
          onClick={() => onSelect(name)}>
          <b>{name}</b><span>{probabilities[name] === undefined ? "—" : `${Math.round(probabilities[name] * 100)}%`}</span>
        </button>)}
        <div className="hud hud-tl">{rotated ? "Rotated view" : `${view} view`}</div>
        <div className="hud hud-tr">{showRoutes ? (selected === "CAD" ? "LAD · LCX · RCA highlighted" : `${selected} selected`) : "Original anatomy"}</div>
        {!rotated && (view === "Anterior" || view === "Posterior") && <>
          <span className="heart-side heart-side-left">Patient’s {view === "Anterior" ? "right" : "left"}</span>
          <span className="heart-side heart-side-right">Patient’s {view === "Anterior" ? "left" : "right"}</span>
        </>}
        <div className="hud hud-br">Drag to rotate · Scroll to zoom</div>
      </div>
    </HeartErrorBoundary>
    <div className="coronary-table-wrap" tabIndex={0} role="region" aria-label="Coronary artery estimates">
      <table className="spec-table">
        <thead><tr><th>Artery</th><th>Reference course</th><th>Estimate</th><th>Class</th></tr></thead>
        <tbody>{VESSELS.map((name) => {
          const probability = probabilities[name];
          const classification = classifications?.[name];
          return <tr key={name} className={selected === name ? "sel-row" : ""}>
            <td><button className="artery-select" onClick={() => onSelect(name)} aria-pressed={selected === name}>
              <span className="swatch" style={{ background: probability === undefined ? "#d7c7b6" : riskColor(probability) }} />{name}
            </button><br /><span className="muted">{VESSEL_META[name].full}</span></td>
            <td>{VESSEL_META[name].course}</td>
            <td>{probability === undefined ? "—" : `${(probability * 100).toFixed(1)}%`}</td>
            <td><span className={"pill " + (classification === 1 ? "pos" : "neg")}>
              {classification === undefined ? "—" : classification === 1 ? "Positive" : "Negative"}
            </span></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div className="legend-bar" />
    <div className="legend-labels"><span>Lower model estimate</span><span>Higher model estimate</span></div>
    {showRoutes && <p className="note">The reference routes illustrate how LAD and LCX share the left main coronary origin; RCA has a separate aortic origin.
      Use the lateral and posterior views to follow the arteries around the heart. Small branches and
      anatomical variants are omitted. The neutral segment marks the left main, which has no separate model estimate.</p>}
    <p className="note">This is an illustrative model, not a patient scan or clinically validated reconstruction.
      The table swatches and optional reference routes show whole-artery estimates. The original asset colours do not encode predictions.</p>
    <p className="note heart-credits">Anatomy reference: <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4919754/" target="_blank" rel="noreferrer">normal coronary anatomy</a>.
      {" "}Heart asset by <a href="https://sketchfab.com/3d-models/anatomically-correct-human-heart-54fa880728d14c11afff78be8721620a" target="_blank" rel="noreferrer">Pigcraft</a>
      {" "}(<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>); orientation and overlays adapted.</p>
  </div>;
}
