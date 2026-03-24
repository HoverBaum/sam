import { assertEquals, assertRejects } from "@std/assert";
import { mapLimit } from "../utils/concurrency.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.test("mapLimit preserves result order", async () => {
  const results = await mapLimit(["a", "b", "c", "d"], 2, async (item, index) => {
    await delay((4 - index) * 5);
    return `${item}${index}`;
  });
  assertEquals(results, ["a0", "b1", "c2", "d3"]);
});

Deno.test("mapLimit never exceeds concurrency limit", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 12 }, (_, i) => i);

  await mapLimit(items, 3, async (n) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await delay(5);
    inFlight -= 1;
    return n * 2;
  });

  assertEquals(maxInFlight, 3);
});

Deno.test("mapLimit treats limit below 1 as 1", async () => {
  let maxInFlight = 0;
  let inFlight = 0;
  await mapLimit([1, 2, 3], 0, async (n) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await delay(1);
    inFlight -= 1;
    return n;
  });
  assertEquals(maxInFlight, 1);
});

Deno.test("mapLimit propagates rejection", async () => {
  await assertRejects(
    () =>
      mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    Error,
    "boom",
  );
});

Deno.test("mapLimit empty array", async () => {
  const results = await mapLimit([], 5, async () => 1);
  assertEquals(results, []);
});
