import type { InputValues, Patient } from "../api";
import { completeness, displayInput } from "../assessment";
import { FIELDS } from "../fields";

export default function InputCompleteness({ inputs, effective, submitted = false, defaultsError = "" }: {
  inputs: Patient; effective?: InputValues; submitted?: boolean; defaultsError?: string;
}) {
  const { supplied, missing, percent } = completeness(inputs);
  return <section className="input-completeness" aria-label={submitted ? "Assessment input completeness" : "Form input completeness"}>
    <div className="completeness-heading"><div><h3>{submitted ? "Inputs used in this assessment" : "Input completeness"}</h3>
      <p><b>{supplied.length} supplied</b><span> · </span><b>{missing.length} {submitted ? "defaulted" : "will use defaults"}</b></p></div>
      <strong>{percent}%</strong></div>
    <progress value={supplied.length} max={FIELDS.length} aria-label="Proportion of model inputs supplied" />
    <p className="note">This measures input coverage, not prediction confidence. Only enter measurements you know.</p>
    {defaultsError && <p className="note">Default values could not be loaded. Omitted fields still use server defaults.</p>}
    {missing.length > 0 ? <details>
      <summary>{submitted ? "Review defaulted inputs" : "Review missing inputs"} ({missing.length})</summary>
      <ul className="default-input-list">{missing.map((field) => <li key={field.key}><span>{field.label}</span>
        <b>{displayInput(field.key, inputs, effective)}</b></li>)}</ul>
    </details> : <p className="note">All {FIELDS.length} inputs were provided; no preset defaults {submitted ? "were" : "will be"} used.</p>}
  </section>;
}
