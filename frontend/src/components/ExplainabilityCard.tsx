import { useId, useRef, useState } from "react";
import { BarChart3, BrainCircuit, GitBranch, ShieldAlert } from "lucide-react";
import type { ExplainResponse, FeatureContribution, Pred, PredictionContext, Target } from "../api";
import { TARGET_LABELS } from "../fields";
import { axisLabel, DIRECTION, direction, explanationMatch, featureMeta, featureValue, finite, formatContribution, formatOutput,
  PROVENANCE, provenanceDetail, statusOf, thresholdMargin, waterfall } from "../explanation";
import LoadingStatus from "./LoadingStatus";
import Icon from "./Icon";

export function ProvenanceBadge({ feature }: { feature: FeatureContribution }) {
  return <span className={`explain-provenance ${statusOf(feature)}`} title={provenanceDetail(feature)}>{PROVENANCE[statusOf(feature)].label}</span>;
}

export function FeatureDetails({ feature, explanation, onClose, id }: {
  feature: FeatureContribution; explanation: ExplainResponse; onClose: () => void; id: string;
}) {
  const { label, unit } = featureMeta(feature.name);
  const d = direction(feature.contribution, explanation.signed);
  return <section id={id} className="explain-feature-details" aria-label={`${label} details`}>
    <div className="explain-detail-heading"><h5>{label}</h5><button type="button" onClick={onClose} aria-label={`Close ${label} details`}>Close ×</button></div>
    <dl className="explain-facts">
      <div><dt>Value supplied to the model</dt><dd>{featureValue(feature)}{feature.value !== null && unit ? ` ${unit}` : ""}</dd></div>
      <div><dt>Raw input</dt><dd>{feature.value === null ? "Value unavailable" : String(feature.value)}</dd></div>
      <div><dt>Data status</dt><dd><ProvenanceBadge feature={feature} /></dd></div>
      <div><dt>Contribution</dt><dd>{formatContribution(feature.contribution, explanation.output_space, true)}</dd></div>
    </dl>
    <p>{provenanceDetail(feature)}</p>
    {feature.provenance?.method && <p className="note">Source method: {feature.provenance.method.replaceAll("_", " ")}</p>}
    <p><strong>Direction: </strong>{DIRECTION[d]}</p>
    <p>For this prediction, this contribution describes how the model uses {label.toLowerCase()} relative to its reference output. It does not establish a causal medical effect or an independent change in clinical risk.</p>
  </section>;
}

function Waterfall({ explanation, visible, verified }: { explanation: ExplainResponse; visible: FeatureContribution[]; verified: boolean }) {
  const { steps, reason } = waterfall(explanation, visible, verified);
  if (reason) return <p className="note">{reason}</p>;
  const values = steps.flatMap(s => [s.start, s.end]);
  const min = Math.min(0, ...values), max = Math.max(...values);
  const range = max - min || 1;
  const position = (v: number) => (v - min) / range * 100;
  return <>
    <p className="note">The baseline represents the reference output used by the explanation method. Feature contributions describe how this prediction differs from that reference.</p>
    <p className="note">{explanation.baseline_definition ?? "Baseline definition unavailable."}{explanation.background_rows ? ` ${explanation.background_rows} reference rows.` : ""}</p>
    {explanation.output_space === "probability" && (min < 0 || max > 1) && <p className="explain-message">Contributions are added in ranked order. Intermediate sums can fall outside 0–100%; they are not patient probability estimates. The final total reconciles with the prediction.</p>}
    <ol className="explain-waterfall" aria-label={`Baseline to prediction in ${explanation.output_space === "probability" ? "probability units" : explanation.output_space}`}>
      {steps.map((step, i) => <li key={i}>
        <span className="explain-waterfall-label">{step.name}</span>
        <span className="explain-waterfall-track" aria-hidden="true">
          <span className={`explain-waterfall-bar ${step.contribution === undefined ? "total" : direction(step.contribution, true)}`}
            style={{ left: `${position(Math.min(step.start, step.end))}%`, width: `${Math.abs(step.end - step.start) / range * 100}%` }} />
          {step.contribution !== undefined && <span className="explain-waterfall-marker" style={{ left: `${position(step.end)}%` }} />}
        </span>
        <span className="explain-waterfall-value">
          {step.contribution !== undefined && <span>{formatContribution(step.contribution, explanation.output_space)} → </span>}
          <b>{formatOutput(step.end, explanation.output_space)}</b>
        </span>
      </li>)}
    </ol>
    <p className="note">Each row ends at the cumulative explanation total in {explanation.output_space === "probability" ? "probability units" : explanation.output_space}. Intermediate sums are explanatory steps, not separate patient predictions. Other features are combined to preserve the complete sum.</p>
  </>;
}

