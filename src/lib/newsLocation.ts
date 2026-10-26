import { resolveApiUrl } from "./capacitorNative";
import { countryName } from "./countryFeeds";

/** Detect the request's country at the edge, falling back to the device locale. */
export async function detectNewsCountry(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(resolveApiUrl("/api/news/location"), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (response.ok) {
      const data = await response.json() as { country?: unknown };
      const code = typeof data.country === "string" ? data.country.trim().toUpperCase() : "";
      if (countryName(code)) return code;
    }
  } catch {
    // Local/dev servers may not have edge geolocation; use the device locale below.
  } finally {
    clearTimeout(timeout);
  }

  const locales = typeof navigator === "undefined"
    ? []
    : [navigator.language, ...(navigator.languages || [])];
  for (const locale of locales) {
    const code = locale?.match(/[-_]([A-Za-z]{2})$/)?.[1]?.toUpperCase() || "";
    if (countryName(code)) return code;
  }
  return "";
}
