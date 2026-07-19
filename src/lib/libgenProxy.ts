export const LIBGEN_MIRRORS = [
  "https://libgen.li",
  "https://libgen.be",
  "https://libgen.lc",
  "https://libgen.gs",
  "https://libgen.st",
  "https://libgen.rocks",
];

export function extractLibgenMd5Key(url: string): { md5: string; key?: string } | null {
  const md5Match = url.match(/md5=([a-fA-F0-9]{32})/i);
  if (!md5Match) return null;
  const keyMatch = url.match(/(?:^|[?&])key=([^&]+)/i);
  return {
    md5: md5Match[1].toLowerCase(),
    key: keyMatch?.[1],
  };
}

export function buildLibgenDownloadUrl(mirror: string, md5: string, key?: string): string {
  const base = mirror.replace(/\/$/, "");
  const query = key
    ? `get.php?md5=${md5}&key=${key}`
    : `get.php?md5=${md5}`;
  return `${base}/${query}`;
}

export function libgenMirrorCandidates(url: string): string[] {
  const parsed = extractLibgenMd5Key(url);
  if (!parsed) return [url];

  const candidates = new Set<string>();
  candidates.add(url);

  for (const mirror of LIBGEN_MIRRORS) {
    candidates.add(buildLibgenDownloadUrl(mirror, parsed.md5, parsed.key));
    if (!parsed.key) {
      candidates.add(buildLibgenDownloadUrl(mirror, parsed.md5));
    }
  }

  if (url.startsWith("https://")) {
    candidates.add(url.replace(/^https:\/\//i, "http://"));
  }

  return Array.from(candidates);
}

export function isLibgenUrl(url: string): boolean {
  return /libgen\.|library\.lol/i.test(url) || /get\.php\?md5=/i.test(url);
}

function signedUrlFromLibgenHtml(html: string, pageUrl: string): string | null {
  const m = html.match(/get\.php\?md5=[a-f0-9]+&key=[A-Za-z0-9]+/i);
  if (!m) return null;
  try {
    const parsed = new URL(pageUrl);
    return `${parsed.protocol}//${parsed.host}/${m[0]}`;
  } catch {
    return null;
  }
}

export async function fetchBinaryWithLibgenMirrors(
  url: string,
  headers: Record<string, string>
): Promise<Response> {
  const candidates = isLibgenUrl(url) ? libgenMirrorCandidates(url) : [url];
  let lastStatus = 0;
  let lastError = "";

  for (const candidate of candidates) {
    const attempts = candidate.startsWith("https://")
      ? [candidate, candidate.replace(/^https:\/\//i, "http://")]
      : [candidate];

    for (const attemptUrl of attempts) {
      try {
        const response = await fetch(attemptUrl, {
          headers: {
            ...headers,
            Referer: `${new URL(attemptUrl).origin}/`,
          },
          redirect: "follow",
          signal: AbortSignal.timeout(18000),
        });
        lastStatus = response.status;
        if (!response.ok) continue;

        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        // Unsigned get.php often returns an HTML interstitial with the signed CDN link.
        if (contentType.includes("text/html")) {
          const html = await response.text();
          const signed = signedUrlFromLibgenHtml(html, attemptUrl);
          if (!signed) continue;
          const bin = await fetch(signed, {
            headers: {
              ...headers,
              Referer: `${new URL(signed).origin}/`,
              Accept: "application/octet-stream,application/epub+zip,application/pdf,*/*",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(30000),
          });
          lastStatus = bin.status;
          if (!bin.ok) continue;
          const binType = (bin.headers.get("content-type") || "").toLowerCase();
          if (binType.includes("text/html")) continue;
          return bin;
        }
        return response;
      } catch (err: any) {
        lastError = err?.message || String(err);
      }
    }
  }

  throw new Error(
    lastStatus === 403
      ? "Access Forbidden (403) by mirror host. Try another mirror from download options."
      : `All libgen mirrors failed${lastStatus ? ` (last status ${lastStatus})` : ""}${lastError ? `: ${lastError}` : "."}`
  );
}
