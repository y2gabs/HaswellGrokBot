import { NextResponse } from "next/server";
import { authed, handleError, threadId } from "@/lib/api";
import { pickImage } from "@/lib/agent/actions";
import { withTurn } from "@/lib/agent/kickoff";

/** Pick one of the generated featured images: { token, index }. */
export async function POST(request: Request, ctx: RouteContext<"/api/threads/[id]/images">) {
  const auth = await authed(request);
  if (auth.error) return auth.error;
  const { token, index } = (await request.json().catch(() => ({}))) as { token?: string; index?: number };
  try {
    const thread = await withTurn(auth.session, auth.wp, threadId((await ctx.params).id), (t) =>
      pickImage(auth.session, auth.wp, t, String(token ?? ""), Number(index)),
    );
    return NextResponse.json(thread);
  } catch (err) {
    return handleError(err);
  }
}
