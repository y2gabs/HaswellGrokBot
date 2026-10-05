import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * The signed-in user's connection to their subsite, kept in an encrypted,
 * httpOnly cookie (AES-256-GCM). The Application Password never reaches
 * browser JavaScript and the app needs no database.
 */
export type Session = {
  site: { id: number; name: string; url: string; restUrl: string };
  user: { id: number; username: string; displayName: string; email: string; role: string };
  appPassword: { password: string; uuid: string };
};

export const SESSION_COOKIE = "hb_session";
export const STATE_COOKIE = "hb_state";
/** Holds the site-choice ticket between the two in-app sign-in steps. */
export const TICKET_COOKIE = "hb_ticket";
const MAX_AGE = 60 * 60 * 24 * 30;

function key(): Buffer {
  return createHash("sha256").update(env.sessionSecret()).digest();
}

export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function unseal<T>(token: string | undefined): T | null {
  if (!token) return null;
  try {
    const [iv, tag, body] = token.split(".").map((p) => Buffer.from(p, "base64url"));
    if (!iv || !tag || !body) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const text = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return unseal<Session>(jar.get(SESSION_COOKIE)?.value);
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE,
};
