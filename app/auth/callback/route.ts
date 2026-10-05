import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { seal, SESSION_COOKIE, sessionCookieOptions, STATE_COOKIE, type Session } from "@/lib/session";

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Back from WordPress with a single-use code: swap it (server to server, with
 * the client secret) for the site and the user's Application Password.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const expected = request.cookies.get(STATE_COOKIE)?.value ?? "";
  const fail = (reason: string) => {
    const res = NextResponse.redirect(new URL(`/?error=${encodeURIComponent(reason)}`, env.appUrl()));
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  if (!code || !state || !expected || !same(state, expected)) {
    return fail("That sign-in link didn't match. Please try again.");
  }

  let data: Session & { code?: string; message?: string };
  try {
    const res = await fetch(`${env.wpNetworkUrl()}/wp-json/haswell-bots/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, client_secret: env.clientSecret() }),
      cache: "no-store",
    });
    data = await res.json();
    if (!res.ok) return fail(data.message || "Sign-in failed. Please try again.");
  } catch {
    return fail("Couldn't reach your website. Please try again.");
  }

  const session: Session = { site: data.site, user: data.user, appPassword: data.appPassword };
  const res = NextResponse.redirect(new URL("/home", env.appUrl()));
  res.cookies.set(SESSION_COOKIE, seal(session), sessionCookieOptions);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
