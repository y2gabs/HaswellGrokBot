"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Blob } from "./Blob";
import { BOTS, botMeta } from "@/lib/bots";
import { api, timeAgo } from "@/lib/client";
import type { Thread, ThreadSummary } from "@/lib/types";

export function HomeClient({ siteName, siteUrl, userName }: { siteName: string; siteUrl: string; userName: string }) {
  const router = useRouter();
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [menu, setMenu] = useState(false);

  const load = useCallback(() => {
    api<ThreadSummary[]>("/api/threads")
      .then(setThreads)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  async function start(bot: string) {
    setStarting(bot);
    setError("");
    try {
      const thread = await api<Thread>("/api/threads", { method: "POST", json: { bot } });
      router.push(`/chat/${thread.id}`);
    } catch (e) {
      setError((e as Error).message);
      setStarting(null);
    }
  }

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between py-2">
        <div className="min-w-0">
          <p className="text-xs text-faint">Working on</p>
          <a href={siteUrl} target="_blank" rel="noreferrer" className="block truncate font-semibold">
            {siteName}
          </a>
        </div>
        <div className="relative">
          <button
            onClick={() => setMenu((m) => !m)}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-panel-2 font-semibold"
            aria-label="Account"
          >
            {(userName || "?").slice(0, 1).toUpperCase()}
          </button>
          {menu ? (
            <div className="absolute right-0 z-10 mt-2 w-48 rounded-2xl border border-line bg-panel p-2 shadow-xl">
              <p className="px-3 py-2 text-sm text-muted">{userName}</p>
              <button onClick={signOut} className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-panel-2">
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Your team</h1>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {BOTS.map((bot, i) => (
          <button
            key={bot.id}
            onClick={() => start(bot.id)}
            disabled={starting !== null}
            className="flex flex-col items-start rounded-3xl border border-line bg-panel p-4 text-left transition active:scale-[.98] disabled:opacity-60"
          >
            <div className="floaty" style={{ animationDelay: `${i * 0.8}s` }}>
              <Blob color={bot.color} accent={bot.accent} size={64} variant={i} busy={starting === bot.id} />
            </div>
            <span className="mt-3 font-semibold">{bot.name}</span>
            <span className="mt-1 text-xs leading-snug text-muted">{bot.tagline}</span>
            <span className="mt-3 rounded-full bg-panel-2 px-3 py-1 text-xs">
              {starting === bot.id ? "Starting…" : "New chat"}
            </span>
          </button>
        ))}
      </div>

      {error ? <p className="mt-4 rounded-2xl bg-panel px-4 py-3 text-sm text-bad">{error}</p> : null}

      <h2 className="mt-8 text-sm font-medium text-muted">Recent</h2>
      <ul className="mt-2 divide-y divide-line">
        {threads === null ? (
          <li className="py-6 text-sm text-faint">Loading…</li>
        ) : threads.length === 0 ? (
          <li className="py-6 text-sm text-faint">No conversations yet. Pick a teammate above to get started.</li>
        ) : (
          threads.map((t) => {
            const meta = botMeta(t.bot) ?? BOTS[0];
            return (
              <li key={t.id}>
                <Link href={`/chat/${t.id}`} className="flex items-center gap-3 py-3">
                  <Blob color={meta.color} accent={meta.accent} size={44} variant={BOTS.indexOf(meta)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{t.title}</span>
                      <span className="shrink-0 text-xs text-faint">{timeAgo(t.updatedAt)}</span>
                    </div>
                    <p className="truncate text-sm text-muted">
                      {t.hasPending ? <span className="mr-1 text-amber-300">● Needs your OK ·</span> : null}
                      {t.snippet || meta.name}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })
        )}
      </ul>
    </main>
  );
}
