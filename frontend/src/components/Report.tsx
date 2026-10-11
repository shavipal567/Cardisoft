import { useState } from "react";
import type { ExplainResponse, Patient, PredictResponse } from "../api";
import { buildReport, spoken } from "../report";
import ReadAloud from "./ReadAloud";
import type { Section } from "../report";

type RA = Parameters<typeof ReadAloud>[0];

export default function Report(props: {
  clinician: boolean;
  name: string;
  patient: Patient;
  result: PredictResponse;
  expl?: ExplainResponse;
}) {
  const [brief, setBrief] = useState(true);
  const [reading, setReading] = useState<string | null>(null);
  const sections: Section[] = buildReport(props);

  // the audio reads the report: short = the main points, full = adds the explanations
  const segments = sections.flatMap((s) =>
    [s.say, brief ? "" : s.more ?? ""].filter(Boolean).map((t) => ({ id: s.id, text: spoken(t) }))
  );

  return (
    <div className="report">
      <div className="report-head">
        <h3>{props.clinician ? "Clinical report" : "Your report"}</h3>
        <label className="check">
          <input type="checkbox" checked={brief} onChange={() => setBrief((v) => !v)} />
          <span>Short audio (under 2 minutes)</span>
        </label>
      </div>

      <ReadAloud
        segments={segments as unknown as RA["segments"]}
        onSection={setReading as unknown as RA["onSection"]}
      />

      <div className="card">
        {props.name && (
          <p className="who">
            Report for <b>{props.name}</b> · {new Date().toLocaleDateString()}
          </p>
        )}
        {sections.map((s) => (
          <section key={s.id} className={"rsec" + (reading === s.id ? " reading" : "")}>
            <h4>{s.title}</h4>
            {s.paras?.map((p) => <p key={p}>{p}</p>)}
            {s.bullets && (
              <ul className="plain-list">
                {s.bullets.map((b) => <li key={b}>{b}</li>)}
              </ul>
            )}
          </section>
        ))}
        <p className="note">
          Clinical Safety Notice: a machine-learning research and decision-support prototype for education and
          demonstration. Not a diagnosis and not a substitute for clinical assessment.
        </p>
      </div>
    </div>
  );
}
