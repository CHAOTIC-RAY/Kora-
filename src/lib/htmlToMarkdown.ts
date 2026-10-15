export interface ChapterInput {
  title: string;
  html: string;
}

export function htmlToMarkdown(html: string): string {
  if (!html) return "";

  let md = html;
  
  // Clean scripts & styles
  md = md.replace(/<script[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");

  // Bold & Italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, "**$2**");
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, "*$2*");

  // Paragraphs & Line Breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");

  // Lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n* $1");

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  md = md
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Normalize excessive blank lines
  return md.replace(/\n{3,}/g, "\n\n").trim();
}

export function chaptersToMarkdown(title: string, author: string, chapters: ChapterInput[]): string {
  let result = `# ${title || "Untitled"}\n`;
  if (author) {
    result += `**Author:** ${author}\n\n`;
  }
  result += `---\n\n`;

  chapters.forEach((ch, idx) => {
    result += `## ${ch.title || `Chapter ${idx + 1}`}\n\n`;
    result += `${htmlToMarkdown(ch.html)}\n\n---\n\n`;
  });

  return result.trim();
}
