import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { FIELDS } from "../fields";
import { parseSpeech } from "../speech/parse";
import type { Parsed } from "../speech/parse";
import Icon from "./Icon";

interface SRResult { isFinal: boolean; [i: number]: { transcript: string } }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SRConstructor = new () => SpeechRec;

function getSR(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function friendly(err: string) {
  switch (err) {
    case "not-allowed":
    case "service-not-allowed":
      return "The microphone is blocked. Allow it in the browser's address bar and try again.";
    case "no-speech":
      return "No speech was heard. Try again.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "The browser's speech service needs an internet connection.";
    case "aborted":
      return "";
    default:
      return `Voice input error: ${err}`;
  }
}

function describe(p: Parsed): string[] {
  const lines: string[] = [];
  if (p.gender) lines.push(`Gender: ${p.gender}`);
  for (const [k, v] of Object.entries(p.numbers)) lines.push(`${FIELDS.find((f) => f.key === k)?.label ?? k}: ${v}`);
  for (const [k, v] of Object.entries(p.toggles)) lines.push(`${FIELDS.find((f) => f.key === k)?.label ?? k}: ${v ? "yes" : "no"}`);
  return lines;
}

export default function VoiceInput(props: { onApply: (p: Parsed) => void }) {
  const { onApply } = props;
  const SR = getSR();
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const rec = useRef<SpeechRec | null>(null);

  useEffect(() => () => rec.current?.abort(), []);

  function start() {
    if (!SR) return;
    setError("");
    setParsed(null);
    const r = new SR();
    r.lang = "en-IN";
    r.continuous = true;
    r.interimResults = true;
    let finalText = text ? text + " " : "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript + " ";
        else interim += res[0].transcript;
      }
      setText((finalText + interim).trim());
    };
    r.onerror = (e) => setError(friendly(e.error));
    r.onend = () => {
      setListening(false);
      setText(finalText.trim());
      if (finalText.trim()) setParsed(parseSpeech(finalText));
    };
    rec.current = r;
    setListening(true);
    r.start();
  }

  function stopListening() {
    rec.current?.stop();
  }

  function apply() {
    if (!parsed) return;
    onApply(parsed);
    setParsed(null);
    setText("");
  }

  return (
    <details className="voice accordion">
      <summary><Icon component={Mic} size={18} className="icon-gap" />Speak or type the details</summary>
      <p className="note">
        Try: "age 58, blood pressure 140, diabetes yes, smoker no, LDL 130". Nothing is filled in until you confirm.
      </p>
      <p className="note">
        Voice input uses your browser's speech service. In Chrome the audio is processed online, so use demo data
        only.
      </p>

      <label className="field">
        <span>What was heard (you can edit it)</span>
        <textarea
          value={text}
          rows={3}
          onChange={(e) => {
            setText(e.target.value);
            setParsed(null);
          }}
          placeholder="Say or type the details here"
        />
      </label>

      <div className="voice-actions">
        {SR ? (
          listening ? (
            <button type="button" className="btn soft small" onClick={stopListening}>
              <Icon component={Square} size={14} className="icon-gap-sm" />Stop listening
            </button>
          ) : (
            <button type="button" className="btn soft small" onClick={start}>
              <Icon component={Mic} size={16} className="icon-gap-sm" />Start speaking
            </button>
          )
        ) : (
          <span className="note">Voice recording is not available in this browser (try Chrome or Edge). You can type instead.</span>
        )}
        <button
          type="button"
          className="btn soft small"
          disabled={!text.trim() || listening}
          onClick={() => setParsed(parseSpeech(text))}
        >
          Read the details
        </button>
      </div>

      <div role="status" aria-live="polite">
        {listening && <p className="note">Listening...</p>}
        {error && <p className="error">{error}</p>}
      </div>

      {parsed && (
        <div className="heard">
          <b>I understood:</b>
          {describe(parsed).length ? (
            <ul className="plain-list">
              {describe(parsed).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : (
            <p className="note">Nothing recognised. Try again, for example "age 58, blood pressure 140".</p>
          )}
          {parsed.rejected.map((r) => (
            <p className="error" key={r.label}>
              Not applied: {r.label} {r.value} is {r.reason}.
            </p>
          ))}
          <div className="voice-actions">
            <button type="button" className="btn primary small" onClick={apply} disabled={parsed.count === 0}>
              Apply to the form
            </button>
            <button type="button" className="btn soft small" onClick={() => setParsed(null)}>
              Discard
            </button>
          </div>
          <p className="note">Check the numbers on the form before you press Analyze.</p>
        </div>
      )}
    </details>
  );
}
