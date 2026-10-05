import { randomUUID } from "node:crypto";
import type { LlmTool } from "../ai/deepseek";
import { write } from "../ai/deepseek";
import { generateCandidates, imagesConfigured, stash } from "../ai/images";
import { ANNOUNCEMENT_SYSTEM_PROMPT, SERVICE_SYSTEM_PROMPT, cleanHtml, wordCount } from "../ai/prompts";
import type { Schema, WpClient } from "../wp/client";
import { WpError } from "../wp/client";
import type { BotId, Card, Change, PendingAction, Thread } from "../types";

/**
 * The bots' tools.
 *
 * Three kinds:
 *  - read tools run straight away (settings, content lists, site context);
 *  - UI tools put a card in front of the user and end the turn (choices,
 *    image picker);
 *  - proposal tools NEVER write. They validate the change with the
 *    companion's dryRun, store the exact request as a PendingAction and show
 *    an approval card. Only the user's Approve executes it (see actions.ts),
 *    and it executes the stored request, not anything the model says later.
 */

export type ToolContext = {
  wp: WpClient;
  thread: Thread;
  siteKey: string;
  schema: () => Promise<Schema>;
  step: (label: string) => Promise<void>;
};

export type ToolOutcome = {
  result: unknown;
  summary: string;
  isError?: boolean;
  cards?: Card[];
  /** End the turn after this round: the user has to act on a card. */
  stop?: boolean;
};

type Args = Record<string, unknown>;

const CONTENT_TYPES = ["services", "team", "partners"] as const;
const SECTIONS = ["profile", "contact", "media"] as const;

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): LlmTool {
  return {
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
  };
}

const offerChoices = fn(
  "offer_choices",
  "Show the user tappable options (2-5). Ends your turn; the user's pick arrives as their next message.",
  {
    prompt: { type: "string", description: "Optional one-line lead-in shown above the options." },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short option text (what the user is choosing)." },
          description: { type: "string", description: "Optional one-sentence detail." },
        },
        required: ["title"],
      },
    },
  },
  ["options"],
);

const getSettings = fn(
  "get_website_settings",
  "Read the website settings: the Company Profile, Company Contact and Website Media sections, with each field's label, type, current value and whether it can be changed.",
  {},
);

const listContent = (types: readonly string[]) =>
  fn(
    "list_content",
    "List existing items of a content type with their ids and field values.",
    {
      type: { type: "string", enum: types },
      search: { type: "string", description: "Optional text to search titles/content for." },
    },
    ["type"],
  );

