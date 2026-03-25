import { existsSync } from "@std/fs";
import { basename, join } from "@std/path";
import { getSamHome, type RuntimeConfig } from "../config.ts";
import { buildProfileId } from "./embed.ts";

export const INDEX_SCHEMA_VERSION = 2;

export type IndexItemKind = "note" | "section";

export interface ManifestProfile {
  provider: string;
  model: string;
  dimensions: number;
  schemaVersion: number;
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
    kind?: IndexItemKind;
    sectionPath?: string;
    sectionLevel?: number;
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

function schemaVersionOf(manifest: IndexManifest): number {
  return manifest.profile.schemaVersion ?? 1;
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
    if (
      manifest.profile.provider === config.embeddingProvider &&
      manifest.profile.model === config.embeddingModel &&
      schemaVersionOf(manifest) === INDEX_SCHEMA_VERSION
    ) {
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
  if (schemaVersionOf(manifest) !== INDEX_SCHEMA_VERSION) {
    throw new Error("Index schema mismatch. Run `sam index --rebuild`.");
  }
  if (dims !== undefined && manifest.profile.dimensions !== dims) {
    throw new Error("Index dimensions mismatch. Run `sam index --rebuild`.");
  }
}

export function indexItemKind(item: IndexItem): IndexItemKind {
  return item.metadata.kind ?? "note";
}

export function isNoteItem(item: IndexItem): boolean {
  return indexItemKind(item) === "note";
}

export function buildNoteTitle(path: string): string {
  return basename(path).replace(/\.md$/i, "");
}

export function formatHitTitle(item: IndexItem): string {
  if (indexItemKind(item) === "section") {
    const noteTitle = buildNoteTitle(item.metadata.path);
    const sectionPath = item.metadata.sectionPath ?? item.metadata.title ?? item.id;
    return `${noteTitle} > ${sectionPath}`;
  }
  return item.metadata.title ?? item.metadata.path;
}

export function deleteEntriesForPath(store: Map<string, IndexItem>, path: string): void {
  for (const [itemId, item] of store.entries()) {
    if (item.metadata.path === path) {
      store.delete(itemId);
    }
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

export interface NeighborHit {
  id: string;
  title: string;
  summary: string;
  score: number;
  kind: IndexItemKind;
  path: string;
  sectionPath?: string;
  sourceKind?: IndexItemKind;
  sourceSectionPath?: string;
}

export interface ConnectRankReason {
  label: string;
  detail?: string;
}

export interface ConnectNeighborHit extends NeighborHit {
  /** Final blended score used for ordering. */
  finalScore: number;
  /** Pure cosine to source note/sections before reranking boosts. */
  baseScore: number;
  /** Max cosine to source-linked notes/sections when available. */
  linkedScore: number;
  /** Number of strong section matches found for this note. */
  strongSectionCount: number;
  reasons: ConnectRankReason[];
}

export interface ConnectRankingWeights {
  baseCosine: number;
  linkedSimilarity: number;
  multiSectionEvidence: number;
  mixedEvidence: number;
  directLinkAffinity: number;
  sharedLinkNeighborhood: number;
}

export interface ConnectGraphClient {
  links(path: string): Promise<Array<{ path: string }>>;
  backlinks(path: string): Promise<Array<{ sourcePath: string }>>;
}

export interface ConnectGraphContext {
  linksToSource: boolean;
  sharedSourceLinks: number;
}

export interface ConnectRankingOptions {
  topK?: number;
  candidatePool?: number;
  strongSectionThreshold?: number;
  sourceLinkedPaths?: Iterable<string>;
  excludeSourceLinkedPaths?: boolean;
  weights?: Partial<ConnectRankingWeights>;
  candidateGraphContext?: ReadonlyMap<string, ConnectGraphContext>;
}

export interface ConnectNeighborsOptions extends ConnectRankingOptions {
  graphClient?: ConnectGraphClient;
  graphCache?: Map<string, Promise<{ links: Set<string>; backlinks: Set<string> }>>;
  candidateContextLimit?: number;
}

const DEFAULT_CONNECT_WEIGHTS: ConnectRankingWeights = {
  baseCosine: 0.7,
  linkedSimilarity: 0.15,
  multiSectionEvidence: 0.08,
  mixedEvidence: 0.03,
  directLinkAffinity: 0.02,
  sharedLinkNeighborhood: 0.02,
};

const DEFAULT_CANDIDATE_POOL = 50;
const DEFAULT_CANDIDATE_CONTEXT_LIMIT = 40;
const DEFAULT_STRONG_SECTION_THRESHOLD = 0.72;

function toNeighborHit(item: IndexItem, score: number): NeighborHit {
  return {
    id: item.id,
    title: formatHitTitle(item),
    summary: item.metadata.summary ?? "",
    score,
    kind: indexItemKind(item),
    path: item.metadata.path,
    sectionPath: item.metadata.sectionPath,
  };
}

function normalizeLinkPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  const withoutBrackets = trimmed.startsWith("[[") && trimmed.endsWith("]]")
    ? trimmed.slice(2, -2)
    : trimmed;
  const hash = withoutBrackets.indexOf("#");
  return (hash >= 0 ? withoutBrackets.slice(0, hash) : withoutBrackets).trim();
}

function resolveLinkedPaths(sourceLinkedPaths: Iterable<string> | undefined, store: Map<string, IndexItem>): Set<string> {
  const out = new Set<string>();
  if (!sourceLinkedPaths) {
    return out;
  }
  const indexedNotePaths = new Set<string>();
  const byBaseName = new Map<string, string[]>();
  for (const item of store.values()) {
    if (!isNoteItem(item)) continue;
    indexedNotePaths.add(item.metadata.path);
    const base = basename(item.metadata.path);
    const existing = byBaseName.get(base);
    if (existing) {
      existing.push(item.metadata.path);
    } else {
      byBaseName.set(base, [item.metadata.path]);
    }
  }
  for (const raw of sourceLinkedPaths) {
    const normalized = normalizeLinkPath(raw);
    if (!normalized) continue;
    if (indexedNotePaths.has(normalized)) {
      out.add(normalized);
      continue;
    }
    const baseMatches = byBaseName.get(basename(normalized));
    if (baseMatches && baseMatches.length === 1) {
      out.add(baseMatches[0]);
    }
  }
  return out;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatPct(score: number): string {
  return `${Math.round(clamp01(score) * 100)}%`;
}

interface NoteScoreAccumulator {
  path: string;
  noteTitle?: string;
  summary?: string;
  bestBaseScore: number;
  bestLinkedScore: number;
  bestKind: IndexItemKind;
  bestSectionPath?: string;
  bestSourceSectionPath?: string;
  hasNoteEvidence: boolean;
  hasSectionEvidence: boolean;
  strongSections: Set<string>;
}

function scorePath(
  path: string,
  acc: NoteScoreAccumulator,
  linkedSet: Set<string>,
  options: ConnectRankingOptions,
): ConnectNeighborHit {
  const weights: ConnectRankingWeights = { ...DEFAULT_CONNECT_WEIGHTS, ...(options.weights ?? {}) };
  const graph = options.candidateGraphContext?.get(path);
  const strongSectionFactor = Math.min(3, acc.strongSections.size) / 3;
  const mixedEvidenceFactor = acc.hasNoteEvidence && acc.hasSectionEvidence ? 1 : 0;
  const directLinkFactor = graph?.linksToSource ? 1 : 0;
  const sharedNeighborhoodFactor = Math.min(3, graph?.sharedSourceLinks ?? 0) / 3;
  const finalScore = clamp01(
    (weights.baseCosine * clamp01(acc.bestBaseScore)) +
      (weights.linkedSimilarity * clamp01(acc.bestLinkedScore)) +
      (weights.multiSectionEvidence * strongSectionFactor) +
      (weights.mixedEvidence * mixedEvidenceFactor) +
      (weights.directLinkAffinity * directLinkFactor) +
      (weights.sharedLinkNeighborhood * sharedNeighborhoodFactor),
  );
  const reasons: ConnectRankReason[] = [{ label: `cos ${formatPct(acc.bestBaseScore)}` }];
  if (acc.bestLinkedScore > 0) {
    reasons.push({ label: `linked-context ${formatPct(acc.bestLinkedScore)}` });
  }
  if (acc.strongSections.size > 1) {
    reasons.push({ label: `${acc.strongSections.size} strong sections` });
  }
  if (acc.hasNoteEvidence && acc.hasSectionEvidence) {
    reasons.push({ label: "note + section evidence" });
  }
  if (directLinkFactor > 0) {
    reasons.push({ label: "directly linked" });
  }
  if ((graph?.sharedSourceLinks ?? 0) > 0) {
    reasons.push({ label: `shares ${graph?.sharedSourceLinks} source links` });
  }
  if (linkedSet.size > 0 && !linkedSet.has(path)) {
    reasons.push({ label: "not already linked" });
  }
  return {
    id: path,
    title: acc.noteTitle ?? buildNoteTitle(path),
    summary: acc.summary ?? "",
    score: finalScore,
    finalScore,
    baseScore: clamp01(acc.bestBaseScore),
    linkedScore: clamp01(acc.bestLinkedScore),
    strongSectionCount: acc.strongSections.size,
    reasons,
    kind: "note",
    path,
    sectionPath: acc.bestSectionPath,
    sourceKind: acc.bestKind,
    sourceSectionPath: acc.bestSourceSectionPath,
  };
}

/** Ranking for connect: retrieve a wider pool by cosine, then rerank at note level. */
export function rankConnectCandidates(
  store: Map<string, IndexItem>,
  sourcePath: string,
  options: ConnectRankingOptions = {},
): ConnectNeighborHit[] {
  const topK = Math.max(0, options.topK ?? 5);
  const candidatePool = Math.max(topK, options.candidatePool ?? DEFAULT_CANDIDATE_POOL);
  const strongSectionThreshold = options.strongSectionThreshold ?? DEFAULT_STRONG_SECTION_THRESHOLD;
  const sourceItems = [...store.values()].filter((item) => item.metadata.path === sourcePath);
  if (sourceItems.length === 0) {
    throw new Error(`Note not in index: ${sourcePath}. Run \`sam index\` to index this note.`);
  }
  const linkedSet = resolveLinkedPaths(options.sourceLinkedPaths, store);
  const linkedSourceItems = [...store.values()].filter((item) => linkedSet.has(item.metadata.path));
  const byPath = new Map<string, NoteScoreAccumulator>();
  for (const item of store.values()) {
    const path = item.metadata.path;
    if (path === sourcePath) {
      continue;
    }
    if (options.excludeSourceLinkedPaths !== false && linkedSet.has(path)) {
      continue;
    }
    const kind = indexItemKind(item);
    const existing = byPath.get(path) ?? {
      path,
      bestBaseScore: 0,
      bestLinkedScore: 0,
      bestKind: kind,
      hasNoteEvidence: false,
      hasSectionEvidence: false,
      strongSections: new Set<string>(),
    };
    if (isNoteItem(item)) {
      existing.noteTitle = item.metadata.title ?? buildNoteTitle(path);
      existing.summary = item.metadata.summary ?? existing.summary;
    }
    let base = 0;
    let bestSource: IndexItem | null = null;
    for (const sourceItem of sourceItems) {
      const score = cosine(item.vector, sourceItem.vector);
      if (score > base) {
        base = score;
        bestSource = sourceItem;
      }
    }
    if (base > existing.bestBaseScore) {
      existing.bestBaseScore = base;
      existing.bestKind = kind;
      existing.bestSectionPath = item.metadata.sectionPath;
      existing.bestSourceSectionPath = bestSource?.metadata.sectionPath;
    }
    if (kind === "note") {
      existing.hasNoteEvidence = true;
    } else if (base > 0) {
      existing.hasSectionEvidence = true;
    }
    if (kind === "section" && base >= strongSectionThreshold) {
      existing.strongSections.add(item.metadata.sectionPath ?? item.id);
    }
    let linkedScore = 0;
    for (const linkedSourceItem of linkedSourceItems) {
      linkedScore = Math.max(linkedScore, cosine(item.vector, linkedSourceItem.vector));
    }
    existing.bestLinkedScore = Math.max(existing.bestLinkedScore, linkedScore);
    byPath.set(path, existing);
  }
  const rankedByBase = [...byPath.values()]
    .sort((a, b) => b.bestBaseScore - a.bestBaseScore || a.path.localeCompare(b.path));
  const poolPaths = new Set(rankedByBase.slice(0, candidatePool).map((entry) => entry.path));
  const rankedByLinked = [...byPath.values()]
    .sort((a, b) => b.bestLinkedScore - a.bestLinkedScore || a.path.localeCompare(b.path));
  for (const entry of rankedByLinked.slice(0, candidatePool)) {
    if (entry.bestLinkedScore > 0) {
      poolPaths.add(entry.path);
    }
  }
  return [...poolPaths]
    .map((path) => scorePath(path, byPath.get(path)!, linkedSet, options))
    .sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      if (b.baseScore !== a.baseScore) return b.baseScore - a.baseScore;
      return a.path.localeCompare(b.path);
    })
    .slice(0, topK);
}

/** Pure ranking: cosine similarity to `sourcePath`'s vector, excluding the source note. */
export function rankNearestNeighbors(
  store: Map<string, IndexItem>,
  sourcePath: string,
  k: number,
): NeighborHit[] {
  return rankConnectCandidates(store, sourcePath, {
    topK: k,
    candidatePool: Math.max(k, DEFAULT_CANDIDATE_POOL),
    excludeSourceLinkedPaths: false,
    weights: {
      baseCosine: 1,
      linkedSimilarity: 0,
      multiSectionEvidence: 0,
      mixedEvidence: 0,
      directLinkAffinity: 0,
      sharedLinkNeighborhood: 0,
    },
  }).map((hit) => ({
    id: hit.id,
    title: hit.title,
    summary: hit.summary,
    score: hit.score,
    kind: hit.kind,
    path: hit.path,
    sectionPath: hit.sectionPath,
    sourceKind: hit.sourceKind,
    sourceSectionPath: hit.sourceSectionPath,
  }));
}

export async function nearestNeighbors(
  config: RuntimeConfig,
  sourcePath: string,
  k: number,
): Promise<NeighborHit[]> {
  const dir = await resolveActiveProfileDir(config);
  const manifest = await readManifest(dir);
  if (!manifest) {
    throw new Error("No index profile found. Run `sam index` to build the index.");
  }
  const store = await readStore(dir);
  const source = store.get(sourcePath);
  if (!source) {
    throw new Error(`Note not in index: ${sourcePath}. Run \`sam index\` to index this note.`);
  }
  assertProfileMatch(config, manifest, source.vector.length);
  return rankNearestNeighbors(store, sourcePath, k);
}

async function readGraphSets(
  path: string,
  client: ConnectGraphClient,
  cache: Map<string, Promise<{ links: Set<string>; backlinks: Set<string> }>>,
): Promise<{ links: Set<string>; backlinks: Set<string> }> {
  const existing = cache.get(path);
  if (existing) {
    return await existing;
  }
  const pending = (async () => {
    const [links, backlinks] = await Promise.all([
      client.links(path).catch(() => [] as Array<{ path: string }>),
      client.backlinks(path).catch(() => [] as Array<{ sourcePath: string }>),
    ]);
    return {
      links: new Set(links.map((entry) => normalizeLinkPath(entry.path)).filter((value) => value.length > 0)),
      backlinks: new Set(
        backlinks.map((entry) => normalizeLinkPath(entry.sourcePath)).filter((value) => value.length > 0),
      ),
    };
  })();
  cache.set(path, pending);
  return await pending;
}

export async function connectNeighbors(
  config: RuntimeConfig,
  sourcePath: string,
  options: ConnectNeighborsOptions = {},
): Promise<ConnectNeighborHit[]> {
  const dir = await resolveActiveProfileDir(config);
  const manifest = await readManifest(dir);
  if (!manifest) {
    throw new Error("No index profile found. Run `sam index` to build the index.");
  }
  const store = await readStore(dir);
  const source = store.get(sourcePath);
  if (!source) {
    throw new Error(`Note not in index: ${sourcePath}. Run \`sam index\` to index this note.`);
  }
  assertProfileMatch(config, manifest, source.vector.length);

  const topK = Math.max(0, options.topK ?? 5);
  const candidatePool = Math.max(topK, options.candidatePool ?? DEFAULT_CANDIDATE_POOL);
  const sourceLinks = resolveLinkedPaths(options.sourceLinkedPaths, store);
  const graphContext = new Map<string, ConnectGraphContext>();
  if (options.graphClient) {
    const cache = options.graphCache ?? new Map<string, Promise<{ links: Set<string>; backlinks: Set<string> }>>();
    const sourceSets = await readGraphSets(sourcePath, options.graphClient, cache);
    const sourceLinkSet = new Set<string>([...sourceLinks, ...sourceSets.links]);
    const preRanked = rankConnectCandidates(store, sourcePath, {
      ...options,
      topK: candidatePool,
      candidatePool,
      sourceLinkedPaths: sourceLinkSet,
      candidateGraphContext: undefined,
    });
    const contextPaths = preRanked
      .slice(0, Math.max(0, options.candidateContextLimit ?? DEFAULT_CANDIDATE_CONTEXT_LIMIT))
      .map((hit) => hit.path);
    for (const path of contextPaths) {
      const candidateSets = await readGraphSets(path, options.graphClient, cache);
      const sharedSourceLinks = [...candidateSets.links].filter((linkPath) => sourceLinkSet.has(linkPath)).length;
      const linksToSource = candidateSets.links.has(sourcePath) || candidateSets.backlinks.has(sourcePath);
      graphContext.set(path, {
        linksToSource,
        sharedSourceLinks,
      });
    }
    return rankConnectCandidates(store, sourcePath, {
      ...options,
      topK,
      candidatePool,
      sourceLinkedPaths: sourceLinkSet,
      candidateGraphContext: graphContext,
    });
  }

  return rankConnectCandidates(store, sourcePath, {
    ...options,
    topK,
    candidatePool,
    sourceLinkedPaths: sourceLinks,
  });
}

export async function query(
  config: RuntimeConfig,
  vector: number[],
  topN: number,
): Promise<NeighborHit[]> {
  const dir = await resolveActiveProfileDir(config);
  const manifest = await readManifest(dir);
  if (!manifest) {
    throw new Error("No index profile found. Run `sam index` to build the index.");
  }
  assertProfileMatch(config, manifest, vector.length);

  const store = await readStore(dir);
  return [...store.values()]
    .map((item) => toNeighborHit(item, cosine(item.vector, vector)))
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
