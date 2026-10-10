import { useEffect, useState } from "react";

import { DEMO_MODE, getModelInfo } from "../api";
import type { ModelMetrics } from "../api";

const LIMITS = [
  "Small dataset: 303 patients from one source, with no external validation.",
  "The labels come from angiography: a vessel counts as positive when it is narrowed by 50% or more.",
  "The inputs describe the patient overall, so the model cannot say where along an artery a narrowing is.",
  "LCX and RCA predictions are much weaker than CAD and LAD. Treat them with extra caution.",
  "Probabilities have not been calibrated, so 80% does not mean an 80% real-world risk.",
  "This is a research and decision-support prototype. It is not a diagnostic tool.",
];

export default function ModelInfo() {
  const [m, setM] = useState<ModelMetrics | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    getModelInfo()
      .then(setM)
      .catch((e) => setErr((e as Error).message));
  }, []);

  if (err) return <div className="card error">Could not load model information: {err}</div>;
  if (!m) return <div className="card">Loading model information...</div>;

  const pc = (x: number) => (x * 100).toFixed(1) + "%";

  return (
    <div>
      <div className="card">
        <h2>About the model</h2>
        {DEMO_MODE && <p className="note">Demo mode: saved evaluation snapshot. Predictions are illustrative fixtures.</p>}
        <p style={{ margin: "0 0 6px" }}>
          <b>{m.model_name}.</b> {m.status}
        </p>
        <p className="note">{m.evaluation}</p>
        <p className="note">
          Dataset: {m.dataset.patients} patients, {m.dataset.features} input features ({m.dataset.train} for
          training, {m.dataset.test} held back for the final test).
        </p>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>Validation metrics per target</h3>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Target</th>
                <th>Model</th>
                <th>Accuracy</th>
                <th>Always-guess baseline</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>F1</th>
                <th>ROC-AUC</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(m.targets).map(([t, r]) => (
                <tr key={t}>
                  <td><b>{t}</b></td>
                  <td>{r.model_name}</td>
                  <td>{pc(r.accuracy)}</td>
                  <td>{pc(Math.max(r.positive_rate, 1 - r.positive_rate))}</td>
                  <td>{pc(r.precision)}</td>
                  <td>{pc(r.recall)}</td>
                  <td>{r.f1.toFixed(2)}</td>
                  <td>{r.roc_auc.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          "Always-guess baseline" is the accuracy of simply predicting the most common answer every time. For
          LCX and RCA the model barely beats it, and it misses most true positives (low recall).
        </p>
      </div>

      <div className="two-col">
        <div className="card">
          <h3>Test-set class balance (share of positive patients)</h3>
          {Object.entries(m.targets).map(([t, r]) => (
            <div key={t} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>{t}</span>
                <span>{pc(r.positive_rate)}</span>
              </div>
              <div className="meter">
                <span style={{ width: `${r.positive_rate * 100}%`, background: "var(--accent)" }} />
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Limitations</h3>
          <ul className="plain-list">
            {LIMITS.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}