export function toolsFor(bot: BotId): LlmTool[] {
  if (bot === "marketing") {
    return [
      fn(
        "get_site_context",
        "Get what you need to suggest announcements: the company profile, the list of services, and recent announcement titles (to avoid repeats).",
        {},
      ),
      offerChoices,
      fn(
        "write_article",
        "Write (or rewrite) the announcement article. Shows the draft to the user in a card.",
        {
          subject: { type: "string", description: "The announcement's title/headline." },
          brief: {
            type: "string",
            description:
              "What the article should cover, including any real details from the site context or the user. Never invent facts.",
          },
          instructions: { type: "string", description: "For a rewrite: what to change about the previous draft." },
        },
        ["subject", "brief"],
      ),
      fn(
        "generate_featured_image",
        "Generate three candidate featured images for the article and let the user pick one. Ends your turn.",
        {
          description: {
            type: "string",
            description:
              "A vivid description of a photographic image for the article. No text, words, logos or signage in the image.",
          },
        },
        ["description"],
      ),
      fn(
        "publish_announcement",
        "Ask the user to approve publishing the current draft (title, article and picked image) to the Announcements section of the website. Shows an approval card and ends your turn; it is NOT published until the user approves.",
        {
          status: {
            type: "string",
            enum: ["publish", "draft"],
            description: "publish (default) or save as a draft.",
          },
        },
      ),
      listContent(["announcements"]),
    ];
  }

  return [
    getSettings,
    listContent(CONTENT_TYPES),
    fn(
      "get_content",
      "Get one item with full field details (labels, types, read-only flags).",
      { type: { type: "string", enum: CONTENT_TYPES }, id: { type: "number" } },
      ["type", "id"],
    ),
    fn(
      "update_website_settings",
      "Propose changing fields in one website settings section. Shows the user a before/after approval card and ends your turn; nothing changes until they approve.",
      {
        section: { type: "string", enum: SECTIONS },
        fields: { type: "object", description: "Field name → new value, using the exact field names from the settings." },
      },
      ["section", "fields"],
    ),
    fn(
      "create_content",
      "Propose adding a new service, team member or partner. Shows an approval card and ends your turn.",
      {
        type: { type: "string", enum: CONTENT_TYPES },
        fields: { type: "object", description: "Field name → value. Include every required field." },
      },
      ["type", "fields"],
    ),
    fn(
      "update_content",
      "Propose changing fields on an existing item. Shows a before/after approval card and ends your turn.",
      {
        type: { type: "string", enum: CONTENT_TYPES },
        id: { type: "number", description: "Item id from list_content." },
        fields: { type: "object", description: "Only the fields to change: field name → new value." },
      },
      ["type", "id", "fields"],
    ),
    fn(
      "delete_content",
      "Propose removing an item (it goes to the trash). Shows an approval card and ends your turn.",
      { type: { type: "string", enum: CONTENT_TYPES }, id: { type: "number" } },
      ["type", "id"],
    ),
    fn(
      "write_service_description",
      "Draft a one-paragraph service description (HTML) to use in a service's description field.",
      {
        service_name: { type: "string" },
        notes: { type: "string", description: "What the service is and anything the user said about it." },
      },
      ["service_name", "notes"],
    ),
    offerChoices,
  ];
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

export function parseArgs(raw: string): Args {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Args) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") {
    const v = value as { url?: string; id?: number };
    if (v.url || v.id) return v.url ? `Image #${v.id}` : `#${v.id}`;
    return JSON.stringify(value);
  }
  const text = String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 400 ? text.slice(0, 400) + "…" : text || "(empty)";
}

function trimFields(fields: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = typeof v === "string" && v.length > 600 ? v.slice(0, 600) + "…" : v;
  }
  return out;
}

function labelsFor(schema: Schema, type: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of schema.types[type]?.fields ?? []) out[f.name] = f.label;
  return out;
}

function pending(
  ctx: ToolContext,
  action: Omit<PendingAction, "id" | "status" | "createdAt">,
): ToolOutcome {
  const id = randomUUID();
  ctx.thread.pendingActions.push({ ...action, id, status: "pending", createdAt: new Date().toISOString() });
  return {
    result: {
      status: "awaiting_user_approval",
      actionId: id,
      note: "An approval card is now showing. The change has NOT been made. Wait for the user's decision.",
    },
    summary: `Asked to approve: ${action.title}`,
    cards: [{ type: "approval", actionId: id }],
    stop: true,
  };
}

function imageUrlFromAttachments(ctx: ToolContext, id: number) {
  for (const m of ctx.thread.messages) {
    for (const a of m.attachments ?? []) if (a.id === id) return a.url;
  }
  return undefined;
}

/* ── Executor ────────────────────────────────────────────────────────── */

export async function executeTool(name: string, args: Args, ctx: ToolContext): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "offer_choices":
        return offerChoicesTool(args);
      case "get_site_context":
        return await siteContext(ctx);
      case "get_website_settings":
        return await settingsTool(ctx);
      case "list_content":
        return await listTool(ctx, args);
      case "get_content":
        return await getTool(ctx, args);
      case "update_website_settings":
        return await proposeSettings(ctx, args);
      case "create_content":
        return await proposeCreate(ctx, args);
      case "update_content":
        return await proposeUpdate(ctx, args);
      case "delete_content":
        return await proposeDelete(ctx, args);
      case "write_service_description":
        return await serviceDescription(ctx, args);
      case "write_article":
        return await writeArticle(ctx, args);
      case "generate_featured_image":
        return await featuredImage(ctx, args);
      case "publish_announcement":
        return await proposePublish(ctx, args);
      default:
        return { result: { error: `Unknown tool ${name}` }, summary: `Unknown tool ${name}`, isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    if (err instanceof WpError && err.status === 401) throw err;
    return { result: { error: message }, summary: message, isError: true };
  }
}

