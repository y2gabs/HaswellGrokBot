import { env } from "../env";

/**
 * DeepSeek V4 over its OpenAI-compatible chat/completions endpoint.
 * Flash is the default for both orchestration and writing; set
 * DEEPSEEK_MODEL / DEEPSEEK_WRITER_MODEL to deepseek-v4-pro to trade cost for
 * quality on either.
 */

export type LlmMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type LlmTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type LlmReply = {
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  finishReason: string;
};

export class AiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(`${env.deepseekBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.deepseekKey()}` },
      body: JSON.stringify({ ...body, stream: false }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    throw new AiError(502, "Couldn't reach the AI service. Please try again.");
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = (data.error as { message?: string } | undefined)?.message ?? `DeepSeek returned ${res.status}`;
    throw new AiError(502, `AI error: ${message}`);
  }
  return data;
}

type Choice = {
  finish_reason?: string;
  message?: {
    content?: string | null;
    tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  };
};

/** One orchestration step: the model either answers or asks for tools. */
export async function chat(messages: LlmMessage[], tools: LlmTool[]): Promise<LlmReply> {
  const data = await call({
    model: env.deepseekModel(),
    messages,
    tools,
    tool_choice: "auto",
    temperature: 0.4,
    max_tokens: 2000,
  });
  const choice = ((data.choices as Choice[] | undefined) ?? [])[0] ?? {};
  return {
    content: (choice.message?.content ?? "").trim(),
    toolCalls: (choice.message?.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: c.function.arguments || "{}",
    })),
    finishReason: choice.finish_reason ?? "",
  };
}

/** Plain completion for long-form writing (no tools). */
export async function write(system: string, prompt: string, opts: { maxTokens: number; temperature: number }) {
  const data = await call({
    model: env.deepseekWriterModel(),
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
  });
  const choice = ((data.choices as Choice[] | undefined) ?? [])[0] ?? {};
  const text = stripFence((choice.message?.content ?? "").trim());
  if (!text) {
    throw new AiError(
      502,
      choice.finish_reason === "length"
        ? "The article ran past its length limit. Try again."
        : "The AI returned an empty response. Try again.",
    );
  }
  return text;
}

export function stripFence(text: string) {
  if (!text.startsWith("```")) return text;
  return text
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
}
