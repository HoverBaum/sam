import { existsSync } from "@std/fs";
import { join } from "@std/path";
import { booleanFlag, stringFlag } from "./utils/args.ts";

export type EmbeddingProvider = "ollama" | "openai" | "openai-compatible";

export interface SamConfigFile {
  vault?: string;
  vaultPath?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  embeddingModel?: string;
  embeddingProvider?: EmbeddingProvider;
  embeddingBaseUrl?: string;
  embeddingApiKey?: string;
}

export interface RuntimeConfig {
  dryRun: boolean;
  vault?: string;
  vaultPath?: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  embeddingModel: string;
  embeddingProvider: EmbeddingProvider;
  embeddingBaseUrl: string;
  embeddingApiKey?: string;
}

export const DEFAULT_CHAT_MODEL = "anthropic/claude-3-5-sonnet-20241022";
export const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";
export const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProvider = "ollama";
export const DEFAULT_EMBEDDING_BASE_URL = "http://127.0.0.1:11434";

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export function getSamHome(env: Record<string, string | undefined> = Deno.env.toObject()): string {
  const home = env.HOME ?? Deno.env.get("HOME");
  if (!home) {
    throw new Error("Unable to resolve HOME for ~/.sam configuration.");
  }
  return join(home, ".sam");
}

export function getConfigPath(env: Record<string, string | undefined> = Deno.env.toObject()): string {
  return join(getSamHome(env), "config.json");
}

export async function loadConfigFile(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): Promise<SamConfigFile> {
  const path = getConfigPath(env);
  if (!existsSync(path)) {
    return {};
  }

  const raw = await Deno.readTextFile(path);
  const parsed = JSON.parse(raw) as SamConfigFile;
  return parsed;
}

function cleanConfig(config: SamConfigFile): SamConfigFile {
  const entries = Object.entries(config).filter(([, value]) => {
    if (value === undefined || value === null) {
      return false;
    }
    if (typeof value === "string" && value.trim().length === 0) {
      return false;
    }
    return true;
  });
  return Object.fromEntries(entries) as SamConfigFile;
}

export async function saveConfigFile(
  config: SamConfigFile,
  env: Record<string, string | undefined> = Deno.env.toObject(),
): Promise<void> {
  await ensureSamDirs(env);
  const path = getConfigPath(env);
  const cleaned = cleanConfig(config);
  await Deno.writeTextFile(path, `${JSON.stringify(cleaned, null, 2)}\n`);
}

export async function ensureSamDirs(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): Promise<void> {
  const samHome = getSamHome(env);
  await Deno.mkdir(samHome, { recursive: true });
  await Deno.mkdir(join(samHome, "index"), { recursive: true });
}

function inferEmbeddingProvider(
  provider: string | undefined,
  baseUrl: string | undefined,
): EmbeddingProvider {
  if (provider === "ollama" || provider === "openai" || provider === "openai-compatible") {
    return provider;
  }
  if (baseUrl?.includes("11434")) {
    return "ollama";
  }
  return DEFAULT_EMBEDDING_PROVIDER;
}

export async function resolveRuntimeConfig(
  flags: Record<string, string | boolean>,
  env: Record<string, string | undefined> = Deno.env.toObject(),
): Promise<RuntimeConfig> {
  const file = await loadConfigFile(env);

  const embeddingBaseUrl = firstDefined(
    stringFlag(flags, "embed-base-url"),
    env.SAM_EMBED_BASE_URL,
    file.embeddingBaseUrl,
    DEFAULT_EMBEDDING_BASE_URL,
  );

  return {
    dryRun: booleanFlag(flags, "dry-run"),
    vault: firstDefined(
      stringFlag(flags, "vault"),
      env.SAM_VAULT,
      file.vault,
    ),
    vaultPath: file.vaultPath,
    model: firstDefined(
      stringFlag(flags, "model"),
      env.SAM_AI_MODEL,
      file.model,
      DEFAULT_CHAT_MODEL,
    )!,
    apiKey: firstDefined(
      stringFlag(flags, "api-key"),
      env.SAM_AI_API_KEY,
      file.apiKey,
    ),
    baseUrl: firstDefined(
      stringFlag(flags, "base-url"),
      env.SAM_AI_BASE_URL,
      file.baseUrl,
    ),
    embeddingModel: firstDefined(
      stringFlag(flags, "embed-model"),
      env.SAM_EMBED_MODEL,
      file.embeddingModel,
      DEFAULT_EMBEDDING_MODEL,
    )!,
    embeddingProvider: inferEmbeddingProvider(
      firstDefined(
        stringFlag(flags, "embed-provider"),
        env.SAM_EMBED_PROVIDER,
        file.embeddingProvider,
      ),
      embeddingBaseUrl,
    ),
    embeddingBaseUrl: embeddingBaseUrl!,
    embeddingApiKey: firstDefined(
      stringFlag(flags, "embed-api-key"),
      env.SAM_EMBED_API_KEY,
      file.embeddingApiKey,
    ),
  };
}
