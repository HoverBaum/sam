/**
 * Maps over `items` with at most `limit` concurrent invocations of `fn`.
 * Results are in the same order as `items` (like Promise.all).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const cap = Math.max(1, Math.floor(limit));
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Math.min(cap, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
