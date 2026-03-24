import { assertEquals } from "@std/assert";
import { estimateEtaSeconds, formatEta } from "../ui/IndexProgressLine.tsx";

Deno.test("estimateEtaSeconds returns null without enough progress", () => {
  assertEquals(estimateEtaSeconds(0, 10, Date.now() - 1000, Date.now()), null);
  assertEquals(estimateEtaSeconds(10, 10, Date.now() - 1000, Date.now()), null);
  assertEquals(estimateEtaSeconds(2, 10, undefined, Date.now()), null);
});

Deno.test("estimateEtaSeconds projects remaining time from throughput", () => {
  const startedAt = 1_000;
  const now = 5_000;
  assertEquals(estimateEtaSeconds(4, 8, startedAt, now), 4);
});

Deno.test("formatEta formats short and minute durations", () => {
  assertEquals(formatEta(4.2), "5s");
  assertEquals(formatEta(65), "1m 05s");
});
