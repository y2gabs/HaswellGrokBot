import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decide } from "@/lib/agent/actions";
import { executeTool } from "@/lib/agent/tools";
import type { Thread } from "@/lib/types";
import { WpClient } from "@/lib/wp/client";
import { fakeWp, session } from "./fake-wp";

function blankThread(): Thread {
  return { id: 1, bot: "website-manager", title: "Website Manager", messages: [], pendingActions: [], state: {} };
}

describe("approval gate", () => {
  let fake: ReturnType<typeof fakeWp>;
  beforeEach(() => {
    fake = fakeWp();
    vi.stubGlobal("fetch", vi.fn(fake.handler));
  });
  afterEach(() => vi.unstubAllGlobals());

  function ctx(thread: Thread) {
    const wp = new WpClient(session);
    return { wp, thread, siteKey: "k", schema: () => wp.schema(), step: async () => undefined };
  }

  it("a proposal validates and queues the change but writes nothing", async () => {
    const thread = blankThread();
    const out = await executeTool("update_website_settings", { section: "profile", fields: { long_tagline: "New tagline" } }, ctx(thread));

    expect(out.isError).toBeFalsy();
    expect(out.stop).toBe(true);
    expect(out.cards?.[0]).toMatchObject({ type: "approval" });
    expect(fake.writes).toHaveLength(0);
    expect(fake.settings.profile.fields.long_tagline.value).toBe("Old tagline");

    const action = thread.pendingActions[0];
    expect(action.status).toBe("pending");
    expect(action.changes).toEqual([{ field: "long_tagline", label: "Long Tagline", before: "Old tagline", after: "New tagline" }]);
  });

  it("an unknown field is reported back to the bot, and nothing is queued", async () => {
    const thread = blankThread();
    const out = await executeTool("update_website_settings", { section: "profile", fields: { tagline_long: "x" } }, ctx(thread));
    expect(out.isError).toBe(true);
    expect(out.summary).toContain("Unknown field");
    expect(thread.pendingActions).toHaveLength(0);
  });

  it("approving runs exactly the stored request, once", async () => {
    const thread = blankThread();
    const c = ctx(thread);
    await executeTool("update_website_settings", { section: "profile", fields: { long_tagline: "New tagline" } }, c);
    const action = thread.pendingActions[0];

    await decide(c.wp, thread, action.id, true);
    expect(fake.writes).toEqual([
      { method: "POST", path: "haswell-bots/v1/website-settings", body: { section: "profile", fields: { long_tagline: "New tagline" } } },
    ]);
    expect(action.status).toBe("done");
    expect(thread.messages.at(-1)).toMatchObject({ role: "event" });
    expect(thread.messages.at(-1)?.content).toContain("approved");

    await expect(decide(c.wp, thread, action.id, true)).rejects.toMatchObject({ status: 409 });
    expect(fake.writes).toHaveLength(1);
  });

  it("declining changes nothing", async () => {
    const thread = blankThread();
    const c = ctx(thread);
    await executeTool("delete_content", { type: "team", id: 31 }, c);
    const action = thread.pendingActions[0];
    expect(action.title).toContain("Jane Doe");

    await decide(c.wp, thread, action.id, false);
    expect(action.status).toBe("declined");
    expect(fake.writes).toHaveLength(0);
    expect(thread.messages.at(-1)?.content).toContain("declined");
  });
});
