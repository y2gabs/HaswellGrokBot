import { randomUUID } from "node:crypto";
import { chat, type LlmMessage } from "../ai/deepseek";
import type { Session } from "../session";
import type { ChatMessage, Thread } from "../types";
import { type Schema, WpClient, WpError } from "../wp/client";
import { systemPrompt } from "./system";
import { executeTool, parseArgs, toolsFor, type ToolContext } from "./tools";

/**
 * One bot turn: call the model, run the tools it asks for, repeat until it
 * answers in plain text or a tool hands the turn to the user (a choice, an
 * image pick, an approval). Ported from the admin plugin's chat loop.
 *
 * The thread is saved after every step, so a user who leaves mid-turn comes
 * back to the finished result.
 */

const MAX_ROUNDS = 8;
const MAX_TOOL_RESULT = 8000;
const HISTORY = 60;

const running = new Set<string>();

export function newMessage(m: Omit<ChatMessage, "id" | "createdAt">): ChatMessage {
  return { id: randomUUID(), createdAt: new Date().toISOString(), ...m };
}

/** A turn that has been "busy" this long is assumed dead (e.g. a restart). */
export function isBusy(thread: Thread) {
  const started = thread.state.startedAt ? Date.parse(thread.state.startedAt) : 0;
  return Boolean(thread.state.busy) && Date.now() - started < 5 * 60_000;
}

export function siteKey(session: Session) {
  return `${session.site.url}|${session.user.id}`;
}

const schemaCache = new Map<string, { at: number; schema: Schema }>();

async function loadSchema(wp: WpClient, key: string) {
  const hit = schemaCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.schema;
  const schema = await wp.schema();
  schemaCache.set(key, { at: Date.now(), schema });
  return schema;
}

/** Convert stored messages into the model's format. */
export function toLlm(messages: ChatMessage[]): LlmMessage[] {
  let start = Math.max(0, messages.length - HISTORY);
  // Never start mid tool exchange.
  while (start > 0 && messages[start].role !== "user" && messages[start].role !== "event") start--;

  const out: LlmMessage[] = [];
  const slice = messages.slice(start);
  for (let i = 0; i < slice.length; i++) {
    const m = slice[i];
    if (m.role === "user") {
      const notes = (m.attachments ?? []).map((a) => `[Attached image: media id ${a.id}, ${a.url}]`);
      out.push({ role: "user", content: [m.content, ...notes].filter(Boolean).join("\n") || "(no text)" });
    } else if (m.role === "event") {
      out.push({ role: "user", content: `[Event] ${m.content}` });
    } else if (m.role === "assistant") {
      const calls = m.toolCalls ?? [];
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(calls.length
          ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })) }
          : {}),
      });
      // Every tool call needs a result; patch any lost to an interrupted turn.
      const answered = new Set(slice.filter((x) => x.role === "tool").map((x) => x.toolCallId));
      for (const c of calls) {
        if (!answered.has(c.id)) {
          out.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify({ error: "Interrupted." }) });
        }
      }
    } else if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content });
    }
  }
  return out;
}

/**
 * Run a turn for a thread, saving as it goes. Safe to call in the background;
 * a second call for the same thread while one is running is ignored.
 */
export async function runTurn(session: Session, threadId: number): Promise<void> {
  const lock = `${siteKey(session)}#${threadId}`;
  if (running.has(lock)) return;
  running.add(lock);

  const wp = new WpClient(session);
  let thread: Thread | null = null;

  // Write-through only: the in-memory thread stays the source of truth for
  // this turn (tools hold references into it).
  const save = async () => {
    if (thread) await wp.saveThread(thread);
  };

  try {
    thread = await wp.getThread(threadId);
    thread.state = { ...thread.state, busy: true, error: undefined, step: "Thinking…", startedAt: new Date().toISOString() };
    await save();

    let schema: Schema | null = null;
    const getSchema = async () => (schema ??= await loadSchema(wp, siteKey(session)));
    if (thread.bot === "website-manager") await getSchema().catch(() => null);

    const ctx: ToolContext = {
      wp,
      get thread() {
        return thread!;
      },
      siteKey: siteKey(session),
      schema: getSchema,
      step: async (label) => {
        thread!.state.step = label;
        await save();
      },
    };

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const system: LlmMessage = { role: "system", content: systemPrompt(thread.bot, session.site.name, schema) };
      const reply = await chat([system, ...toLlm(thread.messages)], toolsFor(thread.bot));

      const assistant = newMessage({
        role: "assistant",
        content: reply.content,
        toolCalls: reply.toolCalls.length ? reply.toolCalls : undefined,
      });
      thread.messages.push(assistant);

      if (!reply.toolCalls.length) {
        await save();
        return;
      }

      let stop = false;
      for (const call of reply.toolCalls) {
        const outcome = await executeTool(call.name, parseArgs(call.arguments), ctx);
        let content = JSON.stringify(outcome.result ?? null);
        if (content.length > MAX_TOOL_RESULT) content = content.slice(0, MAX_TOOL_RESULT) + "…(truncated)";
        thread.messages.push(
          newMessage({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content,
            summary: outcome.summary,
            isError: outcome.isError,
          }),
        );
        if (outcome.cards?.length) assistant.cards = [...(assistant.cards ?? []), ...outcome.cards];
        stop ||= Boolean(outcome.stop);
      }
      thread.state.step = "Thinking…";
      await save();
      if (stop) return;
    }

    thread.messages.push(
      newMessage({ role: "assistant", content: "I wasn't able to finish that in a reasonable number of steps. Could you rephrase?" }),
    );
  } catch (err) {
    if (thread) {
      thread.state.error =
        err instanceof WpError || err instanceof Error ? err.message : "Something went wrong. Please try again.";
    }
  } finally {
    if (thread) {
      thread.state = { ...thread.state, busy: false, step: undefined, startedAt: undefined };
      await wp.saveThread(thread).catch(() => undefined);
    }
    running.delete(lock);
  }
}
