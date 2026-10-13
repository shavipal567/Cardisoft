import type { Vessel } from "../api";
import type { vesselDetail } from "../anatomy/vesselDetail";

interface Props {
  vessel: Vessel;
  drawing: ReturnType<typeof vesselDetail>;
  describedBy: string;
  color: string;
}

export default function ArterySchematic({ vessel, drawing, describedBy, color }: Props) {
  return <figure className="artery-popup-figure">
    <div className="artery-figure-heading"><span>{vessel} · reference course</span><span>Not to scale</span></div>
    <svg className="artery-longitudinal" viewBox={drawing.viewBox} role="img" aria-describedby={describedBy}
      aria-label={`${vessel} reference route with one uniform vessel colour; no lesion locations`}>
      <path d={drawing.centerline} fill="none" stroke="var(--text-strong)" strokeWidth="9" strokeLinecap="round" opacity=".5" />
      <path d={drawing.centerline} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
    </svg>
    <figcaption>Whole-vessel estimate · illustrative anatomy</figcaption>
  </figure>;
}
