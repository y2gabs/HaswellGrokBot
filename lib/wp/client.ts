import type { Session } from "../session";
import type { Thread, ThreadSummary } from "../types";

export class WpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "",
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | undefined>;

/**
 * REST client for the user's subsite, authenticated with their Application
 * Password. Everything runs as that user, so WordPress's own permission
 * checks apply to every call.
 */
export class WpClient {
  constructor(private session: Session) {}

  get siteName() {
    return this.session.site.name;
  }

  private url(path: string, query?: Query) {
    const base = this.session.site.restUrl.replace(/\/+$/, "");
    const url = new URL(`${base}/${path.replace(/^\/+/, "")}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    return url;
  }

  private auth() {
    const { username } = this.session.user;
    const { password } = this.session.appPassword;
    return "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
  }

  async request<T>(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown; raw?: { data: Buffer; type: string; filename: string } } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Authorization: this.auth(), Accept: "application/json" };
    let body: BodyInit | undefined;
    if (opts.raw) {
      headers["Content-Type"] = opts.raw.type;
      headers["Content-Disposition"] = `attachment; filename="${opts.raw.filename.replace(/["\\\r\n]/g, "")}"`;
      body = new Uint8Array(opts.raw.data);
    } else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    let res: Response;
    try {
      res = await fetch(this.url(path, opts.query), { method, headers, body, cache: "no-store" });
    } catch {
      throw new WpError(502, `Couldn't reach ${this.session.site.name}.`);
    }

    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const err = (data ?? {}) as { message?: string; code?: string };
      if (res.status === 401) {
        throw new WpError(401, "Your sign-in has expired. Please sign in again.", "unauthorized");
      }
      throw new WpError(res.status, err.message || `The site returned ${res.status}.`, err.code);
    }
    return data as T;
  }

  /* Threads */
  listThreads() {
    return this.request<ThreadSummary[]>("GET", "haswell-bots/v1/threads");
  }
  createThread(bot: string, title?: string) {
    return this.request<Thread>("POST", "haswell-bots/v1/threads", { body: { bot, title } });
  }
  getThread(id: number) {
    return this.request<Thread>("GET", `haswell-bots/v1/threads/${id}`);
  }
  saveThread(thread: Thread) {
    return this.request<Thread>("POST", `haswell-bots/v1/threads/${thread.id}`, {
      body: {
        title: thread.title,
        messages: thread.messages,
        pendingActions: thread.pendingActions,
        state: thread.state,
      },
    });
  }
  deleteThread(id: number) {
    return this.request("DELETE", `haswell-bots/v1/threads/${id}`);
  }

  /* Site data */
  schema() {
    return this.request<Schema>("GET", "haswell-bots/v1/schema");
  }
  settings() {
    return this.request<Record<string, SettingsSection | null>>("GET", "haswell-bots/v1/website-settings");
  }
  listContent(type: string, query: Query = {}) {
    return this.request<ContentItem[]>("GET", `haswell-bots/v1/content/${type}`, { query });
  }
  getContent(type: string, id: number) {
    return this.request<ContentItem>("GET", `haswell-bots/v1/content/${type}/${id}`);
  }

  async uploadMedia(data: Buffer, type: string, filename: string, alt = "") {
    const media = await this.request<{ id: number; source_url: string }>("POST", "wp/v2/media", {
      raw: { data, type, filename },
    });
    if (alt) {
      await this.request("POST", `wp/v2/media/${media.id}`, { body: { alt_text: alt } }).catch(() => undefined);
    }
    return { id: media.id, url: media.source_url };
  }

  revokeAppPassword() {
    return this.request("DELETE", `wp/v2/users/me/application-passwords/${this.session.appPassword.uuid}`);
  }
}

export type FieldDef = {
  name: string;
  label: string;
  type: string;
  writable: boolean;
  required?: boolean;
  help?: string;
  choices?: string[];
};

export type Schema = {
  site: { name: string; url: string };
  acfActive: boolean;
  types: Record<
    string,
    { singular: string; plural: string; titleField: string; imageField: string | null; fields: FieldDef[] }
  >;
  settings: Record<string, { label: string; fields: FieldDef[] }>;
};

export type FieldSnapshot = Omit<FieldDef, "name"> & { value: unknown };

export type SettingsSection = { postId: number; title: string; fields: Record<string, FieldSnapshot> };

export type ContentItem = {
  id: number;
  title: string;
  status: string;
  link: string;
  date: string;
  fields: Record<string, unknown>;
};
