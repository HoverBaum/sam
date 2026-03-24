import { assertEquals, assertRejects } from "@std/assert";
import {
  executeIndex,
  indexShellMessages,
  type IndexRunResult,
} from "../commands/index.tsx";
import type { RuntimeConfig } from "../config.ts";
import {
  readManifest,
  readStore,
  resolveProfileDir,
  writeManifest,
  writeStore,
} from "../search/index.ts";
import type { CommandContext } from "../types.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function testConfig(): RuntimeConfig {
  return {
    dryRun: false,
    vault: "Notes",
    model: "anthropic/claude-3-5-sonnet-20241022",
    embeddingProvider: "ollama",
    embeddingModel: "nomic-embed-text",
    embeddingBaseUrl: "http://127.0.0.1:11434",
  };
}

function testContext(): CommandContext {
  return {
    config: testConfig(),
    cwd: Deno.cwd(),
  };
}

async function withTempHome(fn: () => Promise<void>): Promise<void> {
  const previousHome = Deno.env.get("HOME");
  const tempHome = await Deno.makeTempDir();
  Deno.env.set("HOME", tempHome);
  try {
    await fn();
  } finally {
    if (previousHome === undefined) {
      Deno.env.delete("HOME");
    } else {
      Deno.env.set("HOME", previousHome);
    }
    await Deno.remove(tempHome, { recursive: true });
  }
}

function fileStats(map: Record<string, number>) {
  return async (paths: string[]) => paths.map((path) => ({ path, mtime: map[path] ?? 0 }));
}

Deno.test("executeIndex continues on embed errors for shell runs and preserves prior entries", async () => {
  await withTempHome(async () => {
    const context = testContext();
    const profileDir = await resolveProfileDir(context.config, 2);
    await writeManifest(profileDir, {
      profile: {
        provider: context.config.embeddingProvider,
        model: context.config.embeddingModel,
        dimensions: 2,
      },
      files: {
        "stale.md": { contentHash: "old-hash", indexedAt: 1 },
      },
    });
    await writeStore(profileDir, new Map([
      [
        "stale.md",
        {
          id: "stale.md",
          vector: [1, 0],
          metadata: { path: "stale.md", title: "stale" },
        },
      ],
    ]));

    const result = await executeIndex(
      context,
      { flags: {}, positionals: [] },
      () => {},
      {
        continueOnEmbedError: true,
        createVaultClient: () => ({
          files: async () => ["fresh.md", "stale.md"],
          fileStats: fileStats({ "fresh.md": 20, "stale.md": 30 }),
          read: async (path: string) => path === "fresh.md" ? "fresh body" : "stale body",
        }),
        embedText: async (_config, text) => {
          if (text === "stale body") {
            throw new Error("Ollama embedding response did not contain a valid vector.");
          }
          return [0, 1];
        },
        now: () => 40,
      },
    );

    assertEquals(result.indexedCount, 1);
    assertEquals(result.failedCount, 1);
    assertEquals(result.emptySkippedCount, 0);
    assertEquals(result.deletedCount, 0);
    assertEquals(result.failureSamples.length, 1);
    assertEquals(result.failureSamples[0].path, "stale.md");

    const manifest = await readManifest(profileDir);
    assertEquals(manifest?.files["fresh.md"]?.indexedAt, 40);
    assertEquals(manifest?.files["stale.md"]?.indexedAt, 1);

    const store = await readStore(profileDir);
    assertEquals(store.get("fresh.md")?.vector, [0, 1]);
    assertEquals(store.get("stale.md")?.vector, [1, 0]);
  });
});

Deno.test("executeIndex keeps blocking behavior by default", async () => {
  await withTempHome(async () => {
    const context = testContext();

    await assertRejects(
      () =>
        executeIndex(
          context,
          { flags: {}, positionals: [] },
          () => {},
          {
            createVaultClient: () => ({
              files: async () => ["broken.md", "ok.md"],
              fileStats: fileStats({ "broken.md": 10, "ok.md": 10 }),
              read: async (path: string) => path,
            }),
            embedText: async (_config, text) => {
              if (text === "broken.md") {
                throw new Error("Ollama embedding response did not contain a valid vector.");
              }
              return [1, 0];
            },
            now: () => 20,
          },
        ),
      Error,
      "Ollama embedding response did not contain a valid vector.",
    );

    const activeDir = await resolveProfileDir(context.config, 768);
    assertEquals(await readManifest(activeDir), null);
  });
});

