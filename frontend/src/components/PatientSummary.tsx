import { Heart, TrendingDown, TrendingUp } from "lucide-react";
import LoadingStatus from "./LoadingStatus";
import type { ExplainResponse, Pred, Target } from "../api";
import { fieldValueLabel } from "../fields";
import { AREA, band, plainName } from "../plain";
import { formatModelProbability } from "../anatomy/stenosis";
import Icon from "./Icon";

function show(name: string, value: number | string | null) {
  if (value === null) return "Value unavailable";
  return typeof value === "number" ? fieldValueLabel(name, value) : value;
}

export default function PatientSummary(props: {
  target: Target;
  pred: Pred;
  expl?: ExplainResponse;
  loading: boolean;
}) {
  const { target, pred, expl, loading } = props;
  const signed = expl?.signed === true;
  // only inputs the person actually entered
  const own = expl ? expl.features.filter((f) => f.provenance?.status === "recorded" || f.provenance?.status === "measured") : [];
  const up = signed
    ? own.filter((f) => f.contribution > 0.005).sort((a, b) => b.contribution - a.contribution).slice(0, 3)
    : [];
  const down = signed
    ? own.filter((f) => f.contribution < -0.005).sort((a, b) => a.contribution - b.contribution).slice(0, 3)
    : [];
  const ranked = !signed ? [...own].sort((a, b) => b.contribution - a.contribution).slice(0, 4) : [];

  return (
    <div className="card">
      <h3><Icon component={Heart} size={20} className="icon-gap" />What this means</h3>
      <p className="plain-main">
        The model estimates a <b>{band(pred.probability)}</b> chance (<b>{formatModelProbability(pred.probability)}</b>) that {AREA[target]} is
        narrowed by 50% or more.
      </p>

      {loading && <LoadingStatus label={`Explaining ${target}…`} detail="Preparing a plain-language summary of the contributing inputs." />}

      {up.length > 0 && (
        <>
          <h4 className="plain-h"><Icon component={TrendingUp} size={16} className="icon-gap-sm" />Things that made the estimate higher</h4>
          <ul className="plain-list up-list">
            {up.map((f) => (
              <li key={f.name}>
                {plainName(f.name)} <span>({show(f.name, f.value)})</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {down.length > 0 && (
        <>
          <h4 className="plain-h"><Icon component={TrendingDown} size={16} className="icon-gap-sm" />Things that made the estimate lower</h4>
          <ul className="plain-list down-list">
            {down.map((f) => (
              <li key={f.name}>
                {plainName(f.name)} <span>({show(f.name, f.value)})</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {ranked.length > 0 && (
        <>
          <h4 className="plain-h">What the model paid most attention to</h4>
          <ul className="plain-list">
            {ranked.map((f) => (
              <li key={f.name}>{plainName(f.name)}</li>
            ))}
          </ul>
        </>
      )}

      {expl?.note && <p className="note">{expl.note}</p>}
      <p className="note">
        This is a computer estimate to help start a conversation, not a diagnosis. Only a doctor can tell
        you what is happening, usually with scans or other tests. A lower estimate does not mean you are
        safe, so if you feel unwell, get medical help.
      </p>
    </div>
  );
}
