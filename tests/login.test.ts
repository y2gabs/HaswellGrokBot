import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginError, wpLogin, wpLoginSite } from "@/lib/wp/auth";

const credential = {
  site: { id: 2, name: "Acme", url: "https://acme.test", restUrl: "https://acme.test/wp-json/" },
  user: { id: 7, username: "ed", displayName: "Ed", email: "ed@acme.test", role: "editor" },
  appPassword: { password: "abcd", uuid: "u1" },
};

function reply(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("in-app sign-in", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the client secret and visitor IP, and returns a session for a single site", async () => {
    const fetchMock = reply(200, credential);
    vi.stubGlobal("fetch", fetchMock);
    const result = await wpLogin("ed", "pw", "203.0.113.9");
    expect(result).toEqual({ session: credential });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://network.test/wp-json/haswell-bots/v1/login");
    expect(JSON.parse(String(init.body))).toEqual({
      username: "ed",
      password: "pw",
      client_ip: "203.0.113.9",
      client_secret: "x".repeat(40),
    });
  });

  it("passes a site choice through for multi-site editors", async () => {
    const sites = [{ id: 2, name: "Acme", url: "https://acme.test" }, { id: 3, name: "Other", url: "https://other.test" }];
    vi.stubGlobal("fetch", reply(200, { needsSite: true, ticket: "t1", sites }));
    expect(await wpLogin("ed", "pw")).toEqual({ needsSite: true, ticket: "t1", sites });

    vi.stubGlobal("fetch", reply(200, credential));
    expect(await wpLoginSite("t1", 3)).toEqual(credential);
  });

  it("shows WordPress's message for a wrong password or a lockout", async () => {
    vi.stubGlobal("fetch", reply(401, { code: "haswell_bots_bad_login", message: "Incorrect username or password." }));
    await expect(wpLogin("ed", "nope")).rejects.toMatchObject({ status: 401, message: "Incorrect username or password." });

    vi.stubGlobal("fetch", reply(429, { code: "haswell_bots_locked", message: "Too many sign-in attempts." }));
    await expect(wpLogin("ed", "nope")).rejects.toMatchObject({ status: 429 });
  });

  it("explains a client-secret mismatch as a setup problem", async () => {
    vi.stubGlobal("fetch", reply(401, { code: "haswell_bots_bad_client", message: "Unknown client." }));
    const err = await wpLogin("ed", "pw").catch((e) => e);
    expect(err).toBeInstanceOf(LoginError);
    expect(err.message).toContain("client secret");
  });
});
