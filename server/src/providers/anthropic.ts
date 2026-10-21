import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { config } from "../config.js";
import { priceFor } from "../lib/costs.js";
import type { LlmImage, LlmUsage, ProviderStatus } from "./types.js";

export function anthropicStatus(): ProviderStatus {
  const ready = !!config.anthropicApiKey;
  return {
    id: "anthropic", label: `Claude (${config.anthropicModel})`, kind: "llm", external: true, ready, verified: false,
    missing: ready ? undefined : "Añade ANTHROPIC_API_KEY al archivo .env del servidor y reinicia",
    costNote: "De pago por tokens. Se envían transcripciones y algunos fotogramas reducidos a Anthropic, nunca el vídeo completo",
  };
}

let client: Anthropic | null = null;

/**
 * Una única llamada estructurada: devuelve JSON validado con el esquema Zod.
 * Las imágenes se envían como fotogramas JPEG reducidos.
 */
export async function anthropicJson<T extends z.ZodType>(opts: {
  system: string;
  prompt: string;
  images: LlmImage[];
  schema: T;
  effort: "low" | "medium" | "high";
  model?: string;
}): Promise<{ data: z.infer<T>; usage: LlmUsage; model: string }> {
  if (!config.anthropicApiKey) throw new Error(anthropicStatus().missing);
  client ??= new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 2, timeout: 10 * 60 * 1000 });
  const model = opts.model ?? config.anthropicModel;
  const content: Anthropic.ContentBlockParam[] = [];
  for (const img of opts.images) {
    content.push({ type: "text", text: img.label });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.data } });
  }
  content.push({ type: "text", text: opts.prompt });

  const stream = client.messages.stream({
    model,
    max_tokens: 32000,
    system: opts.system,
    output_config: { effort: opts.effort, format: zodOutputFormat(opts.schema) },
    messages: [{ role: "user", content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("El proveedor de IA rechazó la solicitud");
  if (msg.stop_reason === "max_tokens") throw new Error("La respuesta de la IA se cortó por longitud");
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = opts.schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("La IA devolvió un formato inesperado");
  const price = priceFor("anthropic", model);
  const inputTokens = msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
  const costUsd = price ? (inputTokens * price.input + msg.usage.output_tokens * price.output) / 1e6 : null;
  return { data: parsed.data, usage: { inputTokens, outputTokens: msg.usage.output_tokens, costUsd }, model };
}

/** Estimación previa aproximada (≈3,5 caracteres por token; ~1.600 tokens por imagen de 1 MP). */
export function estimateAnthropicCost(promptChars: number, images: { w: number; h: number }[], expectedOutputTokens: number, model = config.anthropicModel) {
  const price = priceFor("anthropic", model);
  const inTok = promptChars / 3.5 + images.reduce((a, i) => a + (i.w * i.h) / 750, 0);
  if (!price) return { inputTokens: Math.round(inTok), costUsd: null };
  return { inputTokens: Math.round(inTok), costUsd: (inTok * price.input + expectedOutputTokens * price.output) / 1e6 };
}
