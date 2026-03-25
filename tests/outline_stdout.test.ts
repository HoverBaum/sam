import { assertEquals } from "@std/assert";
import { parseOutlineStdout } from "../vault/client.ts";

Deno.test("parseOutlineStdout treats 'No headings found' as empty outline", () => {
  assertEquals(parseOutlineStdout("No headings found"), []);
  assertEquals(parseOutlineStdout("no headings found"), []);
});

Deno.test("parseOutlineStdout parses minimal outline JSON", () => {
  const json = JSON.stringify([
    {
      title: "Intro",
      level: 1,
      children: [{ title: "Details", level: 2, children: [] }],
    },
  ]);

  assertEquals(parseOutlineStdout(json), [
    {
      title: "Intro",
      level: 1,
      children: [{ title: "Details", level: 2, children: [] }],
    },
  ]);
});

