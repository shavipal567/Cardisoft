import { Component, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ComponentRef, ReactNode, RefObject, Ref } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html, Line, useGLTF } from "@react-three/drei";
import type { Target, Vessel } from "../api";
import { riskColor } from "../fields";
import { createHeartPng, exportHeartPng } from "../viewer/exportPng";
import LoadingStatus from "./LoadingStatus";
import AnatomyLabels, { AnatomyProjection } from "./AnatomyLabels";
import type { AnatomyOverlayRef } from "./AnatomyLabels";
import { ANATOMY_TOUR, VIEWS } from "../anatomy/exploration";
import type { View } from "../anatomy/exploration";
import { ARTERY_RADIUS, loadCoronaries, LABEL_FRACTION, registerHeart, VESSELS, VESSEL_META } from "../anatomy/coronary";

const GLB_URL = "/heart.glb";
useGLTF.preload(GLB_URL);

type Capture = (() => HTMLCanvasElement) | null;
function CaptureView({ onCapture }: { onCapture: (value: Capture) => void }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    onCapture(() => { gl.render(scene, camera); return gl.domElement; });
    return () => onCapture(null);
  }, [gl, scene, camera, onCapture]);
  return null;
}

class HeartErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    return this.state.error
      ? <p className="error" role="alert">The 3D heart could not be loaded. Vessel estimates remain available below.</p>
      : this.props.children;
  }
}

function CameraControls({ view, revision, zoom, onRotate }: { view: View; revision: number; zoom: { factor: number; sequence: number }; onRotate: () => void }) {
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
  useEffect(() => {
    if (!zoom.sequence || !controls.current) return;
    const target = controls.current.target;
    const offset = camera.position.clone().sub(target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * zoom.factor, 3, 9));
    camera.position.copy(target).add(offset);
    controls.current.update();
  }, [camera, zoom]);
  return <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={3} maxDistance={9}
    minPolarAngle={0.2} maxPolarAngle={Math.PI - 0.2} onStart={onRotate} />;
}

function Artery({ points, color, selected = false, dimmed = false, onSelect }: {
  points: THREE.Vector3[]; color: string; selected?: boolean; dimmed?: boolean; onSelect?: () => void;
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
        depthWrite={false} toneMapped={false} transparent={dimmed} opacity={dimmed ? 0.2 : 1} />
    </mesh>
    <mesh geometry={geometry} renderOrder={2}>
      <meshBasicMaterial color={dimmed ? "#415268" : color} toneMapped={false} transparent={dimmed} opacity={dimmed ? 0.22 : 1} depthWrite={!dimmed} />
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
  }, -0.5);
  return <Line points={[anchor, position]} color="#d4dce7" lineWidth={1} />;
}

