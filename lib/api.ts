import { NextResponse } from "next/server";
import { env } from "./env";
import { getSession, SESSION_COOKIE, type Session } from "./session";
import { ActionError } from "./agent/actions";
import { AiError } from "./ai/deepseek";
import { LoginError } from "./wp/auth";
import { WpClient, WpError } from "./wp/client";

export function jsonError(status: number, message: string) {
  const res = NextResponse.json({ error: message }, { status });
  if (status === 401) res.cookies.delete(SESSION_COOKIE);
  return res;
}

/** Map anything thrown in a handler to a JSON error response. */
export function handleError(err: unknown) {
  if (err instanceof WpError || err instanceof ActionError || err instanceof AiError || err instanceof LoginError) {
    return jsonError(err.status, err.message);
  }
  console.error(err);
  return jsonError(500, "Something went wrong. Please try again.");
}

/** State-changing requests must come from this app's own origin. */
export function badOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin) && new URL(origin!).host !== new URL(env.appUrl()).host;
}

/**
 * The signed-in user's session and REST client, or an error response.
 * State-changing requests must come from this app's own origin.
 */
export async function authed(
  request: Request,
): Promise<{ session: Session; wp: WpClient; error?: never } | { error: Response }> {
  if (request.method !== "GET" && badOrigin(request)) {
    return { error: jsonError(403, "Bad origin.") };
  }
  const session = await getSession();
  if (!session) return { error: jsonError(401, "Please sign in.") };
  return { session, wp: new WpClient(session) };
}

export function threadId(raw: string) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ActionError(404, "Conversation not found.");
  return id;
}
