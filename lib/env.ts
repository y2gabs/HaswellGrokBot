/**
 * Server-side configuration. Read lazily so `next build` works without the
 * secrets present; a missing value fails at the first request that needs it.
 */

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const env = {
  /** Public URL of this app, e.g. https://bots.haswell.app (no trailing slash). */
  appUrl: () => required("APP_URL").replace(/\/+$/, ""),
  /** Network main site that hosts the "Connect your website" page. */
  wpNetworkUrl: () => required("WP_NETWORK_URL").replace(/\/+$/, ""),
  /** Same value as HASWELL_BOTS_CLIENT_SECRET in wp-config.php. */
  clientSecret: () => required("HASWELL_BOTS_CLIENT_SECRET"),
  /** 32+ random characters; encrypts the session cookie. */
  sessionSecret: () => {
    const secret = required("SESSION_SECRET");
    if (secret.length < 32) {
      throw new Error("SESSION_SECRET must be at least 32 characters.");
    }
    return secret;
  },
  deepseekKey: () => required("DEEPSEEK_API_KEY"),
  deepseekBaseUrl: () => optional("DEEPSEEK_BASE_URL", "https://api.deepseek.com").replace(/\/+$/, ""),
  deepseekModel: () => optional("DEEPSEEK_MODEL", "deepseek-v4-flash"),
  deepseekWriterModel: () =>
    optional("DEEPSEEK_WRITER_MODEL", optional("DEEPSEEK_MODEL", "deepseek-v4-flash")),
  openaiKey: () => optional("OPENAI_API_KEY"),
  openaiBaseUrl: () => optional("OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/+$/, ""),
  openaiImageModel: () => optional("OPENAI_IMAGE_MODEL", "gpt-image-1-mini"),
  openaiImageQuality: () => optional("OPENAI_IMAGE_QUALITY", "low"),
  geminiKey: () => optional("GEMINI_API_KEY"),
  geminiImageModel: () => optional("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image"),
  /** Where generated image candidates wait until one is picked. */
  dataDir: () => optional("DATA_DIR", ".data"),
};
