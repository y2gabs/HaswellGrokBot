"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Blob } from "./Blob";
import { BOT_GROUPS, BOTS, type BotGroup, type BotMeta } from "@/lib/bots";
import { api, timeAgo } from "@/lib/client";
import type { Thread, ThreadSummary } from "@/lib/types";

/**
 * The assistants as a vertical list, one row each, like a contacts list:
 * avatar, name, the latest line of their conversation and when it happened.
 * Tapping a row opens that assistant's latest conversation, or starts one.
 * Assistants sit in collapsible groups; groups that have assistants start open.
 */
export function BotList({ activeThreadId }: { activeThreadId?: number }) {
  const router = useRouter();
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Record<BotGroup, boolean>>(
    () => Object.fromEntries(BOT_GROUPS.map((g) => [g, BOTS.some((b) => b.group === g)])) as Record<BotGroup, boolean>,
  );

  const load = useCallback(() => {
    api<ThreadSummary[]>("/api/threads")
      .then(setThreads)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [load]);

  const activeBot = threads?.find((t) => t.id === activeThreadId)?.bot;

  async function openBot(botId: string, latest?: ThreadSummary) {
    if (latest) {
      router.push(`/chat/${latest.id}`);
      return;
    }
    setOpening(botId);
    setError("");
    try {
      const thread = await api<Thread>("/api/threads", { method: "POST", json: { bot: botId } });
      router.push(`/chat/${thread.id}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening(null);
    }
  }

  function row(bot: BotMeta) {
    const i = BOTS.indexOf(bot);
    const mine = (threads ?? []).filter((t) => t.bot === bot.id);
    const latest = mine[0]; // the API lists newest first
    const pending = mine.some((t) => t.hasPending);
    const active = activeBot === bot.id;
    return (
      <li key={bot.id}>
        <button
          onClick={() => openBot(bot.id, latest)}
          disabled={opening !== null}
          aria-current={active ? "page" : undefined}
          className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-panel disabled:opacity-60 ${
            active ? "bg-panel-2 hover:bg-panel-2" : ""
          }`}
        >
          <div className="relative shrink-0">
            <Blob color={bot.color} accent={bot.accent} size={44} variant={i} busy={opening === bot.id} />
            {pending ? (
              <span
                className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-bg bg-sky-400"
                aria-label="Needs your OK"
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-semibold">{bot.name}</span>
              {latest ? <span className="shrink-0 text-xs text-faint">{timeAgo(latest.updatedAt)}</span> : null}
            </div>
            <p className="truncate text-sm text-muted">
              {opening === bot.id
                ? "Starting…"
                : pending
                  ? "Needs your OK"
                  : latest?.snippet || bot.tagline}
            </p>
          </div>
        </button>
      </li>
    );
  }

  return (
    <div>
      {BOT_GROUPS.map((group) => {
        const bots = BOTS.filter((b) => b.group === group);
        const expanded = open[group];
        return (
          <section key={group} className="mb-1">
            <button
              onClick={() => setOpen((o) => ({ ...o, [group]: !o[group] }))}
              aria-expanded={expanded}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-muted transition hover:bg-panel"
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
              <span className="flex-1">{group}</span>
              <span className="text-xs text-faint">{bots.length}</span>
            </button>
            {expanded ? (
              bots.length ? (
                <ul className="space-y-0.5">{bots.map(row)}</ul>
              ) : (
                <p className="px-9 pb-2 pt-1 text-sm text-faint">Coming soon</p>
              )
            ) : null}
          </section>
        );
      })}
      {error ? <p className="mx-3 mt-3 rounded-2xl bg-panel px-4 py-3 text-sm text-bad">{error}</p> : null}
    </div>
  );
}