Deno.test("executeIndex uses one batched fileStats lookup for staleness", async () => {
  await withTempHome(async () => {
    const context = testContext();
    const calls: string[][] = [];

    const result = await executeIndex(
      context,
      { flags: { "skip-embed": true }, positionals: [] },
      () => {},
      {
        createVaultClient: () => ({
          files: async () => ["a.md", "b.md", "c.md"],
          fileStats: async (paths: string[]) => {
            calls.push(paths);
            return paths.map((path, index) => ({ path, mtime: index + 1 }));
          },
          read: async () => "body",
        }),
        now: () => 50,
      },
    );

    assertEquals(result.indexedCount, 3);
    assertEquals(result.emptySkippedCount, 0);
    assertEquals(calls, [["a.md", "b.md", "c.md"]]);
  });
});

Deno.test("executeIndex limits concurrent embedding work to four notes", async () => {
  await withTempHome(async () => {
    const context = testContext();
    let inFlight = 0;
    let maxInFlight = 0;

    const result = await executeIndex(
      context,
      { flags: {}, positionals: [] },
      () => {},
      {
        createVaultClient: () => ({
          files: async () => ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"],
          fileStats: fileStats({
            "a.md": 1,
            "b.md": 2,
            "c.md": 3,
            "d.md": 4,
            "e.md": 5,
            "f.md": 6,
          }),
          read: async (path: string) => path,
        }),
        embedText: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await delay(5);
          inFlight -= 1;
          return [1, 0];
        },
        now: () => 100,
      },
    );

    assertEquals(result.indexedCount, 6);
    assertEquals(result.emptySkippedCount, 0);
    assertEquals(maxInFlight, 4);
  });
});

Deno.test("executeIndex skips empty files without embedding or failing", async () => {
  await withTempHome(async () => {
    const context = testContext();
    let embedCalls = 0;

    const result = await executeIndex(
      context,
      { flags: {}, positionals: [] },
      () => {},
      {
        createVaultClient: () => ({
          files: async () => ["empty.md", "ok.md"],
          fileStats: fileStats({ "empty.md": 1, "ok.md": 2 }),
          read: async (path: string) => path === "empty.md" ? "" : "hello",
        }),
        embedText: async (_config, text) => {
          embedCalls += 1;
          assertEquals(text, "hello");
          return [1, 0];
        },
        now: () => 10,
      },
    );

    assertEquals(embedCalls, 1);
    assertEquals(result.indexedCount, 1);
    assertEquals(result.emptySkippedCount, 1);
    assertEquals(result.failedCount, 0);

    const profileDir = await resolveProfileDir(context.config, 2);
    const manifest = await readManifest(profileDir);
    assertEquals(manifest?.files["ok.md"]?.indexedAt, 10);
    assertEquals(manifest?.files["empty.md"], undefined);
  });
});

Deno.test("indexShellMessages summarizes warnings and remaining failures", () => {
  const result: IndexRunResult = {
    totalFiles: 5,
    indexedCount: 2,
    deletedCount: 1,
    failedCount: 3,
    emptySkippedCount: 0,
    failureSamples: [
      { path: "a.md", message: "Skipped a.md: ollama returned no embedding vector." },
      { path: "b.md", message: "Skipped b.md: ollama could not return embeddings." },
    ],
    skipEmbed: false,
    dryRun: false,
  };

  assertEquals(indexShellMessages(result), [
    "Index run finished with warnings (2 indexed, 1 removed, 3 skipped).",
    "Skipped a.md: ollama returned no embedding vector.",
    "Skipped b.md: ollama could not return embeddings.",
    "1 more note was skipped during indexing.",
  ]);
});

Deno.test("indexShellMessages reports empty skips alongside success", () => {
  const result: IndexRunResult = {
    totalFiles: 3,
    indexedCount: 2,
    deletedCount: 0,
    failedCount: 0,
    emptySkippedCount: 1,
    failureSamples: [],
    skipEmbed: false,
    dryRun: false,
  };

  assertEquals(indexShellMessages(result), [
    "Index run finished (2 indexed, 0 removed).",
    "Skipped 1 empty note — it has no content to index.",
  ]);
});
