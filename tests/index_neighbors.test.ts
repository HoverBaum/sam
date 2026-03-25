import { assertEquals, assertThrows } from "@std/assert";
import {
  INDEX_SCHEMA_VERSION,
  rankConnectCandidates,
  rankNearestNeighbors,
  type IndexItem,
} from "../search/index.ts";
import { filterNotePaths, indexedPathsForPicker, resolvePickedNotePath } from "../search/noteAutocomplete.ts";

function item(id: string, v: number[]): IndexItem {
  return {
    id,
    vector: v,
    metadata: { path: id, title: id },
  };
}

Deno.test("rankNearestNeighbors excludes source and orders by cosine", () => {
  const a = item("a.md", [1, 0, 0]);
  const b = item("b.md", [1, 0, 0]);
  const c = item("c.md", [0, 1, 0]);
  const store = new Map<string, IndexItem>([
    [a.id, a],
    [b.id, b],
    [c.id, c],
  ]);
  const hits = rankNearestNeighbors(store, "a.md", 5);
  assertEquals(hits.length, 2);
  assertEquals(hits[0].id, "b.md");
  assertEquals(hits[0].score, 1);
  assertEquals(hits[1].id, "c.md");
});

Deno.test("rankNearestNeighbors throws when source missing", () => {
  const store = new Map<string, IndexItem>([["x.md", item("x.md", [1, 0, 0])]]);
  assertThrows(() => rankNearestNeighbors(store, "missing.md", 3));
});

Deno.test("filterNotePaths prefers basename prefix", () => {
  const paths = ["Inbox/zettel.md", "Projects/Zettel big.md", "Other/foo.md"];
  const got = filterNotePaths("zett", paths, 10);
  assertEquals(got[0], "Inbox/zettel.md");
});

Deno.test("indexedPathsForPicker intersects manifest with store", () => {
  const store = new Map<string, IndexItem>([
    ["a.md", item("a.md", [1, 0])],
    ["b.md", item("b.md", [0, 1])],
  ]);
  const manifest = {
    profile: { provider: "ollama", model: "m", dimensions: 2, schemaVersion: INDEX_SCHEMA_VERSION },
    files: { "a.md": { contentHash: "x", indexedAt: 1 }, "gone.md": { contentHash: "y", indexedAt: 1 } },
  };
  const paths = indexedPathsForPicker(manifest, store);
  assertEquals(paths, ["a.md"]);
});

Deno.test("resolvePickedNotePath resolves unique basename", () => {
  const store = new Map<string, IndexItem>([["Folder/Only.md", item("Folder/Only.md", [1])]]);
  const paths = ["Folder/Only.md"];
  assertEquals(resolvePickedNotePath("Only.md", paths, store), "Folder/Only.md");
});

Deno.test("rankNearestNeighbors excludes sections from the source note", () => {
  const store = new Map<string, IndexItem>([
    ["a.md", item("a.md", [1, 0])],
    [
      "a.md#details",
      {
        id: "a.md#details",
        vector: [1, 0],
        metadata: { kind: "section", path: "a.md", title: "Details", sectionPath: "Details" },
      },
    ],
    [
      "b.md#ideas",
      {
        id: "b.md#ideas",
        vector: [1, 0],
        metadata: { kind: "section", path: "b.md", title: "Ideas", sectionPath: "Ideas" },
      },
    ],
  ]);
  const hits = rankNearestNeighbors(store, "a.md", 5);
  assertEquals(hits.map((hit) => hit.id), ["b.md"]);
  assertEquals(hits[0].kind, "note");
});

Deno.test("rankNearestNeighbors can match from a source section to other notes and sections", () => {
  const store = new Map<string, IndexItem>([
    ["a.md", item("a.md", [1, 0])],
    [
      "a.md#deep-dive",
      {
        id: "a.md#deep-dive",
        vector: [0, 1],
        metadata: { kind: "section", path: "a.md", title: "Deep Dive", sectionPath: "Deep Dive" },
      },
    ],
    ["b.md", item("b.md", [1, 0])],
    [
      "c.md#deep-dive",
      {
        id: "c.md#deep-dive",
        vector: [0, 1],
        metadata: { kind: "section", path: "c.md", title: "Deep Dive", sectionPath: "Deep Dive" },
      },
    ],
  ]);
  const hits = rankNearestNeighbors(store, "a.md", 5);
  assertEquals(hits.map((hit) => hit.id), ["b.md", "c.md"]);
  assertEquals(hits[0].sourceKind, "note");
});