function Reliability({ explanation, modelVersion, threshold }: { explanation?: ExplainResponse; modelVersion?: string; threshold?: number }) {
  const source = explanation?.reliability;
  const r = modelVersion && source?.model_version === modelVersion ? source : undefined;
  const atThreshold = finite(threshold) && r?.threshold === threshold;
  return <>
    {modelVersion && <p className="note explain-model-id">Model identifier: <code>{modelVersion}</code></p>}
    {r?.evaluation ? <p>{r.evaluation}{r.n_test ? ` · ${r.n_test} patients` : ""}. Validation population details are unavailable in the artifact metadata.</p>
      : <p>Validation metrics for this model are unavailable.</p>}
    <dl className="explain-facts">
      {finite(r?.roc_auc) && <div><dt>Held-out AUROC</dt><dd>{r.roc_auc.toFixed(3)}</dd></div>}
      {atThreshold && finite(r?.sensitivity) && <div><dt>Sensitivity at {formatOutput(threshold, "probability")}</dt><dd>{formatOutput(r.sensitivity, "probability")}</dd></div>}
      {atThreshold && finite(r?.specificity) && <div><dt>Specificity at {formatOutput(threshold, "probability")}</dt><dd>{formatOutput(r.specificity, "probability")}</dd></div>}
      {finite(r?.brier) && <div><dt>Held-out Brier score</dt><dd>{r.brier.toFixed(3)}</dd></div>}
      {finite(r?.selection_cv_brier) && <div><dt>CV Brier score · model selection</dt><dd>{r.selection_cv_brier.toFixed(3)}</dd></div>}
    </dl>
    {finite(r?.selection_cv_brier) && <p className="note">The CV Brier score comes from model selection, not external validation or this patient.</p>}
    <ul className="explain-limitations">
      <li>Calibration information is unavailable.{r?.calibration_method ? ` Saved calibration method: ${r.calibration_method}.` : ""}</li>
      <li>External validation information is unavailable.</li>
      <li>Patient-specific attribution stability assessment is unavailable.</li>
    </ul>
    <p className="note">The estimated probability is a model output, not confidence in the explanation. Approximate contributions can depend on the chosen reference data and sampled feature orders.</p>
    {r?.source && <p className="note">Evaluation source: {r.source}.</p>}
  </>;
}

