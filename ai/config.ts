import type { RuntimeConfig } from "../config.ts";

export type ChatProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "mistral"
  | "groq"
  | "unknown";

export interface ChatModelTarget {
  provider: ChatProvider;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
}

function inferProvider(modelId: string): ChatProvider {
  const prefix = modelId.split("/")[0];
  if (
    prefix === "anthropic" || prefix === "openai" || prefix === "google" ||
    prefix === "mistral" || prefix === "groq"
  ) {
    return prefix;
  }
  return "unknown";
}

export function resolveChatModelTarget(config: RuntimeConfig): ChatModelTarget {
  return {
    provider: inferProvider(config.model),
    modelId: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  };
}