Deno.test("resolvePickedNotePath does not resolve section ids as source notes", () => {
  const store = new Map<string, IndexItem>([
    ["Folder/Only.md", item("Folder/Only.md", [1])],
    [
      "Folder/Only.md#part",
      {
        id: "Folder/Only.md#part",
        vector: [1],
        metadata: { kind: "section", path: "Folder/Only.md", title: "Part", sectionPath: "Part" },
      },
    ],
  ]);
  const paths = ["Folder/Only.md"];
  assertEquals(resolvePickedNotePath("Folder/Only.md#part", paths, store), null);
});

Deno.test("rankConnectCandidates excludes notes already linked to source", () => {
  const store = new Map<string, IndexItem>([
    ["a.md", item("a.md", [1, 0])],
    ["linked.md", item("linked.md", [1, 0])],
    ["other.md", item("other.md", [0.9, 0.1])],
  ]);
  const hits = rankConnectCandidates(store, "a.md", {
    topK: 5,
    sourceLinkedPaths: ["linked.md"],
    excludeSourceLinkedPaths: true,
  });
  assertEquals(hits.map((hit) => hit.id), ["other.md"]);
});

Deno.test("rankConnectCandidates boosts similarity to linked-note context", () => {
  const store = new Map<string, IndexItem>([
    ["source.md", item("source.md", [1, 0])],
    ["linked.md", item("linked.md", [0, 1])],
    ["base.md", item("base.md", [0.9, 0.1])],
    ["context.md", item("context.md", [0.8, 0.8])],
  ]);
  const hits = rankConnectCandidates(store, "source.md", {
    topK: 2,
    sourceLinkedPaths: ["linked.md"],
    excludeSourceLinkedPaths: false,
    weights: {
      baseCosine: 0.45,
      linkedSimilarity: 0.45,
      multiSectionEvidence: 0.05,
      mixedEvidence: 0.05,
      directLinkAffinity: 0,
      sharedLinkNeighborhood: 0,
    },
  });
  assertEquals(hits[0].id, "context.md");
  assertEquals(hits[0].linkedScore > 0, true);
});

Deno.test("rankConnectCandidates boosts candidates with multiple strong sections", () => {
  const store = new Map<string, IndexItem>([
    ["source.md", item("source.md", [1, 0])],
    ["one.md", item("one.md", [0.8, 0.2])],
    [
      "one.md#sec1",
      {
        id: "one.md#sec1",
        vector: [1, 0],
        metadata: { kind: "section", path: "one.md", title: "sec1", sectionPath: "sec1" },
      },
    ],
    ["many.md", item("many.md", [0.78, 0.22])],
    [
      "many.md#a",
      { id: "many.md#a", vector: [1, 0], metadata: { kind: "section", path: "many.md", sectionPath: "a" } },
    ],
    [
      "many.md#b",
      { id: "many.md#b", vector: [1, 0], metadata: { kind: "section", path: "many.md", sectionPath: "b" } },
    ],
    [
      "many.md#c",
      { id: "many.md#c", vector: [1, 0], metadata: { kind: "section", path: "many.md", sectionPath: "c" } },
    ],
  ]);
  const hits = rankConnectCandidates(store, "source.md", { topK: 2 });
  assertEquals(hits[0].id, "many.md");
  assertEquals(hits[0].strongSectionCount, 3);
});

Deno.test("rankConnectCandidates reranks larger pool then truncates to top five", () => {
  const entries: Array<[string, IndexItem]> = [["source.md", item("source.md", [1, 0])]];
  for (let i = 0; i < 12; i += 1) {
    entries.push([`n${i}.md`, item(`n${i}.md`, [1 - (i * 0.01), i * 0.01])]);
  }
  const store = new Map<string, IndexItem>(entries);
  const hits = rankConnectCandidates(store, "source.md", { topK: 5, candidatePool: 10 });
  assertEquals(hits.length, 5);
});

Deno.test("rankConnectCandidates keeps deterministic order on ties", () => {
  const store = new Map<string, IndexItem>([
    ["source.md", item("source.md", [1, 0])],
    ["b.md", item("b.md", [0.5, 0.5])],
    ["a.md", item("a.md", [0.5, 0.5])],
  ]);
  const hits = rankConnectCandidates(store, "source.md", { topK: 2 });
  assertEquals(hits.map((hit) => hit.id), ["a.md", "b.md"]);
});