export default function ExplainabilityCard({ target, prediction, explanation, context, loading, error, demo = false, onRetry }: {
  target: Target; prediction: Pred; explanation?: ExplainResponse; context?: PredictionContext;
  loading: boolean; error?: string; demo?: boolean; onRetry: () => void;
}) {
  const id = useId();
  // Store the response identity with the selection so even a same-target refresh
  // cannot expose details from an earlier response while React updates the UI.
  const [selection, setSelection] = useState<{ response: ExplainResponse; name: string } | null>(null);
  const [all, setAll] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const match = explanation ? explanationMatch(explanation, target, prediction, context) : "unverified";
  const expl = match === "mismatch" ? undefined : explanation;
  const ranked = [...(expl?.features ?? [])].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const visible = all ? ranked : ranked.slice(0, 8);
  const selected = selection?.response === expl ? selection?.name : undefined;
  const max = Math.max(...visible.map(f => Math.abs(f.contribution)), .0001);
  const model = context?.models?.[target];
  const margin = thresholdMargin(prediction.probability, prediction.threshold);
  const counts = visible.reduce((out, f) => { out[statusOf(f)]++; return out; }, { recorded: 0, measured: 0, default: 0, imputed: 0, unavailable: 0 });
  const close = () => { setSelection(null); trigger.current?.focus(); };
  const directionKnown = expl?.signed === true;
  return <section className="card explainability" aria-labelledby={`${id}-title`} onKeyDown={event => {
    if (event.key === "Escape" && selected) { event.preventDefault(); close(); }
  }}>
    <h3 id={`${id}-title`}><Icon component={BrainCircuit} size={20} className="icon-gap" />What influenced this estimate</h3>
    <dl className="explain-summary">
      <div><dt>Target</dt><dd>{TARGET_LABELS[target]}</dd></div>
      <div><dt>Estimated probability</dt><dd>{formatOutput(prediction.probability, "probability")}</dd></div>
      <div><dt>Classification</dt><dd><span className={`pill ${prediction.prediction === 1 ? "pos" : "neg"}`}>{prediction.prediction === 1 ? "Positive" : "Negative"}</span></dd></div>
      <div><dt>Classification threshold</dt><dd>{finite(prediction.threshold) ? formatOutput(prediction.threshold, "probability") : "Threshold unavailable"}</dd></div>
      {margin !== null && <div><dt>{margin > 0 ? "Margin above threshold" : margin < 0 ? "Margin below threshold" : "At threshold"}</dt><dd>{formatContribution(margin / 100, "probability", true)}</dd></div>}
      {model?.version && <div><dt>{model.name ?? "Model"} · identifier</dt><dd><abbr title={model.version}>{model.version.slice(0, 12)}</abbr></dd></div>}
    </dl>
    {margin !== null && margin !== 0 && formatOutput(prediction.probability, "probability") === formatOutput(prediction.threshold, "probability") && <p className="note">The displayed percentages round to the same value. Classification uses unrounded values.</p>}
    <div className="explain-chart-heading"><h4><Icon component={BarChart3} size={18} className="icon-gap-sm" />Patient-specific feature contributions</h4><p>See which input features pushed the model’s estimate higher or lower.</p></div>
    {demo && <p className="explain-message">Illustrative demo contributions. They are not calculated from this patient's inputs. Provenance and output space are unavailable.</p>}
    {loading && <LoadingStatus label={`Explaining ${TARGET_LABELS[target]}…`} detail="Calculating contributions and checking the prediction context." />}
    {(error || match === "mismatch") && <div className="explain-message" role="alert"><p>{match === "mismatch" ? "Explanation unavailable: the returned inputs, model or probability do not match this prediction. Analyze again to obtain a consistent result." : `Explanation unavailable: ${error}`}</p><button type="button" onClick={onRetry}>Retry explanation</button></div>}
    {!loading && !error && match !== "mismatch" && !visible.length && <p className="explain-message">No feature contributions are available for this prediction.</p>}
    {expl && visible.length > 0 && <>
      {!demo && match !== "verified" && <p className="explain-message">Prediction identity could not be fully verified with this server response. The waterfall is unavailable.</p>}
      {expl.invalid_features && <p className="explain-message">Some feature contributions were invalid and could not be displayed.</p>}
      <p className="explain-quality">{visible.length} features shown
        {counts.recorded > 0 && ` · ${counts.recorded} recorded`}{counts.measured > 0 && ` · ${counts.measured} measured`}
        {counts.default > 0 && ` · ${counts.default} automatically supplied`}{counts.imputed > 0 && ` · ${counts.imputed} imputed`}
        {counts.unavailable > 0 && ` · provenance unavailable for ${counts.unavailable}`}</p>
      <ul className="explain-legend" aria-label="Contribution directions">
        {directionKnown ? (["positive", "negative", "neutral"] as const).map(d => <li key={d}><span className={`explain-key ${d}`} aria-hidden="true">{d === "positive" ? "+" : d === "negative" ? "−" : "0"}</span>{DIRECTION[d]}</li>)
          : <li>Direction is unavailable; these values cannot be interpreted as increases or decreases.</li>}
      </ul>
      <p className="note" id={`${id}-help`}>Select a feature to inspect its input value, source and contribution. Values are relative to the explanation baseline.</p>
      <ol className="explain-bars" aria-label="Ranked feature contributions" aria-describedby={`${id}-help`}>
        {visible.map((f, index) => {
          const d = direction(f.contribution, expl.signed);
          const label = featureMeta(f.name).label;
          const open = selected === f.name;
          const detailId = `${id}-feature-${index}`;
          return <li key={f.name}>
            <button type="button" className={`explain-feature-row ${open ? "selected" : ""}`} aria-expanded={open}
              aria-controls={open ? detailId : undefined} aria-label={`${label}: ${formatContribution(f.contribution, expl.output_space)}. ${PROVENANCE[statusOf(f)].label}. ${open ? "Hide" : "Show"} details.`}
              onClick={event => { trigger.current = event.currentTarget; setSelection(open ? null : { response: expl, name: f.name }); }}>
              <span className="explain-feature-label"><strong>{label}</strong><ProvenanceBadge feature={f} /></span>
              <span className="explain-bar-track" aria-hidden="true">
                <span className="explain-zero" />
                <span className={`explain-bar ${d}`} style={{ left: `${f.contribution < 0 ? 50 - Math.abs(f.contribution) / max * 46 : 50}%`, width: `${Math.abs(f.contribution) / max * 46}%` }} />
              </span>
              <span className={`explain-contribution ${d}`}>{formatContribution(f.contribution, expl.output_space)}<span aria-hidden="true">{open ? "−" : "+"} details</span></span>
            </button>
            {open && <FeatureDetails id={detailId} feature={f} explanation={expl} onClose={close} />}
          </li>;
        })}
      </ol>
      <div className="explain-axis" aria-hidden="true"><div className="explain-axis-ticks"><span>−{(max * (expl.output_space === "probability" ? 100 : 1)).toFixed(2)}</span><span>0</span><span>+{(max * (expl.output_space === "probability" ? 100 : 1)).toFixed(2)}</span></div></div>
      <p className="explain-axis-title">{axisLabel(expl.output_space)}</p>
      <div className="explain-chart-footer"><p className="note">Baseline model output: <b>{formatOutput(expl.base_value, expl.output_space)}</b>{expl.approximate ? " · Approximate Shapley values" : ""}</p>
        {ranked.length > 8 && <button type="button" aria-expanded={all} onClick={() => { setAll(!all); setSelection(null); }}>{all ? "Show top 8 features" : `Show all ${ranked.length} features`}</button>}</div>
    </>}
    <details className="explain-disclosure"><summary><Icon component={GitBranch} size={16} className="icon-gap-sm" />How the estimate was formed</summary>
      {expl ? <Waterfall explanation={expl} visible={visible} verified={!demo && match === "verified"} /> : <p className="note">Waterfall unavailable until a matching explanation is available.</p>}
    </details>
    <details className="explain-disclosure"><summary><Icon component={ShieldAlert} size={16} className="icon-gap-sm" />Model reliability and limitations</summary>
      <Reliability explanation={demo ? undefined : expl} modelVersion={model?.version} threshold={prediction.threshold} />
    </details>
    <p className="explain-safety">These explanations describe how the model produced its estimate relative to a reference prediction. Feature contributions are not causal effects, do not establish a diagnosis, and are not independent changes in a patient’s clinical risk. Automatically supplied or imputed values may influence the estimate. This research prototype should be interpreted alongside appropriate clinical assessment.</p>
  </section>;
}
