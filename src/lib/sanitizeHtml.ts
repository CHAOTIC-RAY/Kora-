import DOMPurify from "dompurify";

/** Sanitize untrusted HTML from third-party APIs before `dangerouslySetInnerHTML`. */
export function sanitizeRichHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
