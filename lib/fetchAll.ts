// Supabase returns at most 1000 rows per request by default. Survivor
// can easily pass that (50 teams x 25 scans = 1250), and a silently cut
// list would make the leaderboard and exports wrong without any error.
// This keeps asking for the next page until everything has arrived.
//
// `build` must return a fresh query each time, with a stable .order(...)
// so pages don't overlap or skip rows.

const PAGE = 1000;

export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Splits a long list of ids so `.in()` filters stay within URL limits. */
export function chunk<T>(list: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
