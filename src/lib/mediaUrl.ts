/**
 * Normalize media URLs that were double-encoded in playlist JSON or proxy chains.
 * e.g. Wicked%2520King -> Wicked%20King
 */
export function normalizeMediaUrl(url: string): string {
  if (!url) return url;
  let out = url.trim();
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/%25([0-9A-Fa-f]{2})/gi, "%$1");
    if (next === out) break;
    out = next;
  }
  return out;
}

export function refererForMediaUrl(url: string): string {
  try {
    const host = new URL(normalizeMediaUrl(url)).hostname.toLowerCase();
    if (/ipaudio/i.test(host)) return "https://hdaudiobooks.com/";
    return `${new URL(normalizeMediaUrl(url)).origin}/`;
  } catch {
    return "https://hdaudiobooks.com/";
  }
}
