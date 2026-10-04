import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmMessage, LlmReply } from "@/lib/ai/deepseek";
import type { ChatMessage, Thread } from "@/lib/types";
import { fakeWp, session } from "./fake-wp";

const replies: LlmReply[] = [];
const seen: LlmMessage[][] = [];

vi.mock("@/lib/ai/deepseek", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/deepseek")>()),
  chat: vi.fn(async (messages: LlmMessage[]) => {
    seen.push(structuredClone(messages));
    const next = replies.shift();
    if (!next) throw new Error("No scripted reply");
    return next;
  }),
}));

const { runTurn, toLlm } = await import("@/lib/agent/loop");

describe("runTurn", () => {
  let fake: ReturnType<typeof fakeWp>;
  beforeEach(() => {
    fake = fakeWp();
    vi.stubGlobal("fetch", vi.fn(fake.handler));
    replies.length = 0;
    seen.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  function seed(messages: ChatMessage[]) {
    const thread: Thread = { id: 5, bot: "website-manager", title: "Website Manager", messages, pendingActions: [], state: {} };
    fake.threads.set(5, thread);
  }

  it("reads, proposes, and stops at the approval card without writing", async () => {
    seed([{ id: "u1", role: "user", content: "Change our long tagline to 'Fast, friendly plumbing'", createdAt: "" }]);
    replies.push(
      { content: "", finishReason: "tool_calls", toolCalls: [{ id: "c1", name: "get_website_settings", arguments: "{}" }] },
      {
        content: "Here's the change — tap Approve to apply it.",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "c2",
            name: "update_website_settings",
            arguments: JSON.stringify({ section: "profile", fields: { long_tagline: "Fast, friendly plumbing" } }),
          },
        ],
      },
    );

    await runTurn(session, 5);

    const thread = fake.threads.get(5)!;
    expect(replies).toHaveLength(0); // both scripted replies used, no third call
    expect(fake.writes).toHaveLength(0);
    expect(thread.pendingActions).toHaveLength(1);
    expect(thread.state.busy).toBe(false);
    const assistant = thread.messages.filter((m) => m.role === "assistant").at(-1)!;
    expect(assistant.cards).toEqual([{ type: "approval", actionId: thread.pendingActions[0].id }]);
    // The schema reached the system prompt.
    expect((seen[0][0] as { content: string }).content).toContain("long_tagline");
  });

  it("records an AI failure on the thread instead of throwing", async () => {
    seed([{ id: "u1", role: "user", content: "hi", createdAt: "" }]);
    await runTurn(session, 5);
    const thread = fake.threads.get(5)!;
    expect(thread.state.busy).toBe(false);
    expect(thread.state.error).toBeTruthy();
  });
});

describe("toLlm", () => {
  it("answers tool calls left hanging by an interrupted turn", () => {
    const out = toLlm([
      { id: "1", role: "user", content: "hi", createdAt: "" },
      { id: "2", role: "assistant", content: "", createdAt: "", toolCalls: [{ id: "t1", name: "x", arguments: "{}" }] },
      { id: "3", role: "event", content: "The user picked image option 1.", createdAt: "" },
    ]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "tool", "user"]);
    expect(out[3]).toMatchObject({ content: "[Event] The user picked image option 1." });
  });

  it("mentions attached photos by media id", () => {
    const out = toLlm([{ id: "1", role: "user", content: "Add Sam", createdAt: "", attachments: [{ id: 99, url: "https://a/b.jpg" }] }]);
    expect((out[0] as { content: string }).content).toContain("media id 99");
  });
});
