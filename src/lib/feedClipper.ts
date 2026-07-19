import { BookMetadata, syncBookToCloud } from "./firebase";
import { storeBookFile } from "../db/indexedDB";

export async function clipUrlToLibrary(opts: {
  url: string;
  userId?: string;
  tags?: string[];
  sourceLabel?: string;
}): Promise<BookMetadata> {
  const response = await fetch("/api/convert-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: opts.url.trim() }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP error ${response.status}`);
  }

  const data = await response.json();
  const bookId = `clipper-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const sizeStr = `${(data.htmlContent.length / 1024).toFixed(1)} KB`;
  const hostname = (() => {
    try {
      return new URL(opts.url).hostname;
    } catch {
      return "web";
    }
  })();

  const newBook: BookMetadata = {
    id: bookId,
    title: data.title || "Clipped Article",
    author: data.author || opts.sourceLabel || hostname,
    extension: "html",
    size: sizeStr,
    tags: opts.tags || ["Clipped", "Web"],
    status: "to-read",
    progress: {
      percent: 0,
      lastReadTime: Date.now(),
    },
    dateAdded: Date.now(),
    description: data.description || `Clipped from ${hostname}`,
    source: "feed-clipper",
  };

  const blob = new Blob([data.htmlContent], { type: "text/html" });
  await storeBookFile(bookId, blob, `${newBook.title}.html`, "html");
  await syncBookToCloud(opts.userId || "", newBook);
  return newBook;
}
