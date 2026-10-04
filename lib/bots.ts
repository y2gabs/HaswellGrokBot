import type { BotId } from "./types";

/**
 * Bot catalogue: everything the UI needs to show a bot. Safe to import from
 * client components (no secrets, no server code).
 */
export type BotMeta = {
  id: BotId;
  name: string;
  tagline: string;
  description: string;
  /** Blob mascot colors: body and its highlight. */
  color: string;
  accent: string;
  /** Static greeting for bots that don't open with a model call. */
  greeting?: string;
  starters: string[];
};

export const BOTS: BotMeta[] = [
  {
    id: "marketing",
    name: "Marketing",
    tagline: "Writes and publishes your announcements",
    description:
      "Suggests three ideas, writes the article you pick, makes a featured image, and posts it once you approve.",
    color: "#a78bfa",
    accent: "#ddd6fe",
    starters: ["Suggest three announcement ideas", "Write about a new service we offer", "Announce our holiday hours"],
  },
  {
    id: "website-manager",
    name: "Website Manager",
    tagline: "Updates your website for you",
    description:
      "Changes your website settings, services, team members and partners — just tell it what you need.",
    color: "#38bdf8",
    accent: "#bae6fd",
    greeting:
      "Hi! I can update your website settings — company name, taglines, contact details — and add, change or remove services, team members and partners. What would you like to change?",
    starters: [
      "Change our long tagline",
      "Add a new team member",
      "Update our phone number",
      "Add a service",
      "Remove a partner",
    ],
  },
];

export function botMeta(id: string): BotMeta | undefined {
  return BOTS.find((b) => b.id === id);
}
