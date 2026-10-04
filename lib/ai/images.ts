import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../env";
import { AiError } from "./deepseek";

/**
 * Featured-image candidates, ported from the admin plugin's picker: the
 * candidates wait on this server's disk and only the one the user picks is
 * uploaded to their media library, so rejects never clutter it.
 */

type Candidate = { mime: string; data: Buffer };

const TTL_MS = 24 * 60 * 60 * 1000;

export function imagesConfigured() {
  return Boolean(env.openaiKey() || env.geminiKey());
}

async function openaiCandidates(prompt: string, count: number): Promise<Candidate[]> {
  const attempts = [
    { model: env.openaiImageModel(), output_format: "webp" },
    { model: "gpt-image-1" },
  ];
  let message = "Image generation failed.";
  for (const extra of attempts) {
    const res = await fetch(`${env.openaiBaseUrl()}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.openaiKey()}` },
      body: JSON.stringify({ prompt, n: count, size: "1536x1024", quality: env.openaiImageQuality(), ...extra }),
      signal: AbortSignal.timeout(180_000),
    }).catch(() => null);
    if (!res) throw new AiError(502, "Couldn't reach the image service.");
    const data = (await res.json().catch(() => ({}))) as {
      data?: { b64_json?: string }[];
      output_format?: string;
      error?: { message?: string };
    };
    if (res.ok) {
      const format = data.output_format ?? ("output_format" in extra ? extra.output_format : "png");
      const images = (data.data ?? [])
        .filter((d) => d.b64_json)
        .map((d) => ({ mime: `image/${format === "jpg" ? "jpeg" : format}`, data: Buffer.from(d.b64_json!, "base64") }));
      if (images.length) return images;
      message = "The AI didn't return any images. Try a different description.";
      continue;
    }
    message = data.error?.message ?? `OpenAI returned ${res.status}`;
    if (res.status < 400 || res.status >= 500) break;
  }
  throw new AiError(502, message);
}

async function geminiCandidate(prompt: string): Promise<Candidate | null> {
  const model = env.geminiImageModel();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiKey() },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
    signal: AbortSignal.timeout(120_000),
  }).catch(() => null);
  if (!res) throw new AiError(502, "Couldn't reach the image service.");
  const data = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new AiError(502, data.error?.message ?? `Image model returned ${res.status}`);
  for (const part of data.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      return { mime: part.inlineData.mimeType ?? "image/png", data: Buffer.from(part.inlineData.data, "base64") };
    }
  }
  return null;
}

export async function generateCandidates(prompt: string, count = 3): Promise<Candidate[]> {
  count = Math.max(1, Math.min(4, count));
  if (env.openaiKey()) return openaiCandidates(prompt, count);
  if (env.geminiKey()) {
    const results = await Promise.all(Array.from({ length: count }, () => geminiCandidate(prompt).catch(() => null)));
    const images = results.filter((r): r is Candidate => r !== null);
    if (!images.length) throw new AiError(502, "The AI didn't return an image. Try a different description.");
    return images;
  }
  throw new AiError(503, "Image generation isn't set up (OPENAI_API_KEY or GEMINI_API_KEY).");
}

/* ── Stash ─────────────────────────────────────────────────────────────── */

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function dir(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) throw new AiError(400, "Unknown image set.");
  return path.resolve(env.dataDir(), "candidates", token);
}

/** Save candidates for one site and return a token for them. */
export async function stash(siteKey: string, images: Candidate[]) {
  const token = randomBytes(16).toString("hex");
  const target = dir(token);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "owner"), siteKey);
  await Promise.all(
    images.map((img, i) => writeFile(path.join(target, `${i}.${EXT[img.mime] ?? "png"}`), img.data)),
  );
  void sweep();
  return token;
}

export async function readCandidate(siteKey: string, token: string, index: number) {
  const target = dir(token);
  const owner = await readFile(path.join(target, "owner"), "utf8").catch(() => "");
  if (owner !== siteKey) throw new AiError(404, "Those images have expired.");
  const files = await readdir(target);
  const file = files.find((f) => f.startsWith(`${index}.`));
  if (!file) throw new AiError(404, "That image is no longer available.");
  const ext = file.split(".").pop()!;
  const mime = Object.entries(EXT).find(([, e]) => e === ext)?.[0] ?? "image/png";
  return { data: await readFile(path.join(target, file)), mime, filename: file };
}

/** Drop candidate sets older than a day. */
async function sweep() {
  const root = path.resolve(env.dataDir(), "candidates");
  const entries = await readdir(root).catch(() => [] as string[]);
  const now = Date.now();
  await Promise.all(
    entries.map(async (name) => {
      const info = await stat(path.join(root, name)).catch(() => null);
      if (info && now - info.mtimeMs > TTL_MS) await rm(path.join(root, name), { recursive: true, force: true });
    }),
  );
}