function offerChoicesTool(args: Args): ToolOutcome {
  const options = (Array.isArray(args.options) ? args.options : [])
    .map((o) => {
      const opt = (o ?? {}) as Args;
      return { title: str(opt.title), description: str(opt.description) || undefined };
    })
    .filter((o) => o.title)
    .slice(0, 5);
  if (options.length < 2) {
    return { result: { error: "Give at least two options." }, summary: "Too few options", isError: true };
  }
  return {
    result: { shown: options.length, note: "Options shown. Wait for the user's choice." },
    summary: `Offered ${options.length} options`,
    cards: [{ type: "choices", prompt: str(args.prompt) || undefined, options }],
    stop: true,
  };
}

async function settingsTool(ctx: ToolContext): Promise<ToolOutcome> {
  await ctx.step("Reading your website settings…");
  const settings = await ctx.wp.settings();
  const out: Record<string, unknown> = {};
  for (const [section, data] of Object.entries(settings)) {
    if (!data) {
      out[section] = null;
      continue;
    }
    const fields: Record<string, unknown> = {};
    for (const [name, f] of Object.entries(data.fields)) {
      fields[name] = {
        label: f.label,
        type: f.type,
        value: typeof f.value === "string" && f.value.length > 600 ? f.value.slice(0, 600) + "…" : f.value,
        ...(f.writable ? {} : { readOnly: true }),
      };
    }
    out[section] = { title: data.title, fields };
  }
  return { result: out, summary: "Read website settings" };
}

async function listTool(ctx: ToolContext, args: Args): Promise<ToolOutcome> {
  const type = str(args.type);
  await ctx.step("Looking that up…");
  const items = await ctx.wp.listContent(type, { search: str(args.search) || undefined, limit: 50 });
  return {
    result: {
      items: items.map((i) => ({ id: i.id, title: i.title, status: i.status, date: i.date, fields: trimFields(i.fields) })),
    },
    summary: `Listed ${items.length} ${type}`,
  };
}

async function getTool(ctx: ToolContext, args: Args): Promise<ToolOutcome> {
  const item = await ctx.wp.getContent(str(args.type), Number(args.id));
  return { result: item, summary: `Read ${str(args.type)} #${item.id}` };
}

async function siteContext(ctx: ToolContext): Promise<ToolOutcome> {
  await ctx.step("Getting to know your business…");
  const [settings, services, announcements] = await Promise.all([
    ctx.wp.settings().catch(() => ({}) as Awaited<ReturnType<WpClient["settings"]>>),
    ctx.wp.listContent("services", { limit: 30 }).catch(() => []),
    ctx.wp.listContent("announcements", { limit: 10 }).catch(() => []),
  ]);
  const profile: Record<string, unknown> = {};
  for (const section of ["profile", "contact"] as const) {
    for (const [name, f] of Object.entries(settings[section]?.fields ?? {})) {
      if (typeof f.value === "string" && f.value) profile[f.label || name] = display(f.value);
    }
  }
  return {
    result: {
      siteName: ctx.wp.siteName,
      today: new Date().toISOString().slice(0, 10),
      profile,
      services: services.map((s) => ({
        name: s.title,
        description: display(s.fields.service_description ?? "").slice(0, 200),
      })),
      recentAnnouncements: announcements.map((a) => ({ title: a.title, date: a.date.slice(0, 10) })),
    },
    summary: "Read company profile, services and recent announcements",
  };
}

