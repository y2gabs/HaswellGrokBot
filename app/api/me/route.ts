import { NextResponse } from "next/server";
import { authed } from "@/lib/api";

export async function GET(request: Request) {
  const auth = await authed(request);
  if (auth.error) return auth.error;
  const { site, user } = auth.session;
  return NextResponse.json({ site: { name: site.name, url: site.url }, user: { displayName: user.displayName, role: user.role } });
}
