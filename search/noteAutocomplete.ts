import { basename } from "@std/path";
import type { IndexItem, IndexManifest } from "./index.ts";

const DEFAULT_MAX = 10;

/** Paths that appear in both the manifest and the vector store (embed-ready). */
export function indexedPathsForPicker(manifest: IndexManifest | null, store: Map<string, IndexItem>): string[] {
  if (!manifest?.files || Object.keys(manifest.files).length === 0) {
    return [...store.keys()].sort();
  }
  return Object.keys(manifest.files)
    .filter((p) => store.has(p))
    .sort();
}

/** Rank by basename prefix first, then substring in full path. */
export function filterNotePaths(query: string, paths: string[], maxResults: number = DEFAULT_MAX): string[] {
  if (!paths.length) return [];
  const q = query.trim().toLowerCase();
  if (!q) return paths.slice(0, maxResults);

  const scored: Array<{ path: string; rank: number }> = [];
  for (const path of paths) {
    const base = basename(path);
    const baseLower = base.toLowerCase();
    const fullLower = path.toLowerCase();
    let rank = -1;
    if (baseLower.startsWith(q)) {
      rank = 1000 + Math.min(200, 300 - baseLower.length);
    } else if (fullLower.includes(q)) {
      rank = 500 - fullLower.indexOf(q);
    }
    if (rank >= 0) {
      scored.push({ path, rank });
    }
  }
  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, maxResults).map((s) => s.path);
}

/** Resolve user input to a vault path when unambiguous (exact path, or unique basename). */
export function resolvePickedNotePath(input: string, indexedPaths: string[], store: Map<string, IndexItem>): string | null {
  const t = input.trim();
  if (!t) return null;
  if (store.has(t)) return t;
  const exactPath = indexedPaths.filter((p) => p === t);
  if (exactPath.length === 1) return exactPath[0];
  const baseMatches = indexedPaths.filter((p) => basename(p) === t);
  if (baseMatches.length === 1) return baseMatches[0];
  return null;
}
