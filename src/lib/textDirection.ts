const THAANA_RE = /[\u0780-\u07BF]/;
const ARABIC_RE = /[\u0600-\u06FF]/;

/** Detect RTL text (Dhivehi Thaana, Arabic script). */
export function isRtlText(text: string): boolean {
  return THAANA_RE.test(text) || ARABIC_RE.test(text);
}

export function textDirection(text: string): "rtl" | "ltr" {
  return isRtlText(text) ? "rtl" : "ltr";
}
