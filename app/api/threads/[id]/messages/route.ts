import { NextResponse } from "next/server";
import { authed, handleError, jsonError, threadId } from "@/lib/api";
import { withTurn } from "@/lib/agent/kickoff";
import { newMessage } from "@/lib/agent/loop";
import { botMeta } from "@/lib/bots";

/** The user says something (optionally with attached photos). */
export async function POST(request: Request, ctx: RouteContext<"/api/threads/[id]/messages">) {
  const auth = await authed(request);
  if (auth.error) return auth.error;
  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    attachments?: { id: number; url: string }[];
  };
  const text = (body.text ?? "").trim().slice(0, 4000);
  const attachments = (body.attachments ?? [])
    .filter((a) => Number.isInteger(a?.id) && typeof a?.url === "string")
    .slice(0, 6);
  if (!text && !attachments.length) return jsonError(400, "Say something first.");

  try {
    const thread = await withTurn(auth.session, auth.wp, threadId((await ctx.params).id), (t) => {
      t.messages.push(newMessage({ role: "user", content: text, attachments: attachments.length ? attachments : undefined }));
      if (t.title === botMeta(t.bot)?.name && text) t.title = text.length > 60 ? text.slice(0, 57) + "…" : text;
    });
    return NextResponse.json(thread);
  } catch (err) {
    return handleError(err);
  }
}
