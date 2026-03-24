import { existsSync } from "@std/fs";
import { join } from "@std/path";
import { getSamHome, type RuntimeConfig } from "../config.ts";
import { buildProfileId } from "./embed.ts";

export interface ManifestProfile {
  provider: string;
  model: string;
  dimensions: number;
}

export interface ManifestEntry {
  contentHash: string;
  indexedAt: number;
}

export interface IndexManifest {
  profile: ManifestProfile;
  files: Record<string, ManifestEntry>;
}

export interface IndexItem {
  id: string;
  vector: number[];
  metadata: {
    path: string;
    title?: string;
    summary?: string;
  };
}

interface StoredIndex {
  items: IndexItem[];
}

export interface StalenessSummary {
  newPaths: string[];
  modifiedPaths: string[];
  deletedPaths: string[];
  currentPaths: string[];
}

export interface ManifestSummary {
  indexedFiles: number;
  profile: string;
}

function unknownProfilePrefix(config: RuntimeConfig): string {
  return `${config.embeddingProvider}_${config.embeddingModel}`.replace(/[^\w.-]+/g, "_");
}

async function indexRoot(): Promise<string> {
  const root = join(getSamHome(), "index");
  await Deno.mkdir(root, { recursive: true });
  return root;
}

async function listDirs(path: string): Promise<string[]> {
  if (!existsSync(path)) {
    return [];
  }
  const out: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    if (entry.isDirectory) out.push(entry.name);
  }
  return out;
}

export async function resolveActiveProfileDir(config: RuntimeConfig): Promise<string> {
  const root = await indexRoot();
  const prefix = unknownProfilePrefix(config);
  const dirs = await listDirs(root);
  const matches: Array<{ dir: string; manifest: IndexManifest }> = [];
  for (const dir of dirs) {
    if (!dir.startsWith(prefix)) continue;
    const manifest = await readManifest(join(root, dir));
    if (!manifest) continue;
    if (manifest.profile.provider === config.embeddingProvider && manifest.profile.model === config.embeddingModel) {
      matches.push({ dir, manifest });
    }
  }

  if (matches.length === 1) {
    return join(root, matches[0].dir);
  }

  if (matches.length > 1) {
    throw new Error(
      "Multiple index profiles found for this embedding provider/model. Run `sam index --rebuild` to select a single active profile.",
    );
  }

  return join(root, prefix);
}

export async function resolveProfileDir(config: RuntimeConfig, dimensions: number): Promise<string> {
  return join(await indexRoot(), buildProfileId(config.embeddingProvider, config.embeddingModel, dimensions));
}

export async function readManifest(path: string): Promise<IndexManifest | null> {
  const file = join(path, "manifest.json");
  if (!existsSync(file)) return null;
  return JSON.parse(await Deno.readTextFile(file)) as IndexManifest;
}

export async function writeManifest(path: string, manifest: IndexManifest): Promise<void> {
  await Deno.mkdir(path, { recursive: true });
  await Deno.writeTextFile(join(path, "manifest.json"), JSON.stringify(manifest, null, 2));
}

export async function readStore(path: string): Promise<Map<string, IndexItem>> {
  const file = join(path, "index.json");
  if (!existsSync(file)) return new Map<string, IndexItem>();
  const parsed = JSON.parse(await Deno.readTextFile(file)) as StoredIndex;
  return new Map((parsed.items ?? []).map((item) => [item.id, item]));
}

export async function writeStore(path: string, store: Map<string, IndexItem>): Promise<void> {
  await Deno.mkdir(path, { recursive: true });
  const payload: StoredIndex = { items: [...store.values()] };
  await Deno.writeTextFile(join(path, "index.json"), JSON.stringify(payload, null, 2));
}

export async function hashContent(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function assertProfileMatch(config: RuntimeConfig, manifest: IndexManifest, dims?: number): void {
  if (manifest.profile.provider !== config.embeddingProvider || manifest.profile.model !== config.embeddingModel) {
    throw new Error("Index profile mismatch. Run `sam index --rebuild`.");
  }
  if (dims !== undefined && manifest.profile.dimensions !== dims) {
    throw new Error("Index dimensions mismatch. Run `sam index --rebuild`.");
  }
}

export function classifyStaleness(
  manifest: IndexManifest | null,
  current: Array<{ path: string; mtime: number }>,
): StalenessSummary {
  const indexed = manifest?.files ?? {};
  const seen = new Set<string>();
  const newPaths: string[] = [];
  const modifiedPaths: string[] = [];
  const currentPaths: string[] = [];

  for (const file of current) {
    seen.add(file.path);
    const entry = indexed[file.path];
    if (!entry) {
      newPaths.push(file.path);
      continue;
    }
    if (file.mtime > entry.indexedAt) {
      modifiedPaths.push(file.path);
    } else {
      currentPaths.push(file.path);
    }
  }

  const deletedPaths = Object.keys(indexed).filter((path) => !seen.has(path));
  return { newPaths, modifiedPaths, deletedPaths, currentPaths };
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

export async function query(
  config: RuntimeConfig,
  vector: number[],
  topN: number,
): Promise<Array<{ id: string; title: string; summary: string; score: number }>> {
  const dir = await resolveActiveProfileDir(config);
  const manifest = await readManifest(dir);
  if (!manifest) {
    throw new Error("No index profile found. Run `sam index` to build the index.");
  }
  assertProfileMatch(config, manifest, vector.length);

  const store = await readStore(dir);
  return [...store.values()]
    .map((item) => ({
      id: item.id,
      title: item.metadata.title ?? item.metadata.path,
      summary: item.metadata.summary ?? "",
      score: cosine(item.vector, vector),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

export function indexManifestSummary(manifest: IndexManifest | null): ManifestSummary {
  if (!manifest) {
    return {
      indexedFiles: 0,
      profile: "(none)",
    };
  }

  return {
    indexedFiles: Object.keys(manifest.files).length,
    profile: `${manifest.profile.provider}/${manifest.profile.model}/${manifest.profile.dimensions}`,
  };
}
