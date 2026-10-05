import { after, NextResponse } from "next/server";
import { authed, handleError, jsonError } from "@/lib/api";
import { newMessage, runTurn } from "@/lib/agent/loop";
import { botMeta } from "@/lib/bots";

export async function GET(request: Request) {
  const auth = await authed(request);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await auth.wp.listThreads());
  } catch (err) {
    return handleError(err);
  }
}

/** Start a conversation with a bot. */
export async function POST(request: Request) {
  const auth = await authed(request);
  if (auth.error) return auth.error;
  const { bot } = (await request.json().catch(() => ({}))) as { bot?: string };
  const meta = botMeta(bot ?? "");
  if (!meta) return jsonError(400, "Unknown bot.");

  try {
    const thread = await auth.wp.createThread(meta.id, meta.name);
    if (meta.greeting) {
      // A fixed hello costs nothing and answers instantly.
      thread.messages.push(
        newMessage({
          role: "assistant",
          content: meta.greeting,
          cards: [{ type: "choices", options: meta.starters.map((title) => ({ title })) }],
        }),
      );
    } else {
      // Bots that open with suggestions (Marketing) start working right away.
      thread.messages.push(newMessage({ role: "event", content: "The user opened a new conversation.", hidden: true }));
      thread.state = { busy: true, step: "Thinking…", startedAt: new Date().toISOString() };
      after(() => runTurn(auth.session, thread.id));
    }
    const saved = await auth.wp.saveThread(thread);
    return NextResponse.json(saved, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
