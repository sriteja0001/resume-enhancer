// The only module that talks to Claude. Everything else calls structuredCall
// or textCall. When no credentials exist the app runs in DEMO MODE with
// offline stand-ins (lib/ai/demo.ts) — announced loudly in the UI, because a
// silent fallback reads exactly like a working product and isn't one.

import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

export function isDemo(): boolean {
  if (process.env.DEMO_MODE === "1") return true;
  return !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN;
}

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!cached) cached = new Anthropic();
  return cached;
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function checkStop(message: Anthropic.Message): void {
  if (message.stop_reason === "refusal") {
    const why = message.stop_details?.explanation;
    throw new Error(`The model declined this request${why ? `: ${why}` : "."}`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "Model output hit the token ceiling. Try a shorter job description, or fewer entities in memory."
    );
  }
}

/**
 * Structured output: the schema guarantees SHAPE. Truth constraints (numbers
 * traceable to memory, character budgets) are enforced separately in code.
 * Streaming is used because max_tokens is large enough to risk HTTP timeouts.
 */
export async function structuredCall<T>(args: {
  system: string;
  messages: Anthropic.MessageParam[];
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: args.maxTokens ?? 32000,
    system: args.system,
    messages: args.messages,
    output_config: { format: { type: "json_schema", schema: args.schema } },
  });
  const message = await stream.finalMessage();
  checkStop(message);
  return JSON.parse(textOf(message)) as T;
}

export async function textCall(args: {
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
}): Promise<string> {
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: args.maxTokens ?? 8000,
    system: args.system,
    messages: args.messages,
  });
  const message = await stream.finalMessage();
  checkStop(message);
  return textOf(message);
}
