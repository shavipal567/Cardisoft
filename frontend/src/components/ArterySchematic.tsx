import { useId } from "react";
import type { Vessel } from "../api";
import type { vesselDetail } from "../anatomy/vesselDetail";

interface Props {
  vessel: Vessel;
  drawing: ReturnType<typeof vesselDetail>;
  describedBy: string;
}

/** SVG cutaway of the registered reference route; no probability enters its geometry. */
export default function ArterySchematic({ vessel, drawing, describedBy }: Props) {
  const id = useId();
  const fill = (name: string) => `url(#${id}-${name})`;
  return <figure className="artery-popup-figure">
    <p className="artery-figure-context">Illustrative coronary artery anatomy</p>
    <div className="artery-figure-heading"><span>{vessel} · illustrative cutaway</span><span>Not to scale</span></div>
    <svg className="artery-longitudinal" viewBox={drawing.viewBox} role="img" aria-describedby={describedBy}
      aria-label={`${vessel} reference course from proximal to distal, with red arterial wall and pale lumen${drawing.plaques.length ? "; yellow illustrative plaque protrudes from the inner wall, leaving open reference segments on either side" : ""}${drawing.plaqueIsExample ? "; example location only" : ""}`}>
      <defs>
        <linearGradient id={`${id}-wall`} x1="0" y1="0" x2="0.2" y2="1">
          <stop stopColor="#9d3549" /><stop offset=".18" stopColor="#f2a099" />
          <stop offset=".4" stopColor="#d46d72" /><stop offset=".75" stopColor="#b54d61" /><stop offset="1" stopColor="#722d43" />
        </linearGradient>
        <linearGradient id={`${id}-lumen`} x1="0" y1="0" x2="0.1" y2="1">
          <stop stopColor="#b16b70" /><stop offset=".28" stopColor="#f2c4b4" />
          <stop offset=".62" stopColor="#fff0df" /><stop offset=".84" stopColor="#ffe5d0" /><stop offset="1" stopColor="#ce8c82" />
        </linearGradient>
        <linearGradient id={`${id}-plaque`} x1="0" y1="0" x2=".3" y2="1">
          <stop stopColor="#ffe5a2" /><stop offset=".4" stopColor="#e9b65c" /><stop offset="1" stopColor="#bd7d34" />
        </linearGradient>
        <radialGradient id={`${id}-opening`} cx=".65" cy=".6" r=".8">
          <stop stopColor="#ffe8d5" /><stop offset=".65" stopColor="#ebad9d" /><stop offset="1" stopColor="#a7585f" />
        </radialGradient>
      </defs>
      <path d={drawing.centerline} className="vessel-detail-shadow" transform="translate(0 3)" />
      <path d={drawing.centerline} className="vessel-detail-wall" stroke={fill("wall")} />
      <path d={drawing.wallRim} className="vessel-detail-rim" />
      <path d={drawing.wallHighlight} className="vessel-detail-highlight" />
      <path d={drawing.lumen} className="vessel-detail-lumen" fill={fill("lumen")} />
      {drawing.plaques.map((plaque, index) => <g key={index}>
        <path d={plaque.path} fill={fill("plaque")} className="vessel-detail-plaque" />
        <path d={plaque.cap} className="vessel-detail-plaque-cap" />
      </g>)}
      {drawing.ends.map((end, index) => <g key={index} transform={`translate(${end.x} ${end.y}) rotate(${end.angle})`}>
        <ellipse rx="6" ry="20" fill={fill("wall")} stroke="#913e4c" strokeWidth=".8" />
        <ellipse rx="4.2" ry="14" fill={fill("opening")} stroke="#f7c1ad" strokeWidth="1" />
      </g>)}
      {drawing.markers.map((marker) => <g key={marker.index}>
        <path d={marker.path} className="vessel-detail-lesion" />
        <path d={`M${marker.x},${marker.y} L${marker.labelX},${marker.labelY}`} className="vessel-detail-leader" />
        <circle cx={marker.labelX} cy={marker.labelY} r="8" className="vessel-detail-marker" />
        <text x={marker.labelX} y={marker.labelY} dy=".35em" textAnchor="middle" className="vessel-detail-number">{marker.index + 1}</text>
      </g>)}
      <text x={drawing.start.x - 17} y={drawing.start.y + 4} textAnchor="end"><title>Proximal</title>P</text>
      <text x={drawing.end.x + 17} y={drawing.end.y + 4}><title>Distal</title>D</text>
    </svg>
    <div className="artery-cross-sections" role="group" aria-label="Explanatory cross-sections, not patient measurements">
      <div>
        <svg viewBox="0 0 64 64" role="img" aria-label="Reference segment: open lumen surrounded by arterial wall">
          <circle cx="32" cy="32" r="27" fill={fill("wall")} stroke="#aa5360" />
          <circle cx="32" cy="32" r="20" fill={fill("opening")} stroke="#f7c1ad" strokeWidth="1.5" />
        </svg>
        <span>Reference<br />segment</span>
      </div>
      <div>
        <svg viewBox="0 0 64 64" role="img" aria-label="Illustrative stenosis: eccentric wall-attached plaque reduces the remaining lumen; no measured percentage">
          <circle cx="32" cy="32" r="27" fill={fill("wall")} stroke="#aa5360" />
          <circle cx="32" cy="32" r="20" fill={fill("opening")} stroke="#f7c1ad" strokeWidth="1.5" />
          <path d="M49.32 22 A20 20 0 0 1 22 49.32 C27 46 35 46 35 38 C34 32 42 33 44 28 C46 25 48 24 49.32 22Z"
            fill={fill("plaque")} className="vessel-detail-plaque" />
          <path d="M22 49.32 C27 46 35 46 35 38 C34 32 42 33 44 28 C46 25 48 24 49.32 22" className="vessel-detail-plaque-cap" />
        </svg>
        <span>Illustrative<br />stenosis</span>
      </div>
    </div>
    <figcaption>
      <span className="wall-key"><i />Arterial wall</span><span className="lumen-key"><i />Lumen</span><span className="plaque-key"><i />Illustrative plaque</span>
    </figcaption>
    <p className="artery-figure-context">{drawing.plaqueIsExample ? "Example location only · not patient anatomy" : drawing.markers.length ? "Numbered markers: reported segments" : "Reference course · not patient anatomy"}</p>
  </figure>;
}
