import { readCandidate } from "../ai/images";
import type { Session } from "../session";
import type { Card, Thread } from "../types";
import { WpClient, WpError } from "../wp/client";
import { newMessage, siteKey } from "./loop";

/**
 * What the user does through cards. Each records an "event" message for the
 * bot to react to on its next turn.
 */

export class ActionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Approve or decline a pending change. Approving runs the exact request that
 * was stored when the card was shown — the model has no say at this point.
 */
export async function decide(wp: WpClient, thread: Thread, actionId: string, approve: boolean) {
  const action = thread.pendingActions.find((a) => a.id === actionId);
  if (!action) throw new ActionError(404, "That request was not found.");
  if (action.status !== "pending") throw new ActionError(409, "That request has already been handled.");

  if (!approve) {
    action.status = "declined";
    thread.messages.push(
      newMessage({
        role: "event",
        content: `The user declined: ${action.summary}. Nothing was changed.`,
        display: "You declined — nothing was changed.",
      }),
    );
    return;
  }

  try {
    const result = await wp.request<Record<string, unknown>>(action.request.method, action.request.path, {
      body: action.request.body,
    });
    action.status = "done";
    action.result = { id: result?.id, title: result?.title, link: result?.link, status: result?.status };
    action.link = typeof result?.link === "string" ? result.link : undefined;
    if (action.kind === "publish_announcement") {
      thread.state.draft = undefined;
    }
    const detail = [
      result?.id ? `id ${result.id}` : "",
      action.link ? `link ${action.link}` : "",
      result?.status === "draft" ? "saved as a draft" : "",
    ]
      .filter(Boolean)
      .join(", ");
    thread.messages.push(
      newMessage({
        role: "event",
        content: `The user approved: ${action.summary}. It was applied to the website successfully${detail ? ` (${detail})` : ""}.`,
        display: `You approved: ${action.summary}.`,
      }),
    );
  } catch (err) {
    if (err instanceof WpError && err.status === 401) throw err;
    action.status = "failed";
    action.error = err instanceof Error ? err.message : "The website returned an error.";
    thread.messages.push(
      newMessage({
        role: "event",
        content: `The user approved: ${action.summary}, but the website returned an error: ${action.error}. Nothing was changed.`,
        display: `That didn't work: ${action.error}`,
      }),
    );
  }
}

function slug(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "featured-image"
  );
}

/** Save the picked candidate to the media library and tell the bot. */
export async function pickImage(session: Session, wp: WpClient, thread: Thread, token: string, index: number) {
  let card: Extract<Card, { type: "images" }> | undefined;
  for (const m of thread.messages) {
    for (const c of m.cards ?? []) if (c.type === "images" && c.token === token) card = c;
  }
  if (!card) throw new ActionError(404, "Those images were not found.");
  if (card.picked !== undefined) throw new ActionError(409, "An image was already picked from this set.");
  if (!Number.isInteger(index) || index < 0 || index >= card.count) throw new ActionError(400, "Pick one of the images.");

  const image = await readCandidate(siteKey(session), token, index);
  const subject = thread.state.draft?.subject ?? card.prompt;
  const media = await wp.uploadMedia(image.data, image.mime, `${slug(subject)}.${image.filename.split(".").pop()}`, subject);

  card.picked = index;
  card.savedId = media.id;
  thread.state.draft = { ...(thread.state.draft ?? {}), imageId: media.id, imageUrl: media.url };
  thread.messages.push(
    newMessage({
      role: "event",
      content: `The user picked image option ${index + 1}. It's saved to the media library as media id ${media.id}.`,
      display: `You picked image ${index + 1}.`,
    }),
  );
}