function RegisteredHeart({ probabilities, selected, onSelect, labels, focus, showRoutes, opacity, isolate, anatomyOverlay, onCapture }: Pick<Props, "probabilities" | "selected" | "onSelect"> & { labels: LabelElements; focus: boolean; showRoutes: boolean; opacity: number; isolate: boolean; anatomyOverlay?: AnatomyOverlayRef; onCapture: (value: Capture) => void }) {
  const gltf = useGLTF(GLB_URL);
  const invalidate = useThree((state) => state.invalidate);
  const { heart, materials } = useMemo(() => {
    const heart = registerHeart(gltf.scene);
    const materials = new Map<THREE.Material, { muted: THREE.MeshStandardMaterial; coloured: THREE.Material }>();
    heart.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const source of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!materials.has(source)) {
          // Clone the material, keeping the cached GLB and its textures intact.
          const coloured = source.clone();
          coloured.transparent = true;
          coloured.depthWrite = false;
          coloured.side = THREE.FrontSide;
          materials.set(source, {
            muted: new THREE.MeshStandardMaterial({
              color: "#e48aa8", roughness: 0.95, metalness: 0, side: source.side,
            }),
            coloured,
          });
        }
      }
    });
    return { heart, materials };
  }, [gltf.scene]);
  useEffect(() => {
    materials.forEach(({ coloured }) => {
      coloured.opacity = opacity;
      const transparent = opacity < 1;
      if (coloured.transparent !== transparent) {
        coloured.transparent = transparent;
        coloured.needsUpdate = true;
      }
      coloured.depthWrite = !transparent;
    });
    const originals = new Map([...materials].flatMap(([source, variants]) =>
      [[variants.muted, source], [variants.coloured, source]] as [THREE.Material, THREE.Material][]));
    heart.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const swap = (material: THREE.Material) => {
        const source = originals.get(material) ?? material;
        const variants = materials.get(source);
        return variants ? (focus ? variants.muted : variants.coloured) : source;
      };
      object.material = Array.isArray(object.material) ? object.material.map(swap) : swap(object.material);
    });
    invalidate();
  }, [heart, materials, focus, opacity, invalidate]);
  useEffect(() => () => { materials.forEach(({ muted, coloured }) => { muted.dispose(); coloured.dispose(); }); }, [materials]);
  const arteries = useMemo(() => loadCoronaries(), []);
  return <>
    <primitive object={heart} />
    <CaptureView onCapture={onCapture} />
    {anatomyOverlay && <AnatomyProjection heart={heart} overlay={anatomyOverlay} />}
    {showRoutes && <>
    <Artery points={arteries.leftMain} color="#e6cba4" dimmed={isolate && selected === "RCA"} />
    <Artery points={arteries.rightOrigin} dimmed={isolate && selected !== "RCA" && selected !== "CAD"} color={probabilities.RCA === undefined ? "#d7c7b6" : riskColor(probabilities.RCA)} />
    {VESSELS.map((name) => <group key={name}>
      <Artery points={arteries.routes[name].points}
        color={probabilities[name] === undefined ? "#d7c7b6" : riskColor(probabilities[name])}
        selected={selected === name} dimmed={isolate && selected !== "CAD" && selected !== name} onSelect={() => onSelect(name)} />
      <VesselLabel name={name} route={arteries.routes[name]} occluder={heart} labels={labels} />
    </group>)}
    </>}
  </>;
}

export interface HeartViewerHandle { capturePng: () => HTMLCanvasElement }

interface Props {
  ref?: Ref<HeartViewerHandle>;
  probabilities: Partial<Record<Vessel, number>>;
  classifications?: Partial<Record<Vessel, number>>;
  cadProbability?: number;
  cadPrediction?: number;
  selected: Target;
  onSelect: (t: Target) => void;
  dark: boolean;
}

