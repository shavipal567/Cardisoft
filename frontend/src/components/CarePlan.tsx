
import type { Patient, PredictResponse } from "../api";
import { buildPlan } from "../careplan";

export default function CarePlan({
  patient,
  result,
  clinician,
}: {
  patient: Patient;
  result: PredictResponse;
  clinician: boolean;
}) {
  const plan = buildPlan(patient, result, clinician);

  return (
    <section className="card care-plan">
      <h3>{clinician ? "Clinical considerations" : "Your next steps"}</h3>
      <p>{plan.headline}</p>

      {plan.items.length > 0 && (
        <ul className="plain-list">
          {plan.items.map((item, index) => (
            <li key={`${item.title}-${index}`}>
              <strong>{item.title}:</strong> {item.text}
            </li>
          ))}
        </ul>
      )}

      <h4>Questions to ask your doctor</h4>
      <ul className="plain-list">
        {plan.questions.map((question) => (
          <li key={question}>{question}</li>
        ))}
      </ul>
    </section>
  );
}