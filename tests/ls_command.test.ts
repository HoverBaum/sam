import { assertEquals, assertRejects } from "@std/assert";
import { executeLs } from "../commands/ls.tsx";
import type { RuntimeConfig } from "../config.ts";
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

Deno.test("executeLs lists markdown files in sorted order", async () => {
  const result = await executeLs(
    testContext(),
    { flags: {}, positionals: [] },
    {
      createVaultClient: () => ({
        files: async () => ["z.md", "B.md", "notes.txt", "a.md"],
      }),
    },
  );

  assertEquals(result.paths, ["a.md", "B.md", "z.md"]);
  assertEquals(result.excludedByFolder, 0);
  assertEquals(result.excludedByTag, 0);
});

Deno.test("executeLs excludes folders from markdown listing", async () => {
  const result = await executeLs(
    testContext(),
    {
      flags: {
        "exclude-folder": "Inbox, drafts/",
      },
      positionals: [],
    },
    {
      createVaultClient: () => ({
        files: async () => ["Inbox/a.md", "drafts/b.md", "Projects/c.md"],
      }),
    },
  );

  assertEquals(result.paths, ["Projects/c.md"]);
  assertEquals(result.excludedByFolder, 2);
});

Deno.test("executeLs normalizes folder filters using posix path rules", async () => {
  const result = await executeLs(
    testContext(),
    {
      flags: {
        "exclude-folder": ".\\Inbox\\sub/,/Templates/",
      },
      positionals: [],
    },
    {
      createVaultClient: () => ({
        files: async () => [
          "Inbox/sub/a.md",
          "Inbox/sub/deep/b.md",
          "Templates/c.md",
          "Projects/d.md",
        ],
      }),
    },
  );

  assertEquals(result.paths, ["Projects/d.md"]);
  assertEquals(result.excludedByFolder, 3);
});

Deno.test("executeLs excludes tagged notes with nested tag matching", async () => {
  const result = await executeLs(
    testContext(),
    {
      flags: {
        "exclude-tag": "idea",
      },
      positionals: [],
    },
    {
      createVaultClient: () => ({
        files: async () => ["a.md", "b.md", "c.md"],
        markdownFilesWithTags: async () => [
          { path: "a.md", tags: ["#idea"] },
          { path: "b.md", tags: ["#idea/project"] },
          { path: "c.md", tags: ["#other"] },
        ],
      }),
    },
  );

  assertEquals(result.paths, ["c.md"]);
  assertEquals(result.excludedByTag, 2);
});

Deno.test("executeLs throws when tag exclusion is requested without tag support", async () => {
  await assertRejects(
    () =>
      executeLs(
        testContext(),
        {
          flags: { "exclude-tag": "#idea" },
          positionals: [],
        },
        {
          createVaultClient: () => ({
            files: async () => ["a.md"],
          }),
        },
      ),
    Error,
    "Tag exclusions require a vault client that can read note tags.",
  );
});
