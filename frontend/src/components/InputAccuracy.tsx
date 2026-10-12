import type { Assessment } from "../assessment";
import { completeness } from "../assessment";
import { TARGETS, TARGET_LABELS } from "../fields";

const pc = (value: number) => `${(value * 100).toFixed(1)}%`;

export default function InputAccuracy({ assessment, outdated = false }: {
  assessment: Assessment; outdated?: boolean;
}) {
  const { supplied, missing, percent } = completeness(assessment.inputs);
  const validation = assessment.result.context?.input_validation;
  const measured = !assessment.demo && validation?.status === "available" ? validation : null;
  return <section className="card input-accuracy" aria-label="Accuracy with available inputs">
    <div className="input-accuracy-heading">
      <div><h3>Accuracy with available inputs</h3>
        <p><b>{supplied.length} of {supplied.length + missing.length} inputs supplied</b> · {missing.length} defaulted</p></div>
      <span className="input-coverage"><b>{percent}%</b> input coverage</span>
    </div>
    {outdated && <p className="note" role="status">These scores use the last submitted inputs. Analyze again to include your changes.</p>}
    {supplied.length === 0 && <p className="input-accuracy-empty">No patient measurements supplied. Predictions use defaults only and are not personalized.</p>}
    {measured ? <>
      <p className="note">Measured on held-out test records using the same supplied fields and defaulting the same missing fields.
        This is test-set accuracy, not the chance that this patient’s prediction is correct.</p>
      <div className="input-accuracy-grid">
        {TARGETS.map((target) => {
          const score = measured.targets[target];
          return <article key={target} className="input-accuracy-target" aria-label={`${target} input validation`}>
            <h4>{TARGET_LABELS[target]}</h4>
            <strong className="input-accuracy-value">{pc(score.accuracy)}</strong>
            <span className="input-accuracy-label">test accuracy</span>
            <p>{score.correct} / {score.n_test} classified correctly</p>
            <dl>
              <div><dt>95% interval</dt><dd>{pc(score.accuracy_interval.low)}–{pc(score.accuracy_interval.high)}</dd></div>
              <div><dt>Recall</dt><dd>{score.recall === null ? "Unavailable" : pc(score.recall)}</dd></div>
              <div><dt>All inputs available</dt><dd>{pc(score.full_input_accuracy)}</dd></div>
              <div><dt>Always-guess baseline</dt><dd>{pc(score.majority_baseline)}</dd></div>
            </dl>
          </article>;
        })}
      </div>
      <details className="input-accuracy-method"><summary>How to interpret these scores</summary>
        <p className="note">Accuracy counts correct positive and negative classifications. Recall measures how many positive cases were detected.
          The always-guess baseline predicts the more common class every time.</p>
        <p className="note">The 95% Wilson intervals describe sampling uncertainty on a small, single-source test set.
          They do not account for all model or population uncertainty. This exploratory check does not validate individual clinical risk.</p>
        <p className="note">Which fields are supplied matters, not only their count. Adding inputs does not guarantee a higher accuracy score.
          These results are not used to retrain models or choose thresholds.</p>
      </details>
    </> : <p className="note">{assessment.demo
      ? "Demo mode uses fixed prediction examples; accuracy for these inputs is not evaluated."
      : "Accuracy for these inputs is unavailable. Input coverage alone cannot estimate prediction accuracy."}</p>}
  </section>;
}
