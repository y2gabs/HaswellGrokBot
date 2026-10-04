import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { STATE_COOKIE } from "@/lib/session";

/** Send the user to their network's "Connect your website" page. */
export async function GET() {
  const state = randomBytes(24).toString("base64url");
  const target = new URL(env.wpNetworkUrl() + "/");
  target.searchParams.set("haswell_bots_connect", "1");
  target.searchParams.set("state", state);

  const res = NextResponse.redirect(target);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  });
  return res;
}