async function proposeSettings(ctx: ToolContext, args: Args): Promise<ToolOutcome> {
  const section = str(args.section);
  const fields = (args.fields ?? {}) as Record<string, unknown>;
  const check = await ctx.wp.request<{ clean: Record<string, unknown> }>("POST", "haswell-bots/v1/website-settings", {
    body: { section, fields, dryRun: true },
  });
  const current = (await ctx.wp.settings())[section];
  const changes: Change[] = Object.entries(check.clean).map(([name, after]) => {
    const f = current?.fields[name];
    const imageUrl = f?.type === "image" && typeof after === "number" ? imageUrlFromAttachments(ctx, after) : undefined;
    return {
      field: name,
      label: f?.label ?? name,
      before: display(f?.value),
      after: imageUrl ? `Image #${after}` : display(after),
    };
  });
  const sectionLabel = { profile: "Company Profile", contact: "Company Contact", media: "Website Media" }[section] ?? section;
  return pending(ctx, {
    kind: "update_settings",
    title: `Update ${sectionLabel}`,
    summary: `Change ${changes.map((c) => c.label).join(", ")} in ${sectionLabel}`,
    changes,
    request: { method: "POST", path: "haswell-bots/v1/website-settings", body: { section, fields: check.clean } },
  });
}

async function proposeCreate(ctx: ToolContext, args: Args): Promise<ToolOutcome> {
  const type = str(args.type);
  const fields = (args.fields ?? {}) as Record<string, unknown>;
  const check = await ctx.wp.request<{ clean: Record<string, unknown> }>("POST", `haswell-bots/v1/content/${type}`, {
    body: { fields, dryRun: true },
  });
  const schema = await ctx.schema();
  const def = schema.types[type];
  const labels = labelsFor(schema, type);
  const name = display(check.clean[def?.titleField ?? ""] ?? "");
  const imageId = def?.imageField ? Number(check.clean[def.imageField]) : 0;
  return pending(ctx, {
    kind: "create_content",
    title: `Add ${(def?.singular ?? type).toLowerCase()}: ${name}`,
    summary: `Add ${(def?.singular ?? type).toLowerCase()} “${name}”`,
    changes: Object.entries(check.clean).map(([field, after]) => ({
      field,
      label: labels[field] ?? field,
      after: display(after),
    })),
    image: imageId ? imageUrlFromAttachments(ctx, imageId) : undefined,
    request: { method: "POST", path: `haswell-bots/v1/content/${type}`, body: { fields: check.clean } },
  });
}

async function proposeUpdate(ctx: ToolContext, args: Args): Promise<ToolOutcome> {
  const type = str(args.type);
  const id = Number(args.id);
  const fields = (args.fields ?? {}) as Record<string, unknown>;
  const check = await ctx.wp.request<{ clean: Record<string, unknown> }>("POST", `haswell-bots/v1/content/${type}/${id}`, {
    body: { fields, dryRun: true },
  });
  const item = await ctx.wp.getContent(type, id);
  const schema = await ctx.schema();
  const def = schema.types[type];
  const details = item.fields as Record<string, { label?: string; value?: unknown }>;
  const imageId = def?.imageField && def.imageField in check.clean ? Number(check.clean[def.imageField]) : 0;
  return pending(ctx, {
    kind: "update_content",
    title: `Update ${(def?.singular ?? type).toLowerCase()}: ${item.title}`,
    summary: `Change ${Object.keys(check.clean)
      .map((f) => details[f]?.label ?? f)
      .join(", ")} on “${item.title}”`,
    changes: Object.entries(check.clean).map(([field, after]) => ({
      field,
      label: details[field]?.label ?? field,
      before: display(details[field]?.value),
      after: display(after),
    })),
    image: imageId ? imageUrlFromAttachments(ctx, imageId) : undefined,
    request: { method: "POST", path: `haswell-bots/v1/content/${type}/${id}`, body: { fields: check.clean } },
  });
}

async function proposeDelete(ctx: ToolContext, args: Args): Promise<ToolOutcome> {
  const type = str(args.type);
  const id = Number(args.id);
  const item = await ctx.wp.getContent(type, id);
  const schema = await ctx.schema();
  const singular = (schema.types[type]?.singular ?? type).toLowerCase();
  return pending(ctx, {
    kind: "delete_content",
    title: `Remove ${singular}: ${item.title}`,
    summary: `Remove ${singular} “${item.title}” from the website`,
    changes: [{ field: "title", label: "Removing", after: item.title }],
    request: { method: "DELETE", path: `haswell-bots/v1/content/${type}/${id}` },
  });
}

