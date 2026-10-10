import type { InputValues, Patient } from "../api";
import { displayInput } from "../assessment";

export type InputSource = "Entered" | "Imported" | "Sample";
export default function FieldStatus({ fieldKey, values, source, defaults, error }: {
  fieldKey: string; values: Patient; source?: InputSource; defaults?: InputValues; error: string;
}) {
  const missing = values[fieldKey] === undefined;
  const label = missing ? "Default" : source ?? "Entered";
  const id = `input-${encodeURIComponent(fieldKey)}`;
  return <>
    <p className="field-provenance" id={`${id}-source`}>
      <span className={`source-badge source-${label.toLowerCase()}`}>{label}</span>
      <span>{missing ? displayInput(fieldKey, {}, defaults) : label === "Imported" ? "Review against your report" : label === "Sample" ? "Example patient value" : "Provided by you"}</span>
    </p>
    {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
  </>;
}
