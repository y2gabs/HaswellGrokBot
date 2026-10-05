import { env } from "../env";
import type { Session } from "../session";

/**
 * In-app sign-in against the companion plugin's haswell-bots/v1/login routes
 * on the network's main site. Called from this app's server only, with the
 * client secret; the password is passed through once and never stored.
 */

export type SiteChoice = { id: number; name: string; url: string };

export type LoginResult = { session: Session } | { needsSite: true; ticket: string; sites: SiteChoice[] };

export class LoginError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post(path: string, body: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch(`${env.wpNetworkUrl()}/wp-json/haswell-bots/v1/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ...body, client_secret: env.clientSecret() }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new LoginError(502, "Couldn't reach your website. Please try again.");
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = typeof data.message === "string" ? data.message : "Sign-in failed. Please try again.";
    // A wrong client secret is a setup problem, not the user's.
    if (data.code === "haswell_bots_bad_client") {
      throw new LoginError(500, "Sign-in isn't set up correctly (the client secret doesn't match).");
    }
    throw new LoginError(res.status, message);
  }
  return data;
}

function toSession(data: Record<string, unknown>): Session {
  const { site, user, appPassword } = data as unknown as Session;
  if (!site?.restUrl || !user?.username || !appPassword?.password) {
    throw new LoginError(502, "Your website sent an unexpected reply. Please try again.");
  }
  return { site, user, appPassword };
}

export async function wpLogin(username: string, password: string, clientIp?: string): Promise<LoginResult> {
  const data = await post("login", { username, password, client_ip: clientIp });
  if (data.needsSite) {
    return { needsSite: true, ticket: String(data.ticket ?? ""), sites: (data.sites as SiteChoice[]) ?? [] };
  }
  return { session: toSession(data) };
}

export async function wpLoginSite(ticket: string, site: number): Promise<Session> {
  return toSession(await post("login/site", { ticket, site }));
}
