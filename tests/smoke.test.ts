import { assertEquals } from "@std/assert";
import { parseArgs } from "../utils/args.ts";

Deno.test("parseArgs parses flags and positionals", () => {
  const parsed = parseArgs(["--dry-run", "--model=openai/gpt-4o", "index", "--vault", "Notes"]);
  assertEquals(parsed.flags["dry-run"], true);
  assertEquals(parsed.flags.model, "openai/gpt-4o");
  assertEquals(parsed.flags.vault, "Notes");
  assertEquals(parsed.positionals, ["index"]);
});

