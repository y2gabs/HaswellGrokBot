import { NextResponse } from "next/server";
import { authed } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/session";

/** Sign out and revoke the Application Password this app was given. */
export async function POST(request: Request) {
  const auth = await authed(request);
  if (!auth.error) await auth.wp.revokeAppPassword().catch(() => undefined);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
