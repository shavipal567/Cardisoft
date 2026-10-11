import { useEffect, useMemo } from "react";
import type { SectionId, Segment } from "../speech/script";
import { useSpeech } from "../speech/tts";

export default function ReadAloud(props: { segments: Segment[]; onSection: (id: SectionId | null) => void }) {
  const { segments, onSection } = props;
  const sp = useSpeech(onSection);
  const { stop } = sp;
  const key = useMemo(() => segments.map((s) => s.text).join("|"), [segments]);

  // if the report changes (new analysis or a different view), stop reading the old one
  useEffect(() => {
    stop();
  }, [key, stop]);

  if (!sp.supported) {
    return (
      <div className="card listen-bar">
        <span className="note">Read-aloud is not supported in this browser. Try Chrome, Edge or Safari.</span>
      </div>
    );
  }

  const shown = sp.voices.filter((v) => /^(en|hi)/i.test(v.lang));
  const list = shown.length ? shown : sp.voices;

  return (
    <div className="card listen-bar" role="region" aria-label="Read the report aloud">
      {sp.state === "idle" && (
        <button className="btn primary small" onClick={() => sp.speak(segments)} disabled={segments.length === 0}>
          🔊 Listen to this report
        </button>
      )}
      {sp.state === "speaking" && (
        <button className="btn soft small" onClick={sp.pause}>
          ⏸ Pause
        </button>
      )}
      {sp.state === "paused" && (
        <button className="btn primary small" onClick={sp.resume}>
          ▶ Resume
        </button>
      )}
      {sp.state !== "idle" && (
        <button className="btn soft small" onClick={sp.stop}>
          ⏹ Stop
        </button>
      )}

      <label>
        Speed
        <select value={sp.rate} onChange={(e) => sp.setRate(Number(e.target.value))}>
          <option value={0.8}>Slow</option>
          <option value={1}>Normal</option>
          <option value={1.2}>Fast</option>
          <option value={1.5}>Faster</option>
        </select>
      </label>

      {list.length > 1 && (
        <label>
          Voice
          <select value={sp.voiceURI} onChange={(e) => sp.setVoiceURI(e.target.value)}>
            {list.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
      )}

      {sp.state !== "idle" && sp.index >= 0 && segments[sp.index] && (
        <p className="listen-now" aria-hidden="true">
          Reading: {segments[sp.index].text}
        </p>
      )}
    </div>
  );
}
