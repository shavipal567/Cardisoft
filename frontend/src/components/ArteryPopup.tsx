import { useEffect, useId, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { Vessel } from "../api";
import { VESSEL_META } from "../anatomy/coronary";
import { formatModelProbability, normalizeVesselFindings } from "../anatomy/stenosis";
import type { VesselFinding } from "../anatomy/stenosis";
import { vesselDetail } from "../anatomy/vesselDetail";
import { popupPosition } from "../viewer/popupPosition";
import ArterySchematic from "./ArterySchematic";

interface Props {
  vessel: Vessel;
  probability?: number;
  finding?: VesselFinding;
  viewport: RefObject<HTMLDivElement | null>;
  labels: RefObject<Partial<Record<Vessel, HTMLButtonElement>>>;
  onClose: () => void;
}

function restoreFocus(trigger: RefObject<HTMLElement | null>, viewport: RefObject<HTMLDivElement | null>) {
  const element = trigger.current;
  if (element?.isConnected && element !== document.body && getComputedStyle(element).visibility !== "hidden") element.focus({ preventScroll: true });
  else viewport.current?.focus({ preventScroll: true });
}

export default function ArteryPopup({ vessel, probability, finding, viewport, labels, onClose }: Props) {
  const titleId = useId();
  const plaqueNoteId = `${titleId}-plaque-note`;
  const panel = useRef<HTMLDivElement>(null);
  const connector = useRef<SVGPathElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const data = useMemo(() => normalizeVesselFindings({ [vessel]: finding })?.[vessel], [vessel, finding]);
  const drawing = useMemo(() => vesselDetail(vessel, data?.lesions), [vessel, data]);

  useLayoutEffect(() => {
    const popup = panel.current, container = viewport.current;
    if (!popup || !container) return;
    const place = () => {
      // Dock below narrow canvases so the heart and controls stay unobstructed.
      if (container.clientWidth <= 760) {
        popup.dataset.docked = "true";
        connector.current?.setAttribute("d", "");
        popup.style.setProperty("--popup-max-height", "450px");
        return;
      }
      const bounds = container.getBoundingClientRect();
      connector.current?.ownerSVGElement?.setAttribute("height", String(container.clientHeight));
      const relativeRect = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left - bounds.left, top: rect.top - bounds.top, width: rect.width, height: rect.height };
      };
      const label = labels.current[vessel];
      const labelVisible = label && getComputedStyle(label).visibility !== "hidden";
      const anchor = labelVisible ? relativeRect(label) : { left: bounds.width / 2, top: bounds.height / 2, width: 0, height: 0 };
      const obstacles = [...container.querySelectorAll<HTMLElement>(".coronary-label, .anatomy-label")]
        .filter((element) => getComputedStyle(element).visibility !== "hidden").map(relativeRect);
      popup.style.setProperty("--popup-max-height", `${Math.max(120, container.clientHeight - 110)}px`);
      const point = popupPosition(container.clientWidth, container.clientHeight,
        { width: popup.offsetWidth, height: popup.offsetHeight }, anchor, obstacles);
      // Even on a wide canvas a projected label can occupy the available side
      // space. Dock instead of covering it or moving it off its artery anchor.
      const coversLabel = obstacles.some((rect) => point.left < rect.left + rect.width
        && point.left + popup.offsetWidth > rect.left && point.top < rect.top + rect.height
        && point.top + popup.offsetHeight > rect.top);
      popup.dataset.docked = String(coversLabel);
      if (coversLabel) {
        connector.current?.setAttribute("d", "");
        return;
      }
      popup.style.left = `${point.left}px`;
      popup.style.top = `${point.top}px`;
      // Link to the existing projected artery label, never to a fabricated lesion.
      const cx = anchor.left + anchor.width / 2, cy = anchor.top + anchor.height / 2;
      const x = Math.max(point.left, Math.min(cx, point.left + popup.offsetWidth));
      const y = Math.max(point.top + 16, Math.min(cy, point.top + popup.offsetHeight - 16));
      const dx = x - cx, dy = y - cy;
      const ratio = Math.min(Math.abs(dx) > .01 ? anchor.width / 2 / Math.abs(dx) : Infinity,
        Math.abs(dy) > .01 ? anchor.height / 2 / Math.abs(dy) : Infinity, 1);
      const startX = cx + dx * ratio, startY = cy + dy * ratio;
      connector.current?.setAttribute("d", labelVisible && Math.hypot(x - startX, y - startY) > 5
        ? `M${startX},${startY} L${x},${y}` : "");
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(popup); resize.observe(container);
    // Follow the existing projected DOM labels during demand-rendered orbit/zoom.
    // Position changes never update React state or rebuild the heart geometry.
    const movement = new MutationObserver(place);
    Object.values(labels.current).forEach((label) => movement.observe(label, { attributes: true, attributeFilter: ["style"] }));
    return () => { resize.disconnect(); movement.disconnect(); };
  }, [vessel, viewport, labels]);

  useEffect(() => {
    if (!panel.current?.contains(document.activeElement)) trigger.current = document.activeElement as HTMLElement | null;
    close.current?.focus({ preventScroll: panel.current?.dataset.docked !== "true" });
  }, [vessel]);

  const dismissAndFocus = () => {
    onClose();
    restoreFocus(trigger, viewport);
  };

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || panel.current?.contains(event.target)) return;
      // Canvas misses are handled by R3F after hit testing, so a second click on
      // the same artery can toggle closed without a pointerdown/click race.
      if (event.target.closest("[data-artery-trigger]") || viewport.current?.querySelector("canvas") === event.target) return;
      onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); onClose(); restoreFocus(trigger, viewport);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [onClose, viewport]);

  return <>
    <svg className="artery-popup-connector" aria-hidden="true"><path ref={connector} /></svg>
    <div ref={panel} id="artery-popup" className="artery-popup" data-vessel={vessel}
    role="dialog" aria-modal="false" aria-labelledby={titleId} aria-describedby={plaqueNoteId}>
    <div className="artery-popup-head">
      <div><h4 id={titleId}>{vessel}</h4><p>{VESSEL_META[vessel].full}</p></div>
      <button ref={close} type="button" aria-label={`Close ${vessel} vessel details`} onClick={dismissAndFocus}>×</button>
    </div>
    <div className="artery-popup-content" aria-live="polite" aria-atomic="true">
      <ArterySchematic vessel={vessel} drawing={drawing} describedBy={plaqueNoteId} />
      {data ? <details className="artery-popup-findings" open={data.lesions.length === 1}>
        <summary>Reported stenosis · {data.lesions.length} {data.lesions.length === 1 ? "segment" : "segments"}</summary>
        {data.lesions.map((lesion, index) => <div key={index} className="artery-popup-finding">
          <strong>Segment {index + 1}</strong>
          <span>Location: {lesion.location ?? (lesion.start_fraction !== undefined ? `${Math.round(lesion.start_fraction * 100)}–${Math.round(lesion.end_fraction! * 100)}% along reference route` : "unavailable")}</span>
          <span>Diameter narrowing: <b>{lesion.diameter_stenosis_percent === undefined ? "unavailable" : `${lesion.diameter_stenosis_percent}%`}</b></span>
          {lesion.start_fraction === undefined && <span className="muted">Position on vessel unavailable; segment not drawn.</span>}
        </div>)}
        {data.source && <p className="note">Source: {data.source}</p>}
      </details> : <details className="artery-popup-findings artery-popup-unavailable">
        <summary>Clinical data unavailable</summary>
        <p>Location &amp; diameter narrowing not supplied for {vessel}.</p>
      </details>}
    </div>
    <p className="artery-popup-probability" aria-label="Model-estimated probability of stenosis">Model-estimated probability <strong>{formatModelProbability(probability)}</strong><span>Not a measurement of diameter narrowing.</span></p>
    <p id={plaqueNoteId} className="artery-popup-plaque-note">Illustrative visualization only. The plaque shown does not represent this patient's actual plaque burden, location, or degree of stenosis.</p>
  </div></>;
}
