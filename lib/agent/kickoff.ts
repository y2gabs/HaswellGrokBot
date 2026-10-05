import { after } from "next/server";
import type { Session } from "../session";
import type { Thread } from "../types";
import type { WpClient } from "../wp/client";
import { ActionError } from "./actions";
import { isBusy, runTurn } from "./loop";

/**
 * Load a thread, apply what the user did, save it as busy and run the bot's
 * next turn after the response is sent. The client polls the thread until
 * it is no longer busy.
 */
export async function withTurn(
  session: Session,
  wp: WpClient,
  id: number,
  mutate: (thread: Thread) => Promise<void> | void,
) {
  const thread = await wp.getThread(id);
  if (isBusy(thread)) throw new ActionError(409, "The bot is still working on your last request.");
  await mutate(thread);
  thread.state = { ...thread.state, busy: true, error: undefined, step: "Thinking…", startedAt: new Date().toISOString() };
  const saved = await wp.saveThread(thread);
  after(() => runTurn(session, id));
  return saved;
}
