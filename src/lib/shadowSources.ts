/**
 * Temporary safe fallback for the optional shadow-source search adapter.
 *
 * The worker already falls back to the independent book-search providers when
 * this adapter returns no results. Keep the API shape stable so deployments
 * can build while the original adapter implementation is restored.
 */
export async function searchShadowBooks(
  _query: string,
  _mode: string,
  _source: string,
  _page: number,
  _env: unknown,
  _headers: Record<string, string> = {}
): Promise<{ results: any[]; meta: Record<string, any> }> {
  return { results: [], meta: {} };
}
