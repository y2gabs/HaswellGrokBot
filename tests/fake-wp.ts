/**
 * A tiny in-memory stand-in for a subsite running the companion plugin,
 * served through a stubbed global fetch. Records every write so tests can
 * assert that nothing reached the "site" before the user approved.
 */
import type { Session } from "@/lib/session";
import type { Thread } from "@/lib/types";

export const session: Session = {
  site: { id: 2, name: "Acme Plumbing", url: "https://acme.test", restUrl: "https://acme.test/wp-json/" },
  user: { id: 7, username: "editor", displayName: "Ed Itor", email: "ed@acme.test", role: "editor" },
  appPassword: { password: "abcd efgh", uuid: "uuid-1" },
};

export function fakeWp() {
  const writes: { method: string; path: string; body: unknown }[] = [];
  const threads = new Map<number, Thread>();
  const settings = {
    profile: {
      postId: 162,
      title: "Profile",
      fields: {
        company_name: { label: "Company Name", type: "text", writable: true, value: "Acme Plumbing" },
        long_tagline: { label: "Long Tagline", type: "textarea", writable: true, value: "Old tagline" },
      },
    },
    contact: null,
    media: null,
  };
  const team = [{ id: 31, title: "Jane Doe", status: "publish", link: "https://acme.test/team/jane", date: "2026-01-01T00:00:00", fields: { member_full_name: "Jane Doe", professional_title: "Plumber" } }];

  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  }

  const handler = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/wp-json\//, "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    let m: RegExpMatchArray | null;
    if (path === "haswell-bots/v1/website-settings" && method === "GET") return json(settings);
    if (path === "haswell-bots/v1/website-settings" && method === "POST") {
      const unknown = Object.keys(body.fields).find((k) => !(k in settings.profile.fields));
      if (unknown) return json({ code: "haswell_bots_unknown_field", message: `Unknown field "${unknown}".` }, 400);
      if (body.dryRun) return json({ dryRun: true, clean: body.fields });
      writes.push({ method, path, body });
      for (const [k, v] of Object.entries(body.fields)) {
        (settings.profile.fields as Record<string, { value: unknown }>)[k].value = v;
      }
      return json({ section: body.section, changed: Object.keys(body.fields) });
    }
    if (path === "haswell-bots/v1/schema") {
      return json({
        site: { name: "Acme Plumbing", url: "https://acme.test" },
        acfActive: true,
        types: {
          team: {
            singular: "Team member",
            plural: "Team members",
            titleField: "member_full_name",
            imageField: "member_photo",
            fields: [{ name: "member_full_name", label: "Full Name", type: "text", writable: true, required: true }],
          },
        },
        settings: { profile: { label: "Company Profile", fields: [{ name: "long_tagline", label: "Long Tagline", type: "textarea", writable: true }] } },
      });
    }
    if ((m = path.match(/^haswell-bots\/v1\/content\/team\/(\d+)$/))) {
      const item = team.find((t) => t.id === Number(m![1]));
      if (!item) return json({ message: "not found" }, 404);
      if (method === "GET") {
        return json({ ...item, fields: { member_full_name: { label: "Full Name", type: "text", value: item.fields.member_full_name } } });
      }
      if (method === "DELETE") {
        writes.push({ method, path, body });
        return json({ deleted: true, id: item.id, title: item.title });
      }
    }
    if ((m = path.match(/^haswell-bots\/v1\/threads\/(\d+)$/))) {
      const id = Number(m[1]);
      if (method === "GET") return json(structuredClone(threads.get(id)));
      const t = { ...threads.get(id)!, ...body };
      threads.set(id, structuredClone(t));
      return json(t);
    }
    return json({ message: `No fake for ${method} ${path}` }, 404);
  };

  return { handler, writes, threads, settings };
}
