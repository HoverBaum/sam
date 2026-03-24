import type { RuntimeConfig } from "../config.ts";

interface OpenAiEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

interface OllamaEmbeddingResponse {
  embedding?: number[];
  embeddings?: number[][];
}

function ensureSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function authHeader(apiKey?: string): HeadersInit {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export function buildProfileId(provider: string, model: string, dims: number): string {
  return `${provider}_${model}_${dims}`.replace(/[^\w.-]+/g, "_");
}

export async function embed(config: RuntimeConfig, text: string): Promise<number[]> {
  if (config.embeddingProvider === "ollama") {
    return embedOllama(config, text);
  }
  return embedOpenAiCompatible(config, text);
}

async function embedOllama(config: RuntimeConfig, text: string): Promise<number[]> {
  const endpoint = `${ensureSlash(config.embeddingBaseUrl)}api/embeddings`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeader(config.embeddingApiKey),
    },
    body: JSON.stringify({
      model: config.embeddingModel,
      prompt: text,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Embedding provider ollama unreachable or failed (${response.status}) at ${endpoint}`,
    );
  }

  const payload = (await response.json()) as OllamaEmbeddingResponse;
  const vector = payload.embedding ?? payload.embeddings?.[0];
  if (!vector || !Array.isArray(vector) || vector.length === 0) {
    throw new Error("Ollama embedding response did not contain a valid vector.");
  }
  return vector;
}

async function embedOpenAiCompatible(config: RuntimeConfig, text: string): Promise<number[]> {
  const endpoint = `${ensureSlash(config.embeddingBaseUrl)}embeddings`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeader(config.embeddingApiKey),
    },
    body: JSON.stringify({
      model: config.embeddingModel,
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Embedding provider ${config.embeddingProvider} unreachable or failed (${response.status}) at ${endpoint}`,
    );
  }

  const payload = (await response.json()) as OpenAiEmbeddingResponse;
  const vector = payload.data?.[0]?.embedding;
  if (!vector || !Array.isArray(vector) || vector.length === 0) {
    throw new Error(
      `${config.embeddingProvider} embedding response did not contain a valid vector.`,
    );
  }
  return vector;
}

