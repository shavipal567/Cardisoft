import { Component, Suspense, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ReactNode, RefObject, Ref } from "react";
import { ChevronLeft, ChevronRight, Compass, Download, Heart, Maximize2, Pause, Play, RotateCcw } from "lucide-react";
import { Canvas, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { Target, Vessel } from "../api";
import { compareProbabilities, probabilityColor, REFERENCE_COLOR, validProbability } from "../viewer/probability";
import ProbabilityLegend from "./ProbabilityLegend";
import CameraControls from "../viewer/CameraControls";
import VesselLabels from "../viewer/VesselLabels";
import type { LabelElements } from "../viewer/VesselLabels";
import { createHeartPng, exportHeartPng } from "../viewer/exportPng";
import LoadingStatus from "./LoadingStatus";
import AnatomyLabels from "./AnatomyLabels";
import type { AnatomyOverlayRef } from "./AnatomyLabels";
import { ANATOMY_TOUR, VIEWS } from "../anatomy/exploration";
import type { View } from "../anatomy/exploration";
import { VESSELS, VESSEL_META } from "../anatomy/coronary";
import type { VesselFindings } from "../anatomy/stenosis";
import { formatModelProbability } from "../anatomy/stenosis";
import ArteryPopup from "./ArteryPopup";
import Icon from "./Icon";
import AnatomicalHeart from "../anatomy/AnatomicalHeart";
import { regionForId } from "../anatomy/regions";

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

function RegisteredHeart({ probabilities, selected, onSelect, labels, leaders, probabilityColors, focus, showRoutes, opacity, isolate, anatomyOverlay, onCapture, hoveredRegion, onRegionHover }: Pick<Props, "probabilities" | "selected"> & { onSelect: (vessel: Vessel) => void; labels: LabelElements; leaders: RefObject<SVGSVGElement | null>; probabilityColors: boolean; focus: boolean; showRoutes: boolean; opacity: number; isolate: boolean; anatomyOverlay?: AnatomyOverlayRef; onCapture: (value: Capture) => void; hoveredRegion: string | null; onRegionHover: (region: string | null) => void }) {
  return <>
    <AnatomicalHeart probabilities={probabilities} selected={selected as Vessel | "CAD"} onSelect={onSelect}
      probabilityColors={probabilityColors && showRoutes} focus={focus} opacity={opacity} isolate={isolate} anatomyOverlay={anatomyOverlay}
      hoveredRegion={hoveredRegion} onRegionHover={onRegionHover} />
    <CaptureView onCapture={onCapture} />
    {showRoutes && <>
    <VesselLabels labels={labels} leaders={leaders} transparent={!focus && opacity < .45} />
    </>}
  </>;
}

export interface HeartViewerHandle { capturePng: () => HTMLCanvasElement }

interface Props {
  ref?: Ref<HeartViewerHandle>;
  probabilities: Partial<Record<Vessel, number>>;
  classifications?: Partial<Record<Vessel, number>>;
  vesselFindings?: VesselFindings;
  cadProbability?: number;
  cadPrediction?: number;
  selected: Target;
  onSelect: (t: Target) => void;
  dark: boolean;
}

export default function HeartViewer({ ref, probabilities, classifications, vesselFindings, selected, onSelect, dark }: Props) {
  const labels = useRef<Partial<Record<Vessel, HTMLButtonElement>>>({});
  const [focus, setFocus] = useState(true);
  const [opacity, setOpacity] = useState(100);
  const [showRoutes, setShowRoutes] = useState(true);
  const [isolate, setIsolate] = useState(false);
  const [probabilityColors, setProbabilityColors] = useState(true);
  const [comparison, setComparison] = useState(false);
  const [comparisonPlaying, setComparisonPlaying] = useState(false);
  const [focused, setFocused] = useState<Vessel | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [inView, setInView] = useState(true);
  const leaders = useRef<SVGSVGElement>(null);
  const mode = !showRoutes ? "Anatomy" : isolate ? "Isolate" : comparison ? "Comparison" : "Probability";
  const comparisonIndex = Math.max(0, VESSELS.indexOf(selected as Vessel));
  const { highest, complete } = compareProbabilities(probabilities);
  const [popupSelection, setPopupSelection] = useState<Vessel | null>(null);
  const closePopup = useCallback(() => setPopupSelection(null), []);
  const popupVessel = showRoutes && popupSelection === selected ? popupSelection : null;
  const [anatomyLabels, setAnatomyLabels] = useState(true);
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const [tour, setTour] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const anatomyOverlay = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const capture = useRef<Capture>(null);
  const registerCapture = useCallback((value: Capture) => { capture.current = value; setReady(Boolean(value)); }, []);
  const tourSettings = useRef<{ isolate: boolean; anatomyLabels: boolean; showRoutes: boolean; selected: Target; view: View; focused: Vessel | null; focus: boolean; comparison: boolean } | null>(null);
  const [view, setView] = useState<View>("Anterior");
  const [revision, setRevision] = useState(0);
  const [rotated, setRotated] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState({ factor: 1, sequence: 0 });
  const expandButton = useRef<HTMLButtonElement>(null);
  const viewer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    const visibility = () => setPageVisible(!document.hidden);
    update(); visibility();
    query.addEventListener("change", update); document.addEventListener("visibilitychange", visibility);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    if (viewer.current) observer.observe(viewer.current);
    return () => { query.removeEventListener("change", update); document.removeEventListener("visibilitychange", visibility); observer.disconnect(); };
  }, []);
  const focusArtery = useCallback((name: Vessel) => {
    setView(name === "LCX" ? "Left lateral" : name === "RCA" ? "Right lateral" : "Anterior");
    setFocused(name); setRevision((n) => n + 1); setRotated(false); onSelect(name);
  }, [onSelect]);
  useEffect(() => {
    if (!comparison || !comparisonPlaying || !ready || !pageVisible || !inView) return;
    const timeout = window.setTimeout(() => { setPopupSelection(null); focusArtery(VESSELS[(comparisonIndex + 1) % VESSELS.length]); }, 5500);
    return () => clearTimeout(timeout);
  }, [comparison, comparisonPlaying, comparisonIndex, ready, pageVisible, inView, focusArtery]);
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
    closePopup();
    setTour(null);
    const saved = tourSettings.current;
    if (saved) {
      setIsolate(saved.isolate); setAnatomyLabels(saved.anatomyLabels); setShowRoutes(saved.showRoutes);
      setFocused(saved.focused); setFocus(saved.focus); setComparison(saved.comparison);
      onSelect(saved.selected); setView(saved.view); setRevision((n) => n + 1); setRotated(false);
      tourSettings.current = null;
    }
  }
  function tourStep(index: number) {
    closePopup();
    if (tour === null) tourSettings.current = { isolate, anatomyLabels, showRoutes, selected, view, focused, focus, comparison };
    const step = ANATOMY_TOUR[index];
    setComparisonPlaying(false); setComparison(false); setFocused(step.vessel ?? null);
    setTour(index); setView(step.view); setRevision((n) => n + 1); setRotated(false);
    setShowRoutes(true); setAnatomyLabels(true); setIsolate(Boolean(step.vessel)); onSelect(step.vessel ?? "CAD");
  }
  function leaveTour() { setTour(null); tourSettings.current = null; setComparisonPlaying(false); }
  async function exportPng() {
    if (!viewport.current || !capture.current) return;
    setExporting(true); setExportError("");
    try {
      await exportHeartPng(viewport.current, capture.current, probabilities,
        `${rotated ? "Rotated" : view} view · ${mode} mode · ${probabilityColors && showRoutes ? "Probability colours" : "Reference colours"} · ${focus ? "Vessel focus" : `Original colours (${opacity}% opacity)`} · ${!showRoutes ? "Highlights hidden" : isolate && selected !== "CAD" ? `${selected} isolated; other arteries dimmed` : "All arteries highlighted"}`);
    } catch (error) { setExportError(error instanceof Error ? error.message : "Image export failed."); }
    finally { setExporting(false); }
  }
  useImperativeHandle(ref, () => ({
    capturePng() {
      if (!viewport.current || !capture.current) throw new Error("The 3D heart is not ready. Wait for it to load, then download the report again.");
      return createHeartPng(viewport.current, capture.current, probabilities,
        `${rotated ? "Rotated" : view} view · ${mode} mode · ${probabilityColors && showRoutes ? "Probability colours" : "Reference colours"} · ${focus ? "Vessel focus" : `Original colours (${opacity}% opacity)`} · ${!showRoutes ? "Highlights hidden" : isolate && selected !== "CAD" ? `${selected} isolated; other arteries dimmed` : "All arteries highlighted"}`);
    },
  }));
  function resetView() {
    closePopup();
    leaveTour();
    setView("Anterior"); setFocused(null);
    setRevision((n) => n + 1);
    setRotated(false);
  }
  function selectArtery(name: Vessel) {
    leaveTour();
    setPopupSelection(popupVessel === name ? null : name);
    onSelect(name);
  }
  function locate(name: Vessel, openDetails = true) {
    leaveTour(); setShowRoutes(true); focusArtery(name);
    if (openDetails) setPopupSelection(popupVessel === name ? null : name);
  }
  function changeMode(next: string) {
    leaveTour(); closePopup();
    setShowRoutes(next !== "Anatomy"); setIsolate(next === "Isolate"); setComparison(next === "Comparison");
    setFocus(next !== "Anatomy");
    if (next === "Anatomy") { setOpacity(100); setFocused(null); setRevision((n) => n + 1); }
    if (next === "Isolate") focusArtery(selected === "CAD" ? "LAD" : selected);
    if (next === "Comparison") { setProbabilityColors(true); focusArtery(selected === "CAD" ? "LAD" : selected); }
  }
  function stepComparison(delta: number) {
    leaveTour(); closePopup(); focusArtery(VESSELS[(comparisonIndex + delta + VESSELS.length) % VESSELS.length]);
  }
  function playComparison() {
    closePopup();
    if (!comparisonPlaying) focusArtery(selected === "CAD" ? "LAD" : selected);
    setComparisonPlaying((value) => !value);
  }
  const hoveredAnatomyRegion = hoveredRegion ? regionForId(hoveredRegion) : null;

  return <div ref={viewer} className={"card coronary-viewer" + (expanded ? " expanded" : "")}
    role={expanded ? "dialog" : undefined} aria-modal={expanded || undefined}
    aria-label={expanded ? "Expanded heart anatomy" : undefined}>
    <div className="heart-head">
      <div><p className="eyebrow">EXPLORE IN 3D</p><h3><Icon component={Heart} size={20} className="icon-gap" />Heart anatomy</h3>
        <p className="note"><strong>Percentages show the model-estimated probability of stenosis (artery narrowing) in each vessel.</strong> They do not measure the percentage of narrowing.</p></div>
      <div className="heart-header-actions">
        <button onClick={() => void exportPng()} disabled={!ready || exporting}><Icon component={Download} size={14} className="icon-gap-sm" />{exporting ? "Exporting…" : "Export PNG"}</button>
        <button onClick={() => tour === null ? tourStep(0) : stopTour()}><Icon component={Compass} size={14} className="icon-gap-sm" />{tour === null ? "Guided tour" : "End tour"}</button>
        <button onClick={resetView}><Icon component={RotateCcw} size={14} className="icon-gap-sm" />Reset view</button>
        <button ref={expandButton} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          <Icon component={Maximize2} size={14} className="icon-gap-sm" />{expanded ? "Exit expanded view" : "Expand view"}
        </button>
      </div>
    </div>
    <div className="heart-mode-controls" role="group" aria-label="Visualization mode">
      {["Anatomy", "Probability", "Isolate", "Comparison"].map((name) => <button key={name}
        aria-pressed={mode === name} onClick={() => changeMode(name)}>{name}</button>)}
    </div>
    <div className="heart-view-controls" role="group" aria-label="Heart viewing direction">
      {(Object.keys(VIEWS) as View[]).map((name) => <button key={name} aria-pressed={!rotated && view === name}
        onClick={() => { leaveTour(); setFocused(null); setView(name); setRevision((n) => n + 1); setRotated(false); }}>{name}</button>)}
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
      <div className="heart-stage">
      <div ref={viewport} className="canvas-wrap tech-canvas" role="group" tabIndex={-1} aria-label="Interactive coronary artery model">
        <Canvas frameloop="demand" camera={{ position: VIEWS.Anterior, fov: 40 }} dpr={[1, 1.5]}
          onPointerMissed={(event) => { if (event.type === "click") closePopup(); }}>
          <hemisphereLight args={["#fff4e9", "#54475a", dark ? 1.15 : 1.3]} />
          <directionalLight position={[3, 4, 5]} intensity={2.1} color="#fff1e4" />
          <directionalLight position={[-4, 1, 2]} intensity={.65} color="#dce9ff" />
          <directionalLight position={[1, 3, -4]} intensity={1.4} color="#f8e4dd" />
          <Suspense fallback={<Html center><div className="heart-loading"><LoadingStatus label="Loading 3D heart model…" detail="Preparing the anatomy and artery highlights." /></div></Html>}>
            <RegisteredHeart probabilities={probabilities} selected={selected} onSelect={selectArtery} labels={labels} leaders={leaders} probabilityColors={probabilityColors} focus={focus} showRoutes={showRoutes} opacity={opacity / 100} isolate={isolate} anatomyOverlay={anatomyLabels ? anatomyOverlay : undefined} onCapture={registerCapture} hoveredRegion={hoveredRegion} onRegionHover={setHoveredRegion} />
          </Suspense>
          <CameraControls view={view} revision={revision} focused={focused} reducedMotion={reducedMotion} zoom={zoom} onRotate={() => { leaveTour(); setRotated(true); }} />
        </Canvas>
        {showRoutes && <svg ref={leaders} className="coronary-leaders" aria-hidden="true">
          {VESSELS.map((name) => <line key={name} data-vessel={name} visibility="hidden" />)}
        </svg>}
        {anatomyLabels && <AnatomyLabels overlay={anatomyOverlay} />}
        {hoveredAnatomyRegion && <aside className="anatomy-hover-card" aria-label={`${hoveredAnatomyRegion.title} information`}>
          <b>{hoveredAnatomyRegion.title}</b>
          <span aria-live="polite">{hoveredAnatomyRegion.description}</span>
        </aside>}
        {showRoutes && VESSELS.map((name) => <button key={name}
          ref={(element) => { if (element) labels.current[name] = element; else delete labels.current[name]; }}
          data-export-label className={"coronary-label" + (selected === name ? " selected" : "") + (isolate && selected !== "CAD" && selected !== name ? " dimmed" : "")}
          data-artery-trigger aria-label={`Select ${VESSEL_META[name].full}`} aria-pressed={selected === name}
          aria-haspopup="dialog" aria-expanded={popupVessel === name} aria-controls={popupVessel === name ? "artery-popup" : undefined}
          onClick={() => selectArtery(name)}>
          <b><i style={{ background: probabilityColors ? probabilityColor(probabilities[name]) : REFERENCE_COLOR }} />{name}</b><span>{formatModelProbability(probabilities[name])}</span>
        </button>)}
        <div data-export-label className="hud hud-tl">{rotated ? "Rotated view" : `${view} view`}</div>
        <div data-export-label className="hud hud-tr">{showRoutes ? (selected === "CAD" ? "LAD · LCX · RCA highlighted" : `${selected} ${isolate ? "isolated" : "selected"}`) : "Original anatomy"}</div>
        {!rotated && (view === "Anterior" || view === "Posterior") && <>
          <span data-export-label className="heart-side heart-side-left">Patient’s {view === "Anterior" ? "right" : "left"}</span>
          <span data-export-label className="heart-side heart-side-right">Patient’s {view === "Anterior" ? "left" : "right"}</span>
        </>}
        <div className="heart-zoom-controls" role="group" aria-label="Zoom controls">
          <button aria-label="Zoom out" onClick={() => { leaveTour(); setZoom((z) => ({ factor: 1.18, sequence: z.sequence + 1 })); }}>−</button>
          <span>Drag to rotate · Pinch or scroll to zoom</span>
          <button aria-label="Zoom in" onClick={() => { leaveTour(); setZoom((z) => ({ factor: 1 / 1.18, sequence: z.sequence + 1 })); }}>+</button>
        </div>
      </div>
      {popupVessel && <ArteryPopup vessel={popupVessel} probability={probabilities[popupVessel]}
        finding={vesselFindings?.[popupVessel]} probabilityColors={probabilityColors} viewport={viewport} labels={labels} onClose={closePopup} />}
      </div>
    </HeartErrorBoundary>
      <aside className="heart-inspector" aria-label="Artery and appearance controls">
        <div className="heart-inspector-heading"><h4>{comparison ? "Compare arteries" : "Vessel estimates"}</h4><span>Select to focus</span></div>
        <p className="heart-highest" aria-live="polite">{highest.length ? <>
          <strong>{highest.join(" & ")}</strong> · {highest.length > 1 ? "Joint highest" : "Highest"}{complete ? " model estimate" : " available estimate"}
          {!complete && <span>Comparison incomplete; some estimates are unavailable.</span>}
        </> : "Vessel probabilities are unavailable."}</p>
        <div className="heart-locate-controls" role="group" aria-label="Locate coronary artery">
          {VESSELS.map((name) => <button key={name} data-artery-trigger aria-pressed={selected === name} onClick={() => locate(name)}
            aria-haspopup="dialog" aria-expanded={popupVessel === name} aria-controls={popupVessel === name ? "artery-popup" : undefined}>
            <div className="artery-card-heading"><b><i style={{ background: probabilityColors ? probabilityColor(probabilities[name]) : REFERENCE_COLOR }} />{name}</b>
              <strong>{formatModelProbability(probabilities[name])}</strong></div>
            <span>{VESSEL_META[name].full}</span>
            {comparison && <span className="vessel-probability-track" aria-hidden="true"><i style={{
              width: `${validProbability(probabilities[name]) ? probabilities[name]! * 100 : 0}%`,
              background: probabilityColors ? probabilityColor(probabilities[name]) : REFERENCE_COLOR,
            }} /></span>}
            <span className="artery-card-course">{VESSEL_META[name].course}</span>
          </button>)}
        </div>
        {comparison && <section className="comparison-tour" aria-label="Animated artery comparison tour">
          <p aria-live="polite">{comparisonPlaying ? (pageVisible && inView ? "Tour playing" : "Tour suspended while hidden") : "Comparison tour paused"} · {comparisonIndex + 1} / 3 · {VESSELS[comparisonIndex]}</p>
          <div className="comparison-tour-controls">
            <button aria-label="Previous artery" disabled={!ready} onClick={() => stepComparison(-1)}><Icon component={ChevronLeft} size={16} /></button>
            <button disabled={!ready} aria-pressed={comparisonPlaying} onClick={playComparison}><Icon component={comparisonPlaying ? Pause : Play} size={14} />{comparisonPlaying ? "Pause tour" : "Play tour"}</button>
            <button aria-label="Next artery" disabled={!ready} onClick={() => stepComparison(1)}><Icon component={ChevronRight} size={16} /></button>
          </div>
          <p className="note">LAD → LCX → RCA · 5.5 seconds each. Manual navigation pauses playback.</p>
        </section>}
        <details className="heart-appearance"><summary>Appearance &amp; labels</summary>
        <div className="heart-display-controls" role="group" aria-label="Heart colour display">
          <button aria-pressed={focus} onClick={() => setFocus(true)}>Vessel focus</button>
          <button aria-pressed={!focus} onClick={() => setFocus(false)}>Original colours</button>
        </div>
        <details className="anatomy-color-legend">
          <summary>Anatomical colour legend</summary>
          <ul>
            <li><i style={{ background: "#C94F4F" }} />Systemic arteries and coronary arteries</li>
            <li><i style={{ background: "#3267C8" }} />Pulmonary trunk and cardiac veins</li>
            <li><i style={{ background: "#C77B78" }} />Heart muscle and cardiac tissue</li>
            <li><i style={{ background: "#E8D8B5" }} />Heart valves and fibrous tissue</li>
          </ul>
          <p className="note">Pulmonary arteries carry deoxygenated blood (blue); pulmonary veins carry oxygenated blood (red). This model includes the pulmonary trunk and cardiac veins, but no separately identified pulmonary veins, venae cavae, or epicardial fat.</p>
        </details>
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
          <label><input type="checkbox" checked={probabilityColors} onChange={(event) => setProbabilityColors(event.target.checked)} />Probability colours</label>
          <label><input type="checkbox" checked={showRoutes} onChange={(event) => { leaveTour(); closePopup(); setShowRoutes(event.target.checked); if (!event.target.checked) { setComparison(false); setIsolate(false); } }} />
            Artery highlights &amp; labels</label>
          <label><input type="checkbox" checked={isolate} disabled={!showRoutes} onChange={(event) => {
            leaveTour(); setComparison(false); setIsolate(event.target.checked); if (event.target.checked && selected === "CAD") locate("LAD", false);
          }} />Isolate selected artery</label>
          <p className="note">{isolate && selected !== "CAD" && showRoutes ? `${selected} stays bright; the other two arteries are dimmed.` : "Dim the other arteries while inspecting LAD, LCX or RCA."}</p>
          <label><input type="checkbox" checked={anatomyLabels} onChange={(event) => { leaveTour(); setAnatomyLabels(event.target.checked); }} />Anatomy labels</label>
          {anatomyLabels && <p className="note">Hover over a model region to highlight it and read a short description. Labels follow structures present in the supplied model; chamber interiors are not cut away.</p>}
        </div>
        </details>
        <ProbabilityLegend enabled={probabilityColors && showRoutes} />
      </aside>
    </div>
    <p className="note heart-reference-note">Anatomy from the supplied OBJ model. Vessel colours show whole-artery model estimates only; no narrowing location or severity is represented.</p>
    <details className="heart-details">
      <summary>Artery details &amp; anatomy notes</summary>
    <div className="coronary-table-wrap" tabIndex={0} role="region" aria-label="Coronary artery estimates">
      <table className="spec-table">
        <thead><tr><th>Artery</th><th>Reference course</th><th>Stenosis probability</th><th>Class</th></tr></thead>
        <tbody>{VESSELS.map((name) => {
          const probability = probabilities[name];
          const classification = classifications?.[name];
          return <tr key={name} className={selected === name ? "sel-row" : ""}>
            <td><button className="artery-select" data-artery-trigger onClick={() => locate(name)} aria-pressed={selected === name}
              aria-haspopup="dialog" aria-expanded={popupVessel === name} aria-controls={popupVessel === name ? "artery-popup" : undefined}>
              <span className="swatch" style={{ background: probabilityColors ? probabilityColor(probability) : REFERENCE_COLOR }} />{name}
            </button><br /><span className="muted">{VESSEL_META[name].full}</span></td>
            <td>{VESSEL_META[name].course}</td>
            <td>{formatModelProbability(probability)}</td>
            <td><span className={"pill " + (classification === 1 ? "pos" : "neg")}>
              {classification === undefined ? "—" : classification === 1 ? "Positive" : "Negative"}
            </span></td>
          </tr>;
        })}</tbody>
      </table>
    </div>

    {showRoutes && <p className="note">The coloured LAD, LCX and RCA meshes come from the supplied anatomical OBJ parts. Each included branch shares its parent artery's probability colour. Coronary branching and dominance vary; this reference model is not patient-specific, and the model output does not identify an affected segment. The left coronary stem remains neutral because it has no separate estimate.</p>}
    <p className="note">This anatomical reference model is not a patient scan or clinically validated reconstruction. The table and vessel meshes show whole-artery estimates; colours do not indicate a lesion location, narrowing percentage, plaque composition, blood flow, or ischemia.</p>
    <p className="note heart-credits">Heart anatomy uses the supplied FMA3.2.1 postnatal OBJ parts. The files do not include license information; confirm the source terms before redistributing the model.</p>
    </details>
  </div>;
}
