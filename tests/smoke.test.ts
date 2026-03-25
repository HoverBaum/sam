import { assertEquals, assertThrows } from "@std/assert";
import { parseArgs } from "../utils/args.ts";
import {
  INDEX_SCHEMA_VERSION,
  assertProfileMatch,
  indexManifestSummary,
  type IndexManifest,
} from "../search/index.ts";

Deno.test("parseArgs parses flags and positionals", () => {
  const parsed = parseArgs(["--dry-run", "--model=openai/gpt-4o", "index", "--vault", "Notes"]);
  assertEquals(parsed.flags["dry-run"], true);
  assertEquals(parsed.flags.model, "openai/gpt-4o");
  assertEquals(parsed.flags.vault, "Notes");
  assertEquals(parsed.positionals, ["index"]);
});

Deno.test("indexManifestSummary reports no manifest clearly", () => {
  const summary = indexManifestSummary(null);
  assertEquals(summary.indexedFiles, 0);
  assertEquals(summary.profile, "(none)");
});

Deno.test("assertProfileMatch throws on provider/model mismatch", () => {
  const manifest: IndexManifest = {
    profile: {
      provider: "ollama",
      model: "nomic-embed-text",
      dimensions: 768,
      schemaVersion: INDEX_SCHEMA_VERSION,
    },
    files: {},
  };

  assertThrows(() =>
    assertProfileMatch(
      {
        dryRun: false,
        model: "anthropic/claude-3-5-sonnet-20241022",
        embeddingProvider: "openai-compatible",
        embeddingModel: "text-embedding-3-small",
        embeddingBaseUrl: "https://api.openai.com/v1",
      },
      manifest,
    ));
});
