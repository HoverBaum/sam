import { assertEquals } from "@std/assert";
import {
  buildBacklinksReport,
  extractLinkContext,
  formatBacklinksLines,
} from "../commands/backlinks.ts";
import type { CommandContext } from "../types.ts";

function testContext(): CommandContext {
  return {
    config: {
      dryRun: false,
      vault: "Notes",
      model: "anthropic/claude-3-5-sonnet-20241022",
      embeddingProvider: "ollama",
      embeddingModel: "nomic-embed-text",
      embeddingBaseUrl: "http://127.0.0.1:11434",
    },
    cwd: Deno.cwd(),
  };
}

Deno.test("extractLinkContext returns paragraph containing link", () => {
  const content = [
    "# Intro",
    "",
    "Before we link to [[Project Alpha]] from this paragraph with extra details.",
    "",
    "## Next",
    "",
    "Other text.",
  ].join("\n");
  assertEquals(
    extractLinkContext(content, "Project Alpha.md"),
    "Before we link to [[Project Alpha]] from this paragraph with extra details.",
  );
});

Deno.test("extractLinkContext falls back to nearest heading", () => {
  const content = [
    "# Links",
    "",
    "## [[Project Alpha]]",
    "",
    "Body text below heading.",
  ].join("\n");
  assertEquals(
    extractLinkContext(content, "Project Alpha.md"),
    "Heading: Project Alpha",
  );
});

Deno.test("buildBacklinksReport aggregates links and adds context", async () => {
  const report = await buildBacklinksReport(testContext(), "Project Alpha.md", {
    includeContext: true,
    createVaultClient: () => ({
      links: async () => [
        { path: "Roadmap.md", count: 2 },
        { path: "Roadmap.md" },
        { path: "Specs/Deep Dive.md" },
      ],
      backlinks: async () => [
        { sourcePath: "Inbox.md" },
        { sourcePath: "Inbox.md", count: 2 },
        { sourcePath: "Team/Weekly.md" },
      ],
      read: async (path: string) => {
        if (path === "Project Alpha.md") {
          return [
            "# Plan",
            "",
            "See [[Roadmap]] and [[Specs/Deep Dive]] for details.",
          ].join("\n");
        }
        if (path === "Inbox.md") {
          return "We should revisit [[Project Alpha]] tomorrow.";
        }
        return [
          "# Weekly status",
          "",
          "## Mentions",
          "",
          "- [[Project Alpha]]",
        ].join("\n");
      },
    }),
  });

  assertEquals(report.sourcePath, "Project Alpha.md");
  assertEquals(report.outgoing, [
    {
      path: "Roadmap.md",
      count: 3,
      context: "See [[Roadmap]] and [[Specs/Deep Dive]] for details.",
    },
    {
      path: "Specs/Deep Dive.md",
      count: 1,
      context: "See [[Roadmap]] and [[Specs/Deep Dive]] for details.",
    },
  ]);
  assertEquals(report.incoming, [
    {
      path: "Inbox.md",
      count: 3,
      context: "We should revisit [[Project Alpha]] tomorrow.",
    },
    {
      path: "Team/Weekly.md",
      count: 1,
      context: "Heading: Mentions",
    },
  ]);
});

Deno.test("formatBacklinksLines prints both directions", () => {
  const lines = formatBacklinksLines({
    sourcePath: "Notes/Alpha.md",
    includeContext: true,
    outgoing: [{ path: "Notes/Beta.md", count: 1, context: "Heading: Related" }],
    incoming: [],
  });

  assertEquals(lines, [
    "Backlinks for Notes/Alpha.md",
    "Links from this note (1):",
    "- Notes/Beta.md",
    "  context: Heading: Related",
    "Links to this note (0):",
    "(none)",
  ]);
});
