// Convert a fragment of Kora chapter HTML into Markdown.
// Intentionally minimal: headings, blockquote, lists, paragraphs, line breaks.

export function htmlToMarkdown(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html || "";

  // Work on a serialized copy so we don't mutate the live DOM.
  let md = div.innerHTML;

  // Block elements first.
  md = md
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n")
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
      const cleaned = (inner as string)
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .trim();
      return cleaned.split("\n").map((l) => `> ${l}`).join("\n") + "\n\n";
    })
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<(p|div)[^>]*>([\s\S]*?)<\/\1>/gi, "$2\n\n")
    .replace(/<br\s*\/?>/gi, "\n");

  // Strip any remaining tags.
  md = md.replace(/<[^>]+>/g, "");

  // Unescape common entities.
  md = md
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Collapse 3+ newlines into a double newline.
  md = md.replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return md;
}

/** Build a full Markdown document from all chapters. */
export function chaptersToMarkdown(
  title: string,
  author: string,
  chapters: { title: string; html: string }[]
): string {
  const head = `# ${title}\n\n${author ? `*by ${author}*\n\n` : ""}`;
  const body = chapters
    .map((c) => {
      const h = c.title ? `## ${c.title}\n\n` : "";
      return h + htmlToMarkdown(c.html);
    })
    .join("\n");
  return head + body;
}
