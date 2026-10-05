import { NextResponse } from "next/server";
import { badOrigin, handleError, jsonError } from "@/lib/api";
import { seal, SESSION_COOKIE, sessionCookieOptions, TICKET_COOKIE } from "@/lib/session";
import { wpLogin } from "@/lib/wp/auth";

/**
 * In-app sign-in: { username, password } → signed in, or a list of sites to
 * choose from (the ticket for that step waits in an encrypted cookie).
 */
export async function POST(request: Request) {
  if (badOrigin(request)) return jsonError(403, "Bad origin.");
  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = (body.username ?? "").trim().slice(0, 200);
  const password = (body.password ?? "").slice(0, 500);
  if (!username || !password) return jsonError(400, "Enter your username or email and your password.");

  // The visitor's address, as nginx forwards it, for the plugin's rate limit.
  const clientIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";

  try {
    const result = await wpLogin(username, password, clientIp);
    if ("needsSite" in result) {
      const res = NextResponse.json({ needsSite: true, sites: result.sites });
      res.cookies.set(TICKET_COOKIE, seal({ ticket: result.ticket, sites: result.sites }), {
        ...sessionCookieOptions,
        maxAge: 5 * 60,
      });
      return res;
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, seal(result.session), sessionCookieOptions);
    return res;
  } catch (err) {
    return handleError(err);
  }
}
