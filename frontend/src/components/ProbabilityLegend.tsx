import { PROBABILITY_GRADIENT, PROBABILITY_STOPS } from "../viewer/probability";

export default function ProbabilityLegend({ enabled }: { enabled: boolean }) {
  return <div className="probability-legend" aria-label="Model-estimated probability of stenosis colour scale">
    <strong>Model-estimated probability of stenosis</strong>
    <div className="probability-ticks">{PROBABILITY_STOPS.map((s) => <span key={s.value}>{s.value * 100}%</span>)}</div>
    <div className="probability-gradient" style={{ background: PROBABILITY_GRADIENT }} />
    <div className="probability-ticks probability-color-names">{PROBABILITY_STOPS.map((s) => <span key={s.value}>{s.name}</span>)}</div>
    <div className="legend-labels"><span>Lower probability</span><span>Higher probability</span></div>
    <p className="note">{enabled ? "One uniform colour per vessel." : "Probability colours off; vessels use a neutral reference colour."} Display colours are not clinically validated severity categories.</p>
  </div>;
}
