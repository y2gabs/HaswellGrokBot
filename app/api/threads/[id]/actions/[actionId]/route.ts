import { NextResponse } from "next/server";
import { authed, handleError, threadId } from "@/lib/api";
import { decide } from "@/lib/agent/actions";
import { withTurn } from "@/lib/agent/kickoff";

/** Approve or decline a pending change: { approve: boolean }. */
export async function POST(request: Request, ctx: RouteContext<"/api/threads/[id]/actions/[actionId]">) {
  const auth = await authed(request);
  if (auth.error) return auth.error;
  const { approve } = (await request.json().catch(() => ({}))) as { approve?: boolean };
  const params = await ctx.params;
  try {
    const thread = await withTurn(auth.session, auth.wp, threadId(params.id), (t) =>
      decide(auth.wp, t, params.actionId, approve === true),
    );
    return NextResponse.json(thread);
  } catch (err) {
    return handleError(err);
  }
}
