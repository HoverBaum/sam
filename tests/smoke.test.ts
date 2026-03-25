import { assertEquals, assertThrows } from "@std/assert";
import { parseArgs } from "../utils/args.ts";
import {
  normalizeSettingsField,
  parseShellCommand,
  settingsFieldPath,
} from "../ui/shellRouting.ts";
import {
  assertProfileMatch,
  INDEX_SCHEMA_VERSION,
  type IndexManifest,
  indexManifestSummary,
} from "../search/index.ts";

Deno.test("parseArgs parses flags and positionals", () => {
  const parsed = parseArgs([
    "--dry-run",
    "--model=openai/gpt-4o",
    "index",
    "--vault",
    "Notes",
  ]);
  assertEquals(parsed.flags["dry-run"], true);
  assertEquals(parsed.flags.model, "openai/gpt-4o");
  assertEquals(parsed.flags.vault, "Notes");
  assertEquals(parsed.positionals, ["index"]);
});

Deno.test("parseShellCommand canonicalizes shell navigation commands", () => {
  assertEquals(parseShellCommand("/connect"), {
    kind: "navigate",
    path: "/connect",
  });
  assertEquals(parseShellCommand("/settings"), {
    kind: "navigate",
    path: "/config",
  });
  assertEquals(parseShellCommand("/home"), { kind: "navigate", path: "/" });
  assertEquals(parseShellCommand("help"), { kind: "help" });
  assertEquals(parseShellCommand(""), { kind: "noop" });
});

Deno.test("settings route helpers normalize field names", () => {
  assertEquals(normalizeSettingsField("model"), "model");
  assertEquals(normalizeSettingsField("nope"), null);
  assertEquals(settingsFieldPath("embeddingModel"), "/config/embeddingModel");
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
    )
  );
});
