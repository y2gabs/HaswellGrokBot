/**
 * Writing briefs, ported from the Haswell Admin App plugin
 * (includes/ai/class-ai-clients.php) so articles from the bot read the same
 * as ones written with "Generate with AI" in the dashboard.
 */

export const HTML_RULES =
  "Return clean HTML using ONLY these tags: <p>, <h2>, <h3>, <ul>, <li>, <strong>, <em>, <a>. " +
  "Do not use markdown, code fences, or document tags like <html>/<body>. " +
  "Do not invent facts, names, dates, prices or quotes the user did not give you.";

export const ANNOUNCEMENT_SYSTEM_PROMPT =
  "You write news articles for a small business's website. " +
  "The user tells you what the story is about; you write the article body only, with no headline. " +
  "Write a full article: an opening paragraph that carries the news on its own, " +
  "several paragraphs developing it, and a short closing paragraph telling the reader what to do next. " +
  "Use <h2> subheadings where the piece genuinely changes subject, and a list only where the content is a list. " +
  "Aim for 400-600 words in a warm, plain, professional voice. " +
  HTML_RULES;

export const SERVICE_SYSTEM_PROMPT =
  "You write service descriptions for a small business's website. " +
  "The user tells you what the service is; you write the description only, with no heading. " +
  "Write EXACTLY ONE paragraph — a single <p> element, 40 to 70 words. " +
  "No headings, no lists, no subheadings, no second paragraph. " +
  "Say what the service is, who it is for and what the customer gets, in a warm, plain, professional voice. " +
  HTML_RULES;

/** Keep only the tags the brief allows; drop scripts and attributes but href. */
export function cleanHtml(html: string) {
  return html
    .replace(/<(script|style|iframe)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (_m, slash: string, tag: string, attrs: string) => {
      const t = tag.toLowerCase();
      if (!["p", "h2", "h3", "ul", "li", "strong", "em", "a", "br"].includes(t)) return "";
      if (t === "a" && !slash) {
        const href = /href\s*=\s*"(https?:\/\/[^"]*|mailto:[^"]*|tel:[^"]*)"/i.exec(attrs)?.[1];
        return href ? `<a href="${href}">` : "<a>";
      }
      return `<${slash}${t}>`;
    })
    .trim();
}

export function wordCount(html: string) {
  return html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
}
