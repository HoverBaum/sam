import { assertEquals } from "@std/assert";
import { extractSectionChunks } from "../search/sections.ts";
import { parseOutlineNodes } from "../vault/client.ts";

Deno.test("parseOutlineNodes reads nested outline payloads", () => {
  const outline = parseOutlineNodes({
    headings: [
      {
        title: "Intro",
        level: 1,
        children: [
          { heading: "Details", depth: 2 },
        ],
      },
      {
        name: "Wrap Up",
        headingLevel: 1,
        items: [],
      },
    ],
  });

  assertEquals(outline, [
    {
      title: "Intro",
      level: 1,
      children: [{ title: "Details", level: 2, children: [] }],
    },
    {
      title: "Wrap Up",
      level: 1,
      children: [],
    },
  ]);
});

Deno.test("extractSectionChunks uses outline hierarchy for nested paths", () => {
  const content = [
    "# Intro",
    "",
    "This introduction has enough body text to be emitted as a section.",
    "",
    "## Details",
    "",
    "This details section also has enough text to survive the minimum-length filter.",
    "",
    "# Wrap Up",
    "",
    "This wrap up text is also comfortably above the threshold for indexing.",
  ].join("\n");

  const sections = extractSectionChunks(content, [
    {
      title: "Intro",
      level: 1,
      children: [{ title: "Details", level: 2, children: [] }],
    },
    {
      title: "Wrap Up",
      level: 1,
      children: [],
    },
  ]);

  assertEquals(sections.map((section) => section.path), [
    "Intro",
    "Intro > Details",
    "Wrap Up",
  ]);
  assertEquals(sections.map((section) => section.slug), [
    "intro",
    "intro-details",
    "wrap-up",
  ]);
});
