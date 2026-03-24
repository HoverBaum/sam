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

function mtimeEval(map: Record<string, number>) {
  return async (code: string): Promise<string> => {
    const entry = Object.entries(map).find(([path]) => code.includes(JSON.stringify(path)));
    return JSON.stringify(entry?.[1] ?? 0);
  };
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
          read: async (path: string) => path === "fresh.md" ? "fresh body" : "stale body",
          eval: mtimeEval({ "fresh.md": 20, "stale.md": 30 }),
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
              read: async (path: string) => path,
              eval: mtimeEval({ "broken.md": 10, "ok.md": 10 }),
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

Deno.test("indexShellMessages summarizes warnings and remaining failures", () => {
  const result: IndexRunResult = {
    totalFiles: 5,
    indexedCount: 2,
    deletedCount: 1,
    failedCount: 3,
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
