import type { Patient, PredictResponse } from "../api";
import { buildPlan } from "../careplan";

export default function CarePlan(props: { patient: Patient; result: PredictResponse; clinician: boolean }) {
  const { patient, result, clinician } = props;
  const plan = buildPlan(patient, result, clinician);

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3>{clinician ? "Considerations (decision support)" : "Next steps to talk through with your doctor"}</h3>
      <p className="plain-main">{plan.headline}</p>

      <div>
        {plan.items.map((it) => (
          <div className="plan-item" key={it.title}>
            <div className="plan-dot" />
            <div>
              <b>{it.title}</b>
              <div className="plan-text">{it.text}</div>
            </div>
          </div>
        ))}
      </div>

      {!clinician && (
        <>
          <h4 className="plain-h">Questions you could ask</h4>
          <ul className="plain-list">
            {plan.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </>
      )}

      <div className="urgent">
        <b>Get urgent help (112 or 108)</b> for chest pain or pressure lasting more than a few minutes, pain
        spreading to the arm, jaw or back, shortness of breath, a cold sweat, or fainting. Do not wait for this
        tool.
      </div>
      <p className="note">
        General reference thresholds (assuming mg/dL and mmHg) are used to prompt questions, and your doctor's
        ranges may differ. Nothing here is a diagnosis or treatment advice.
      </p>
    </div>
  );
}