"use client";

import { useState } from "react";
import type { Card, PendingAction } from "@/lib/types";

type ChoicesCard = Extract<Card, { type: "choices" }>;
type ArticleCardT = Extract<Card, { type: "article" }>;
type ImagesCard = Extract<Card, { type: "images" }>;

export function ChoiceChips({
  card,
  disabled,
  onPick,
}: {
  card: ChoicesCard;
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  return (
    <div className="space-y-2">
      {card.prompt ? <p className="text-sm text-muted">{card.prompt}</p> : null}
      {card.options.map((o, i) => (
        <button
          key={i}
          disabled={disabled}
          onClick={() => onPick(o.title)}
          className="block w-full rounded-2xl border border-line bg-panel px-4 py-3 text-left transition enabled:active:scale-[.99] enabled:hover:bg-panel-2 disabled:opacity-50"
        >
          <span className="block font-medium">{o.title}</span>
          {o.description ? <span className="mt-0.5 block text-sm text-muted">{o.description}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function ArticleCard({ card }: { card: ArticleCardT }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-panel">
      <div className="px-4 pt-4">
        <p className="text-xs uppercase tracking-wide text-faint">Draft article</p>
        <h3 className="mt-1 text-lg font-semibold leading-snug">{card.title}</h3>
      </div>
      <div className={`article relative px-4 pt-3 text-sm leading-relaxed text-zinc-300 ${open ? "" : "max-h-48 overflow-hidden"}`}>
        <div dangerouslySetInnerHTML={{ __html: card.html }} />
        {open ? null : <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--panel)]" />}
      </div>
      <button onClick={() => setOpen((o) => !o)} className="w-full px-4 py-3 text-left text-sm font-medium">
        {open ? "Show less" : "Read the full article"}
      </button>
    </div>
  );
}

export function ImagePicker({
  card,
  disabled,
  onPick,
}: {
  card: ImagesCard;
  disabled: boolean;
  onPick: (index: number) => Promise<void>;
}) {
  const [choosing, setChoosing] = useState<number | null>(null);
  const picked = card.picked;
  return (
    <div className="rounded-3xl border border-line bg-panel p-3">
      <p className="px-1 pb-2 text-sm text-muted">{picked === undefined ? "Pick a featured image" : "Featured image"}</p>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: card.count }, (_, i) => {
          const isPicked = picked === i;
          const faded = picked !== undefined && !isPicked;
          return (
            <button
              key={i}
              disabled={disabled || picked !== undefined || choosing !== null}
              onClick={async () => {
                setChoosing(i);
                try {
                  await onPick(i);
                } finally {
                  setChoosing(null);
                }
              }}
              className={`relative aspect-[3/2] overflow-hidden rounded-xl ring-2 transition ${
                isPicked ? "ring-white" : "ring-transparent"
              } ${faded ? "opacity-30" : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/images/${card.token}/${i}`} alt={`Option ${i + 1}`} className="h-full w-full object-cover" />
              {choosing === i ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs">Saving…</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ApprovalCard({
  action,
  disabled,
  onDecide,
}: {
  action: PendingAction;
  disabled: boolean;
  onDecide: (approve: boolean) => Promise<void>;
}) {
  const [deciding, setDeciding] = useState<boolean | null>(null);
  const done = action.status !== "pending";

  async function decide(approve: boolean) {
    setDeciding(approve);
    try {
      await onDecide(approve);
    } catch {
      /* shown by the chat */
    } finally {
      setDeciding(null);
    }
  }

  const badge: Record<PendingAction["status"], { text: string; cls: string } | null> = {
    pending: null,
    running: { text: "Applying…", cls: "text-muted" },
    done: { text: "✓ Done", cls: "text-good" },
    declined: { text: "Declined — nothing changed", cls: "text-faint" },
    failed: { text: `Failed: ${action.error ?? "the website returned an error"}`, cls: "text-bad" },
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-panel">
      {action.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={action.image} alt="" className="aspect-[3/2] w-full object-cover" />
      ) : null}
      <div className="p-4">
        <p className="text-xs uppercase tracking-wide text-faint">{done ? "Request" : "Needs your OK"}</p>
        <h3 className="mt-1 font-semibold">{action.title}</h3>
        <dl className="mt-3 space-y-3 text-sm">
          {action.changes.map((c) => (
            <div key={c.field}>
              <dt className="text-xs text-faint">{c.label}</dt>
              {c.before !== undefined ? (
                <dd className="mt-0.5 text-muted line-through decoration-zinc-600">{c.before}</dd>
              ) : null}
              <dd className="mt-0.5 break-words">{c.after}</dd>
            </div>
          ))}
        </dl>
        {done ? (
          <div className="mt-4 text-sm">
            <p className={badge[action.status]?.cls}>{badge[action.status]?.text}</p>
            {action.link && action.status === "done" ? (
              <a href={action.link} target="_blank" rel="noreferrer" className="mt-1 inline-block underline">
                View on your website
              </a>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              disabled={disabled || deciding !== null}
              onClick={() => decide(false)}
              className="rounded-full bg-panel-2 py-3 font-medium disabled:opacity-50"
            >
              {deciding === false ? "…" : "Decline"}
            </button>
            <button
              disabled={disabled || deciding !== null}
              onClick={() => decide(true)}
              className="rounded-full bg-text py-3 font-semibold text-bg disabled:opacity-50"
            >
              {deciding === true ? "Applying…" : "Approve"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