export default function HeartViewer({ ref, probabilities, classifications, selected, onSelect, dark }: Props) {
  const labels = useRef<Partial<Record<Vessel, HTMLButtonElement>>>({});
  const [focus, setFocus] = useState(true);
  const [opacity, setOpacity] = useState(69);
  const [showRoutes, setShowRoutes] = useState(true);
  const [isolate, setIsolate] = useState(false);
  const [anatomyLabels, setAnatomyLabels] = useState(false);
  const [tour, setTour] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const anatomyOverlay = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const capture = useRef<Capture>(null);
  const registerCapture = useCallback((value: Capture) => { capture.current = value; setReady(Boolean(value)); }, []);
  const tourSettings = useRef<{ isolate: boolean; anatomyLabels: boolean; showRoutes: boolean; selected: Target; view: View } | null>(null);
  const [view, setView] = useState<View>("Anterior");
  const [revision, setRevision] = useState(0);
  const [rotated, setRotated] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState({ factor: 1, sequence: 0 });
  const expandButton = useRef<HTMLButtonElement>(null);
  const viewer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setExpanded(false); expandButton.current?.focus(); }
      if (event.key === "Tab" && viewer.current) {
        const controls = [...viewer.current.querySelectorAll<HTMLElement>("button, input, summary, a[href], [tabindex='0']")]
          .filter((element) => !element.matches(":disabled") && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", escape);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", escape); };
  }, [expanded]);

  function stopTour() {
    setTour(null);
    const saved = tourSettings.current;
    if (saved) {
      setIsolate(saved.isolate); setAnatomyLabels(saved.anatomyLabels); setShowRoutes(saved.showRoutes);
      onSelect(saved.selected); setView(saved.view); setRevision((n) => n + 1); setRotated(false);
      tourSettings.current = null;
    }
  }
  function tourStep(index: number) {
    if (tour === null) tourSettings.current = { isolate, anatomyLabels, showRoutes, selected, view };
    const step = ANATOMY_TOUR[index];
    setTour(index); setView(step.view); setRevision((n) => n + 1); setRotated(false);
    setShowRoutes(true); setAnatomyLabels(true); setIsolate(Boolean(step.vessel)); onSelect(step.vessel ?? "CAD");
  }
  function leaveTour() { setTour(null); tourSettings.current = null; }
  async function exportPng() {
    if (!viewport.current || !capture.current) return;
    setExporting(true); setExportError("");
    try {
      await exportHeartPng(viewport.current, capture.current, probabilities,
        `${rotated ? "Rotated" : view} view · ${focus ? "Vessel focus" : `Original colours (${opacity}% opacity)`} · ${!showRoutes ? "Highlights hidden" : isolate && selected !== "CAD" ? `${selected} isolated; other arteries dimmed` : "All arteries highlighted"}`);
    } catch (error) { setExportError(error instanceof Error ? error.message : "Image export failed."); }
    finally { setExporting(false); }
  }
  useImperativeHandle(ref, () => ({
    capturePng() {
      if (!viewport.current || !capture.current) throw new Error("The 3D heart is not ready. Wait for it to load, then download the report again.");
      return createHeartPng(viewport.current, capture.current, probabilities,
        `${rotated ? "Rotated" : view} view · ${focus ? "Vessel focus" : `Original colours (${opacity}% opacity)`} · ${!showRoutes ? "Highlights hidden" : isolate && selected !== "CAD" ? `${selected} isolated; other arteries dimmed` : "All arteries highlighted"}`);
    },
  }));
  function resetView() {
    leaveTour();
    setView("Anterior");
    setRevision((n) => n + 1);
    setRotated(false);
  }
  function locate(name: Vessel) {
    leaveTour();
    setShowRoutes(true);
    setView(name === "LCX" ? "Left lateral" : "Anterior");
    setRevision((n) => n + 1);
    setRotated(false);
    onSelect(name);
  }

  return <div ref={viewer} className={"card coronary-viewer" + (expanded ? " expanded" : "")}
    role={expanded ? "dialog" : undefined} aria-modal={expanded || undefined}
    aria-label={expanded ? "Expanded heart anatomy" : undefined}>
    <div className="heart-head">
      <div><p className="eyebrow">EXPLORE IN 3D</p><h3>Heart anatomy</h3>
        <p className="note"><strong>Percentages show the model-estimated probability of stenosis (artery narrowing) in each vessel.</strong> They do not measure the percentage of narrowing.</p></div>
      <div className="heart-header-actions">
        <button onClick={() => void exportPng()} disabled={!ready || exporting}>{exporting ? "Exporting…" : "Export PNG"}</button>
        <button onClick={() => tour === null ? tourStep(0) : stopTour()}>{tour === null ? "Guided tour" : "End tour"}</button>
        <button onClick={resetView}>Reset view</button>
        <button ref={expandButton} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Exit expanded view" : "Expand view"}
        </button>
      </div>
    </div>
    <div className="heart-view-controls" role="group" aria-label="Heart viewing direction">
      {(Object.keys(VIEWS) as View[]).map((name) => <button key={name} aria-pressed={!rotated && view === name}
        onClick={() => { leaveTour(); setView(name); setRevision((n) => n + 1); setRotated(false); }}>{name}</button>)}
    </div>
    {exportError && <p className="error" role="alert">{exportError}</p>}
    {tour !== null && <section className="heart-tour" aria-label="Guided anatomy tour">
      <div aria-live="polite"><p className="eyebrow">STEP {tour + 1} OF {ANATOMY_TOUR.length} · {ANATOMY_TOUR[tour].view.toUpperCase()}</p>
        <h4>{ANATOMY_TOUR[tour].title}</h4><p>{ANATOMY_TOUR[tour].text}</p></div>
      <div className="heart-tour-actions"><button className="btn soft" disabled={tour === 0} onClick={() => tourStep(tour - 1)}>Back</button>
        <button className="btn primary" onClick={() => tour === ANATOMY_TOUR.length - 1 ? stopTour() : tourStep(tour + 1)}>{tour === ANATOMY_TOUR.length - 1 ? "Finish tour" : "Next"}</button></div>
    </section>}
    <div className="heart-workspace">
    <HeartErrorBoundary>
      <div ref={viewport} className="canvas-wrap tech-canvas" role="group" aria-label="Interactive coronary artery model">
        <Canvas frameloop="demand" camera={{ position: VIEWS.Anterior, fov: 40 }} dpr={[1, 1.5]}>
          <ambientLight intensity={dark ? 1.3 : 1.6} />
          <directionalLight position={[2, 4, 5]} intensity={2} />
          <directionalLight position={[-3, 1, -4]} intensity={1.4} />
          <Suspense fallback={<Html center><div className="heart-loading"><LoadingStatus label="Loading 3D heart model…" detail="Preparing the anatomy and artery highlights." /></div></Html>}>
            <RegisteredHeart probabilities={probabilities} selected={selected} onSelect={(target) => { leaveTour(); onSelect(target); }} labels={labels} focus={focus} showRoutes={showRoutes} opacity={opacity / 100} isolate={isolate} anatomyOverlay={anatomyLabels ? anatomyOverlay : undefined} onCapture={registerCapture} />
          </Suspense>
          <CameraControls view={view} revision={revision} zoom={zoom} onRotate={() => { leaveTour(); setRotated(true); }} />
        </Canvas>
        {anatomyLabels && <AnatomyLabels overlay={anatomyOverlay} />}
        {showRoutes && VESSELS.map((name) => <button key={name}
          ref={(element) => { if (element) labels.current[name] = element; else delete labels.current[name]; }}
          data-export-label className={"coronary-label" + (selected === name ? " selected" : "") + (isolate && selected !== "CAD" && selected !== name ? " dimmed" : "")}
          aria-label={`Select ${VESSEL_META[name].full}`} aria-pressed={selected === name}
          onClick={() => { leaveTour(); onSelect(name); }}>
          <b>{name}</b><span>{probabilities[name] === undefined ? "—" : `${Math.round(probabilities[name] * 100)}%`}</span>
        </button>)}
        <div data-export-label className="hud hud-tl">{rotated ? "Rotated view" : `${view} view`}</div>
        <div data-export-label className="hud hud-tr">{showRoutes ? (selected === "CAD" ? "LAD · LCX · RCA highlighted" : `${selected} ${isolate ? "isolated" : "selected"}`) : "Original anatomy"}</div>
        {!rotated && (view === "Anterior" || view === "Posterior") && <>
          <span data-export-label className="heart-side heart-side-left">Patient’s {view === "Anterior" ? "right" : "left"}</span>
          <span data-export-label className="heart-side heart-side-right">Patient’s {view === "Anterior" ? "left" : "right"}</span>
        </>}
        <div className="heart-zoom-controls" role="group" aria-label="Zoom controls">
          <button aria-label="Zoom out" onClick={() => setZoom((z) => ({ factor: 1.18, sequence: z.sequence + 1 }))}>−</button>
          <span>Drag to rotate · Pinch or scroll to zoom</span>
          <button aria-label="Zoom in" onClick={() => setZoom((z) => ({ factor: 1 / 1.18, sequence: z.sequence + 1 }))}>+</button>
        </div>
      </div>
    </HeartErrorBoundary>
      <aside className="heart-inspector" aria-label="Artery and appearance controls">
        <div className="heart-inspector-heading"><h4>Stenosis probability</h4><span>Select to locate</span></div>
        <div className="heart-locate-controls" role="group" aria-label="Locate coronary artery">
          {VESSELS.map((name) => <button key={name} aria-pressed={selected === name} onClick={() => locate(name)}>
            <div className="artery-card-heading"><b><i style={{ background: probabilities[name] === undefined ? "#94a3b8" : riskColor(probabilities[name]) }} />{name}</b>
              <strong>{probabilities[name] === undefined ? "—" : `${Math.round(probabilities[name] * 100)}%`}</strong></div>
            <span>{VESSEL_META[name].full}</span>
            <span className="artery-card-course">{VESSEL_META[name].course}</span>
          </button>)}
        </div>
        <div className="heart-inspector-heading"><h4>Appearance</h4></div>
        <div className="heart-display-controls" role="group" aria-label="Heart colour display">
          <button aria-pressed={focus} onClick={() => setFocus(true)}>Vessel focus</button>
          <button aria-pressed={!focus} onClick={() => setFocus(false)}>Original colours</button>
        </div>
        <div className={"heart-opacity-control" + (focus ? " inactive" : "")}>
          <label htmlFor="heart-opacity">Heart opacity</label>
          <output htmlFor="heart-opacity">{focus ? "Solid" : `${opacity}%`}</output>
          <input id="heart-opacity" type="range" min={0} max={100} step={1} value={opacity} disabled={focus}
            aria-valuetext={`${opacity} percent`} aria-describedby="heart-opacity-help"
            onChange={(event) => setOpacity(Number(event.target.value))} />
          <span>Transparent</span><span>Opaque</span>
        </div>
        <p className="note" id="heart-opacity-help">{focus ? "Choose Original colours to adjust transparency." : "Opacity changes the heart surface. Artery highlights stay solid."}</p>
        <div className="heart-route-control">
          <label><input type="checkbox" checked={showRoutes} onChange={(event) => { leaveTour(); setShowRoutes(event.target.checked); }} />
            Artery highlights &amp; labels</label>
          <label><input type="checkbox" checked={isolate} disabled={!showRoutes} onChange={(event) => {
            leaveTour(); setIsolate(event.target.checked); if (event.target.checked && selected === "CAD") locate("LAD");
          }} />Isolate selected artery</label>
          <p className="note">{isolate && selected !== "CAD" && showRoutes ? `${selected} stays bright; the other two arteries are dimmed.` : "Dim the other arteries while inspecting LAD, LCX or RCA."}</p>
          <label><input type="checkbox" checked={anatomyLabels} onChange={(event) => { leaveTour(); setAnatomyLabels(event.target.checked); }} />Anatomy labels</label>
          {anatomyLabels && <p className="note">Approximate surface regions. Rotate to see the left atrium at the back. Labels do not show chamber interiors.</p>}
        </div>
        <div className="heart-mini-legend"><div className="legend-bar" /><div className="legend-labels"><span>Lower probability</span><span>Higher probability</span></div></div>
      </aside>
    </div>
    <p className="note heart-reference-note">Illustrative reference paths on the heart surface; not verified native-vessel segmentation or patient-specific anatomy.</p>
    <details className="heart-details">
      <summary>Artery details &amp; anatomy notes</summary>
    <div className="coronary-table-wrap" tabIndex={0} role="region" aria-label="Coronary artery estimates">
      <table className="spec-table">
        <thead><tr><th>Artery</th><th>Reference course</th><th>Stenosis probability</th><th>Class</th></tr></thead>
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
    <div className="legend-labels"><span>Lower stenosis probability</span><span>Higher stenosis probability</span></div>
    {showRoutes && <p className="note">The reference routes illustrate how LAD and LCX share the left main coronary origin; RCA has a separate aortic origin.
      Use the lateral and posterior views to follow the arteries around the heart. Small branches and
      anatomical variants are omitted. The neutral segment marks the left main, which has no separate model estimate.</p>}
    <p className="note">This is an illustrative model, not a patient scan or clinically validated reconstruction.
      The table swatches and optional reference routes show whole-artery estimates. The original asset colours do not encode predictions.</p>
    <p className="note heart-credits">Chamber and great-vessel reference: <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC1571338/" target="_blank" rel="noreferrer">Cardiac anatomy revisited</a>. Anatomy reference: <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC4919754/" target="_blank" rel="noreferrer">normal coronary anatomy</a>.
      {" "}Heart asset by <a href="https://sketchfab.com/3d-models/anatomically-correct-human-heart-54fa880728d14c11afff78be8721620a" target="_blank" rel="noreferrer">Pigcraft</a>
      {" "}(<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>); orientation and overlays adapted.</p>
    </details>
  </div>;
}
