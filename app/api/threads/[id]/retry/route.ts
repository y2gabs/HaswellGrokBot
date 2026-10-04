import { NextResponse } from "next/server";
import { authed, handleError, threadId } from "@/lib/api";
import { withTurn } from "@/lib/agent/kickoff";

/** Run the bot again after a turn failed (e.g. the AI service was down). */
export async function POST(request: Request, ctx: RouteContext<"/api/threads/[id]/retry">) {
  const auth = await authed(request);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await withTurn(auth.session, auth.wp, threadId((await ctx.params).id), () => undefined));
  } catch (err) {
    return handleError(err);
  }
}
