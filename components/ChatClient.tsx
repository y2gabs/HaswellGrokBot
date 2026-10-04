"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Blob } from "./Blob";
import { ApprovalCard, ArticleCard, ChoiceChips, ImagePicker } from "./Cards";
import { BOTS, botMeta } from "@/lib/bots";
import { api } from "@/lib/client";
import type { ChatMessage, Thread } from "@/lib/types";

type Attachment = { id: number; url: string };

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="underline">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function ChatClient({ id, siteName }: { id: number; siteName: string }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastCount = useRef(0);

  const load = useCallback(async () => {
    try {
      setThread(await api<Thread>(`/api/threads/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    api<Thread>(`/api/threads/${id}`)
      .then((t) => alive && setThread(t))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);

  // Poll while the bot is working; it saves after every step.
  const busy = Boolean(thread?.state.busy);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(load, 1200);
    return () => clearInterval(timer);
  }, [busy, load]);

  // Refresh when the user comes back to the tab (the bot may have finished).
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const visible = (thread?.messages ?? []).filter(
    (m) => !m.hidden && (m.role !== "assistant" || m.content || m.cards?.length) && m.role !== "tool",
  );
  useEffect(() => {
    if (visible.length !== lastCount.current || busy) {
      lastCount.current = visible.length;
      bottom.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [visible.length, busy, thread?.state.step]);

  async function post(path: string, json: unknown) {
    setError("");
    try {
      setThread(await api<Thread>(path, { method: "POST", json }));
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }

  async function send(message?: string) {
    const body = (message ?? text).trim();
    if ((!body && !attachments.length) || sending || busy) return;
    setSending(true);
    try {
      await post(`/api/threads/${id}/messages`, { text: body, attachments });
      if (message === undefined) setText("");
      setAttachments([]);
    } catch {
      /* error shown */
    } finally {
      setSending(false);
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files).slice(0, 4)) {
        const form = new FormData();
        form.append("file", file);
        const media = await api<Attachment>("/api/upload", { method: "POST", body: form });
        setAttachments((a) => [...a, media]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const meta = botMeta(thread?.bot ?? "") ?? BOTS[0];
  const variant = BOTS.indexOf(meta);
  const lastAssistant = [...visible].reverse().find((m) => m.role === "assistant");
  const locked = busy || sending;

  function renderMessage(m: ChatMessage) {
    if (m.role === "event") {
      return (
        <p key={m.id} className="mx-auto max-w-[85%] text-center text-xs text-faint">
          {m.display ?? m.content}
        </p>
      );
    }
    if (m.role === "user") {
      return (
        <div key={m.id} className="flex flex-col items-end gap-2">
          {m.attachments?.length ? (
            <div className="flex flex-wrap justify-end gap-2">
              {m.attachments.map((a) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={a.id} src={a.url} alt="" className="h-24 w-24 rounded-2xl object-cover" />
              ))}
            </div>
          ) : null}
          {m.content ? (
            <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl [overflow-wrap:anywhere] rounded-br-lg bg-[var(--bubble)] px-4 py-2.5 text-[var(--bubble-text)]">
              {m.content}
            </div>
          ) : null}
        </div>
      );
    }
    // assistant
    const isLatest = m.id === lastAssistant?.id;
    return (
      <div key={m.id} className="flex gap-2">
        <div className="mt-1 shrink-0">
          <Blob color={meta.color} accent={meta.accent} size={28} variant={variant} />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          {m.content ? (
            <div className="whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
              <Linkified text={m.content} />
            </div>
          ) : null}
          {(m.cards ?? []).map((card, i) => {
            if (card.type === "choices") {
              return <ChoiceChips key={i} card={card} disabled={!isLatest || locked} onPick={(t) => send(t)} />;
            }
            if (card.type === "article") return <ArticleCard key={i} card={card} />;
            if (card.type === "images") {
              return (
                <ImagePicker
                  key={i}
                  card={card}
                  disabled={locked}
                  onPick={(index) => post(`/api/threads/${id}/images`, { token: card.token, index })}
                />
              );
            }
            const action = thread?.pendingActions.find((a) => a.id === card.actionId);
            return action ? (
              <ApprovalCard
                key={i}
                action={action}
                disabled={locked}
                onDecide={(approve) => post(`/api/threads/${id}/actions/${action.id}`, { approve })}
              />
            ) : null;
          })}
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto flex h-dvh max-w-md flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 pb-3 pt-[max(.75rem,env(safe-area-inset-top))]">
        <Link href="/home" className="-ml-1 rounded-full p-2 text-muted hover:bg-panel" aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <Blob color={meta.color} accent={meta.accent} size={36} variant={variant} busy={busy} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{meta.name}</p>
          <p className="truncate text-xs text-faint">{siteName}</p>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
        {thread === null && !error ? <p className="text-center text-sm text-faint">Loading…</p> : null}
        {visible.map(renderMessage)}

        {busy ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Blob color={meta.color} accent={meta.accent} size={28} variant={variant} busy />
            <span>{thread?.state.step || "Thinking…"}</span>
            <span className="flex gap-0.5">
              <span className="dot">•</span>
              <span className="dot">•</span>
              <span className="dot">•</span>
            </span>
          </div>
        ) : null}

        {thread?.state.error && !busy ? (
          <div className="rounded-2xl border border-line bg-panel p-4 text-sm">
            <p className="text-bad">{thread.state.error}</p>
            <button
              onClick={() => post(`/api/threads/${id}/retry`, {}).catch(() => undefined)}
              className="mt-3 rounded-full bg-panel-2 px-4 py-2"
            >
              Try again
            </button>
          </div>
        ) : null}
        {error ? <p className="rounded-2xl bg-panel px-4 py-3 text-sm text-bad">{error}</p> : null}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="border-t border-line px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3"
      >
        {attachments.length ? (
          <div className="mb-2 flex gap-2">
            {attachments.map((a) => (
              <div key={a.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.url} alt="" className="h-14 w-14 rounded-xl object-cover" />
                <button
                  type="button"
                  onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                  className="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-panel-2 text-xs"
                  aria-label="Remove photo"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          {thread?.bot === "website-manager" ? (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                hidden
                onChange={(e) => upload(e.target.files)}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-panel text-muted disabled:opacity-50"
                aria-label="Attach a photo"
              >
                {uploading ? (
                  <span className="text-xs">…</span>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                )}
              </button>
            </>
          ) : null}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={busy ? "Working…" : `Message ${meta.name}`}
            className="max-h-36 min-h-11 flex-1 resize-none rounded-3xl bg-panel px-4 py-3 outline-none placeholder:text-faint"
          />
          <button
            type="submit"
            disabled={locked || (!text.trim() && !attachments.length)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-text text-bg disabled:opacity-30"
            aria-label="Send"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </form>
    </main>
  );
}