async function serviceDescription(ctx: ToolContext, args: Args): Promise<ToolOutcome> {
  await ctx.step("Writing a description…");
  const html = cleanHtml(
    await write(SERVICE_SYSTEM_PROMPT, `Service: ${str(args.service_name)}\n${str(args.notes)}`, {
      maxTokens: 400,
      temperature: 1.0,
    }),
  );
  return { result: { html }, summary: `Drafted a description for ${str(args.service_name)}` };
}

async function writeArticle(ctx: ToolContext, args: Args): Promise<ToolOutcome> {
  const subject = str(args.subject);
  if (!subject) return { result: { error: "subject is required" }, summary: "No subject", isError: true };
  const draft = ctx.thread.state.draft ?? {};
  await ctx.step(draft.html ? "Rewriting the article…" : "Writing the article…");

  let prompt = `Business: ${ctx.wp.siteName}\nHeadline: ${subject}\n\nWhat the article should cover:\n${str(args.brief)}`;
  const instructions = str(args.instructions);
  if (instructions && draft.html) {
    prompt += `\n\nRewrite this previous draft. Changes requested: ${instructions}\n\nPrevious draft:\n${draft.html}`;
  }
  const html = cleanHtml(await write(ANNOUNCEMENT_SYSTEM_PROMPT, prompt, { maxTokens: 2000, temperature: 1.3 }));

  ctx.thread.state.draft = { ...draft, subject, html };
  if (ctx.thread.title === "New conversation" || ctx.thread.title === "Marketing") ctx.thread.title = subject;

  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return {
    result: { subject, words: wordCount(html), opening: text.slice(0, 300) },
    summary: `Wrote “${subject}” (${wordCount(html)} words)`,
    cards: [{ type: "article", title: subject, html }],
  };
}

async function featuredImage(ctx: ToolContext, args: Args): Promise<ToolOutcome> {
  if (!imagesConfigured()) {
    return {
      result: { error: "Image generation isn't set up. Offer to publish without an image." },
      summary: "Image generation isn't set up",
      isError: true,
    };
  }
  const description = str(args.description);
  await ctx.step("Creating featured images…");
  const prompt = `${description}. Photographic, natural light, high quality, landscape orientation. No text, words, letters, logos or signage.`;
  const images = await generateCandidates(prompt, 3);
  const token = await stash(ctx.siteKey, images);
  return {
    result: { candidates: images.length, note: "The user is choosing an image. Wait for their pick." },
    summary: `Generated ${images.length} image options`,
    cards: [{ type: "images", token, count: images.length, prompt: description }],
    stop: true,
  };
}

async function proposePublish(ctx: ToolContext, args: Args): Promise<ToolOutcome> {
  const draft = ctx.thread.state.draft ?? {};
  if (!draft.subject || !draft.html) {
    return { result: { error: "Write the article first (write_article)." }, summary: "No draft yet", isError: true };
  }
  const status = str(args.status) === "draft" ? "draft" : "publish";
  const fields: Record<string, unknown> = {
    announcement_subject: draft.subject,
    announcement_body: draft.html,
  };
  if (draft.imageId) fields.announcement_featured_image = draft.imageId;

  const check = await ctx.wp.request<{ clean: Record<string, unknown> }>("POST", "haswell-bots/v1/content/announcements", {
    body: { fields, dryRun: true },
  });

  const text = draft.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return pending(ctx, {
    kind: "publish_announcement",
    title: status === "draft" ? "Save announcement as a draft" : "Post announcement to your website",
    summary: `${status === "draft" ? "Save" : "Publish"} “${draft.subject}” in Announcements`,
    changes: [
      { field: "announcement_subject", label: "Title", after: draft.subject },
      {
        field: "announcement_body",
        label: "Article",
        after: `${text.length > 220 ? text.slice(0, 220) + "…" : text} (${wordCount(draft.html)} words)`,
      },
      ...(draft.imageId ? [{ field: "announcement_featured_image", label: "Featured image", after: "Picked image" }] : []),
    ],
    image: draft.imageUrl,
    request: {
      method: "POST",
      path: "haswell-bots/v1/content/announcements",
      body: { fields: check.clean, status },
    },
  });
}
