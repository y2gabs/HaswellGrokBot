import { NextResponse } from "next/server";
import { authed, handleError, threadId } from "@/lib/api";
import { isBusy } from "@/lib/agent/loop";

export async function GET(request: Request, ctx: RouteContext<"/api/threads/[id]">) {
  const auth = await authed(request);
  if (auth.error) return auth.error;
  try {
    const thread = await auth.wp.getThread(threadId((await ctx.params).id));
    // A turn that died with the server shouldn't spin forever.
    if (thread.state.busy && !isBusy(thread)) thread.state = { ...thread.state, busy: false, step: undefined };
    return NextResponse.json(thread);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/threads/[id]">) {
  const auth = await authed(request);
  if (auth.error) return auth.error;
  try {
    await auth.wp.deleteThread(threadId((await ctx.params).id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
