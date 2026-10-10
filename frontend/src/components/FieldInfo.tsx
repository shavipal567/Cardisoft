import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FIELD_INFO } from "../fieldInfo";

export default function FieldInfo({ fieldKey, label }: { fieldKey: string; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 600px)").matches);
  const panelRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 600px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const info = FIELD_INFO[fieldKey];
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  if (!info) return null;
  const panel = open ? <span ref={panelRef} id={id} className="field-info-panel" role="region" aria-label={`About ${label}`}>
      <button type="button" className="field-info-close" aria-label="Close field information" onClick={() => { setOpen(false); button.current?.focus(); }}>×</button>
      <strong>{label}</strong><span>{info.intro}</span>
      <a href={`https://www.google.com/search?q=${encodeURIComponent(info.query)}`} target="_blank" rel="noopener noreferrer" aria-label={`Learn more about ${label} on Google (opens in a new tab)`}>Learn more on Google ↗</a>
    </span> : null;
  return <span className="field-info" ref={root}>
    <button type="button" className="field-info-button" ref={button} aria-label={`About ${label}`}
      aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><circle cx="12" cy="7.5" r=".7" fill="currentColor" />
      </svg>
    </button>
    {mobile && panel ? createPortal(panel, document.body) : panel}
  </span>;
}
