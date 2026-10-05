/** Shared shapes, used by the server and the UI. */

export type BotId = "marketing" | "website-manager";

export type Card =
  | { type: "choices"; prompt?: string; options: { title: string; description?: string }[] }
  | { type: "images"; token: string; count: number; prompt: string; picked?: number; savedId?: number }
  | { type: "article"; title: string; html: string }
  | { type: "approval"; actionId: string };

export type ToolCall = { id: string; name: string; arguments: string };

export type ChatMessage = {
  id: string;
  /**
   * user/assistant/tool map straight onto the model's roles. "event" is
   * something the user did through a card (approved, picked an image); it is
   * sent to the model as a bracketed user message and shown as a small note.
   */
  role: "user" | "assistant" | "tool" | "event";
  content: string;
  createdAt: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  cards?: Card[];
  attachments?: { id: number; url: string }[];
  /** Tool messages: short human summary for the activity log. */
  summary?: string;
  isError?: boolean;
  /** Events: what the user sees, when the bot's wording is too technical. */
  display?: string;
  /** Not shown in the conversation (e.g. the opening nudge). */
  hidden?: boolean;
};

export type Change = { field: string; label: string; before?: string; after: string };

export type PendingAction = {
  id: string;
  kind: "update_settings" | "create_content" | "update_content" | "delete_content" | "publish_announcement";
  title: string;
  summary: string;
  changes: Change[];
  image?: string;
  request: { method: "POST" | "DELETE"; path: string; body?: Record<string, unknown> };
  status: "pending" | "running" | "done" | "declined" | "failed";
  result?: unknown;
  error?: string;
  link?: string;
  createdAt: string;
};

export type ThreadState = {
  busy?: boolean;
  step?: string;
  error?: string;
  startedAt?: string;
  draft?: { subject?: string; html?: string; imageId?: number; imageUrl?: string };
};

export type Thread = {
  id: number;
  bot: BotId;
  title: string;
  messages: ChatMessage[];
  pendingActions: PendingAction[];
  state: ThreadState;
  createdAt?: string;
  updatedAt?: string;
};

export type ThreadSummary = {
  id: number;
  bot: BotId;
  title: string;
  snippet: string;
  hasPending: boolean;
  updatedAt: string;
};
