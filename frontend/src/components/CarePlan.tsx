
import { ClipboardList, MessageCircleQuestion } from "lucide-react";
import type { Patient, PredictResponse } from "../api";
import { buildPlan } from "../careplan";
import Icon from "./Icon";

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
      <h3><Icon component={ClipboardList} size={20} className="icon-gap" />{clinician ? "Clinical considerations" : "Your next steps"}</h3>
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

      <h4><Icon component={MessageCircleQuestion} size={18} className="icon-gap-sm" />Questions to ask your doctor</h4>
      <ul className="plain-list">
        {plan.questions.map((question) => (
          <li key={question}>{question}</li>
        ))}
      </ul>
    </section>
  );
}