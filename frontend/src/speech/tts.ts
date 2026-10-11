import { useCallback, useEffect, useRef, useState } from "react";
import type { SectionId, Segment } from "./script";

function pickDefault(v: SpeechSynthesisVoice[]) {
  return (
    v.find((x) => x.lang === "en-IN") ??
    v.find((x) => x.lang.startsWith("en-GB")) ??
    v.find((x) => x.lang.startsWith("en")) ??
    v[0]
  );
}

export function useSpeech(onSection: (id: SectionId | null) => void) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState("");
  const [rate, setRate] = useState(1);
  const [state, setState] = useState<"idle" | "speaking" | "paused">("idle");
  const [index, setIndex] = useState(-1);

  const run = useRef(0);
  const rateRef = useRef(rate);
  const voiceRef = useRef(voiceURI);
  const secRef = useRef(onSection);
  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { voiceRef.current = voiceURI; }, [voiceURI]);
  useEffect(() => { secRef.current = onSection; }, [onSection]);

  useEffect(() => {
    if (!supported) return;
    const load = () => {
      const v = window.speechSynthesis.getVoices();
      setVoices(v);
      setVoiceURI((cur) => cur || pickDefault(v)?.voiceURI || "");
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [supported]);

  useEffect(
    () => () => {
      run.current++;
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    []
  );

  const stop = useCallback(() => {
    run.current++;
    if (supported) window.speechSynthesis.cancel();
    setState("idle");
    setIndex(-1);
    secRef.current(null);
  }, [supported]);

  const speak = useCallback(
    (segments: Segment[]) => {
      if (!supported || segments.length === 0) return;
      window.speechSynthesis.cancel();
      const id = ++run.current;
      const finish = () => {
        setState("idle");
        setIndex(-1);
        secRef.current(null);
      };
      const next = (i: number) => {
        if (id !== run.current) return;
        if (i >= segments.length) return finish();
        const u = new SpeechSynthesisUtterance(segments[i].text);
        const voice = window.speechSynthesis.getVoices().find((x) => x.voiceURI === voiceRef.current);
        if (voice) {
          u.voice = voice;
          u.lang = voice.lang;
        } else {
          u.lang = "en-IN";
        }
        u.rate = rateRef.current;
        u.onstart = () => {
          if (id !== run.current) return;
          setIndex(i);
          setState("speaking");
          secRef.current(segments[i].id);
        };
        u.onend = () => next(i + 1);
        u.onerror = () => {
          if (id === run.current) finish();
        };
        window.speechSynthesis.speak(u);
      };
      // a short delay lets cancel() settle in some browsers
      window.setTimeout(() => next(0), 60);
    },
    [supported]
  );

  const pause = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.pause();
    setState("paused");
  }, [supported]);

  const resume = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.resume();
    setState("speaking");
  }, [supported]);

  return { supported, voices, voiceURI, setVoiceURI, rate, setRate, state, index, speak, pause, resume, stop };
}
