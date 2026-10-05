import { describe, expect, it, vi } from "vitest";
import { dictationError, joinTranscript, recognitionCtor, startDictation, type Recognition } from "@/lib/dictation";

type Result = { 0: { transcript: string }; length: 1; isFinal: boolean };
const result = (transcript: string, isFinal = true): Result => ({ 0: { transcript }, length: 1, isFinal });

class FakeRecognition implements Recognition {
  static last: FakeRecognition;
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: Recognition["onresult"] = null;
  onerror: Recognition["onerror"] = null;
  onend: Recognition["onend"] = null;
  started = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
}

describe("joinTranscript", () => {
  it("appends what was heard to what was typed", () => {
    expect(joinTranscript("Change our", [result(" long tagline", false)])).toBe("Change our long tagline");
    expect(joinTranscript("", [result("Add a team member"), result(" called Sam", false)])).toBe(
      "Add a team member called Sam",
    );
  });

  it("leaves the box alone until something is heard", () => {
    expect(joinTranscript("Hello ", [])).toBe("Hello ");
    expect(joinTranscript("Hello", [result("  ")])).toBe("Hello");
  });
});

describe("dictationError", () => {
  it("explains a blocked microphone and ignores silence", () => {
    expect(dictationError("not-allowed")).toContain("blocked");
    expect(dictationError("no-speech")).toBeNull();
    expect(dictationError("aborted")).toBeNull();
  });
});

describe("recognitionCtor", () => {
  it("finds the standard or webkit constructor, or nothing (Firefox)", () => {
    expect(recognitionCtor({ SpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
    expect(recognitionCtor({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition);
    expect(recognitionCtor({})).toBeUndefined();
  });
});

describe("startDictation", () => {
  it("streams live text into the box and reports the end", () => {
    const onText = vi.fn();
    const onError = vi.fn();
    const onEnd = vi.fn();
    startDictation(FakeRecognition, "Please", { onText, onError, onEnd }, { lang: "en-GB" });
    const rec = FakeRecognition.last;

    expect(rec.started).toBe(true);
    expect(rec).toMatchObject({ continuous: true, interimResults: true, lang: "en-GB" });

    rec.onresult?.({ results: [result("update the", false)] });
    rec.onresult?.({ results: [result("update the phone number")] });
    expect(onText).toHaveBeenLastCalledWith("Please update the phone number");

    rec.onerror?.({ error: "no-speech" });
    expect(onError).not.toHaveBeenCalled();
    rec.onerror?.({ error: "not-allowed" });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("blocked"));

    rec.stop();
    expect(onEnd).toHaveBeenCalled();
  });
});
