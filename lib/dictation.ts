"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Speak-to-type for the chat box, using the browser's own speech recognition
 * (the Web Speech API — Chrome, Edge, Safari/iOS; not Firefox). Free, live as
 * you speak, and nothing passes through our server: the browser sends the
 * audio to its own speech service (Google's in Chrome, Apple's in Safari).
 *
 * Dictation only fills the box. It never sends, so the user reviews first.
 */

/* The slice of the API we use; TypeScript's DOM types don't include it. */
type RecognitionResultList = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
export type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
export type RecognitionCtor = new () => Recognition;

export function recognitionCtor(win: unknown = typeof window === "undefined" ? undefined : window) {
  const w = win as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } | undefined;
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition;
}

/** What was in the box when dictation started, plus everything heard since. */
export function joinTranscript(base: string, results: RecognitionResultList) {
  const spoken = Array.from(results, (r) => r[0]?.transcript ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!spoken) return base;
  const head = base.trimEnd();
  return head ? `${head} ${spoken}` : spoken;
}

/** A plain-words message for a recognition error, or null to ignore it. */
export function dictationError(code: string): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked — allow it for this site in your browser settings.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Speech recognition needs an internet connection.";
    case "no-speech":
    case "aborted":
      return null;
    default:
      return "Couldn't hear that. Try again.";
  }
}

/**
 * One dictation session. Kept free of React so it can be tested with a fake
 * recognizer.
 */
export function startDictation(
  Ctor: RecognitionCtor,
  base: string,
  handlers: { onText: (text: string) => void; onError: (message: string) => void; onEnd: () => void },
  opts: { lang?: string; continuous?: boolean } = {},
) {
  const rec = new Ctor();
  rec.continuous = opts.continuous ?? true;
  rec.interimResults = true;
  rec.lang = opts.lang || "en-US";
  rec.onresult = (e) => handlers.onText(joinTranscript(base, e.results));
  rec.onerror = (e) => {
    const message = dictationError(e.error);
    if (message) handlers.onError(message);
  };
  rec.onend = handlers.onEnd;
  rec.start();
  return rec;
}

const noSubscribe = () => () => undefined;

export function useDictation(setText: (text: string) => void) {
  // Read on the client only, so the server render and hydration agree.
  const supported = useSyncExternalStore(noSubscribe, () => Boolean(recognitionCtor()), () => false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<Recognition | null>(null);

  const stop = useCallback(() => active.current?.stop(), []);

  const start = useCallback(
    (base: string) => {
      const Ctor = recognitionCtor();
      if (!Ctor) return;
      active.current?.abort();
      setError("");
      try {
        const rec: Recognition = startDictation(
          Ctor,
          base,
          {
            onText: setText,
            onError: setError,
            onEnd: () => {
              if (active.current === rec) {
                active.current = null;
                setListening(false);
              }
            },
          },
          {
            lang: navigator.language,
            // Android Chrome repeats phrases in continuous mode; there a
            // session ends at a pause and another tap carries on.
            continuous: !/Android/i.test(navigator.userAgent),
          },
        );
        active.current = rec;
        setListening(true);
      } catch {
        setError("Couldn't start the microphone.");
      }
    },
    [setText],
  );

  // Let go of the microphone when the tab is hidden or the chat closes.
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && active.current?.stop();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      active.current?.abort();
    };
  }, []);

  return { supported, listening, error, start, stop, clearError: () => setError("") };
}
