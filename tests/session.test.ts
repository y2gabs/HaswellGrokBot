import { describe, expect, it } from "vitest";
import { cleanHtml } from "@/lib/ai/prompts";
import { seal, unseal } from "@/lib/session";

describe("session cookie", () => {
  it("round-trips and rejects tampering", () => {
    const token = seal({ a: 1 });
    expect(unseal(token)).toEqual({ a: 1 });
    const parts = token.split(".");
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith("A") ? "BB" : "AA");
    expect(unseal(parts.join("."))).toBeNull();
    expect(unseal("garbage")).toBeNull();
  });
});

describe("cleanHtml", () => {
  it("keeps the allowed tags and drops everything else", () => {
    const html = cleanHtml(
      '<p onclick="x()">Hi <strong>there</strong></p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://ok.test">ok</a><img src=x onerror=alert(1)>',
    );
    expect(html).toBe('<p>Hi <strong>there</strong></p><a>bad</a><a href="https://ok.test">ok</a>');
  });
});
