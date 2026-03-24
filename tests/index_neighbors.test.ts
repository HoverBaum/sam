import { assertEquals, assertThrows } from "@std/assert";
import { rankNearestNeighbors, type IndexItem } from "../search/index.ts";
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
    profile: { provider: "ollama", model: "m", dimensions: 2 },
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
