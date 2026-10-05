"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Site = { id: number; name: string; url: string };

async function post<T>(path: string, json: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Sign-in failed. Please try again.");
  return data as T;
}

/**
 * The app's own sign-in: WordPress username or email + password, checked by
 * the companion plugin. People who edit several websites pick one next.
 */
export function LoginForm({ lostPasswordUrl, initialError }: { lostPasswordUrl: string; initialError?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [busy, setBusy] = useState(false);
  const [sites, setSites] = useState<Site[] | null>(null);

  function done() {
    router.replace("/home");
    router.refresh();
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await post<{ ok?: boolean; needsSite?: boolean; sites?: Site[] }>("/api/auth/login", {
        username,
        password,
      });
      if (result.needsSite) {
        setPassword("");
        setSites(result.sites ?? []);
        setBusy(false);
        return;
      }
      done();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function chooseSite(site: Site) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await post("/api/auth/site", { site: site.id });
      done();
    } catch (err) {
      setError((err as Error).message);
      setSites(null);
      setBusy(false);
    }
  }

  if (sites) {
    return (
      <div className="mt-8 text-left">
        <p className="text-center font-medium">Choose your website</p>
        <div className="mt-4 space-y-2">
          {sites.map((site) => (
            <button
              key={site.id}
              onClick={() => chooseSite(site)}
              disabled={busy}
              className="block w-full rounded-2xl border border-line bg-panel px-4 py-3 text-left transition enabled:active:scale-[.99] enabled:hover:bg-panel-2 disabled:opacity-50"
            >
              <span className="block font-medium">{site.name}</span>
              <span className="block text-sm text-muted">{site.url.replace(/^https?:\/\//, "")}</span>
            </button>
          ))}
        </div>
        {error ? <p className="mt-4 rounded-2xl bg-panel px-4 py-3 text-sm text-bad">{error}</p> : null}
        <button onClick={() => setSites(null)} disabled={busy} className="mt-4 w-full text-center text-sm text-muted">
          Back
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={signIn} className="mt-8 space-y-3 text-left">
      <input
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Username or email"
        aria-label="Username or email"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="block w-full rounded-2xl border border-line bg-panel px-4 py-3.5 outline-none placeholder:text-faint focus:border-zinc-500"
      />
      <input
        name="password"
        type="password"
        autoComplete="current-password"
        placeholder="Password"
        aria-label="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="block w-full rounded-2xl border border-line bg-panel px-4 py-3.5 outline-none placeholder:text-faint focus:border-zinc-500"
      />
      {error ? <p className="rounded-2xl bg-panel px-4 py-3 text-sm text-bad">{error}</p> : null}
      <button
        type="submit"
        disabled={busy || !username.trim() || !password}
        className="block w-full rounded-full bg-text py-4 text-center font-semibold text-bg transition active:scale-[.98] disabled:opacity-40"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <div className="flex justify-between px-1 pt-1 text-xs text-faint">
        <a href={lostPasswordUrl} className="hover:text-muted">
          Forgot password?
        </a>
        <a href="/api/auth/start" className="hover:text-muted">
          Use your website&apos;s sign-in page
        </a>
      </div>
    </form>
  );
}
