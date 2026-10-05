import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { badOrigin, handleError, jsonError } from "@/lib/api";
import { seal, SESSION_COOKIE, sessionCookieOptions, TICKET_COOKIE, unseal } from "@/lib/session";
import { wpLoginSite, type SiteChoice } from "@/lib/wp/auth";

/** Second sign-in step for users who edit several sites: { site }. */
export async function POST(request: Request) {
  if (badOrigin(request)) return jsonError(403, "Bad origin.");
  const { site } = (await request.json().catch(() => ({}))) as { site?: number };
  const jar = await cookies();
  const pending = unseal<{ ticket: string; sites: SiteChoice[] }>(jar.get(TICKET_COOKIE)?.value);
  if (!pending) return jsonError(400, "That took too long. Please sign in again.");
  if (!pending.sites.some((s) => s.id === Number(site))) return jsonError(400, "Choose one of your websites.");

  try {
    const session = await wpLoginSite(pending.ticket, Number(site));
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, seal(session), sessionCookieOptions);
    res.cookies.delete(TICKET_COOKIE);
    return res;
  } catch (err) {
    const res = handleError(err);
    // The ticket is single-use on the WordPress side either way.
    res.cookies.delete(TICKET_COOKIE);
    return res;
  }
}
