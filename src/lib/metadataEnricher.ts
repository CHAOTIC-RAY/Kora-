import { BookMetadata, syncBookToCloud } from "./firebase";

/**
 * Enriches a book's metadata using the Google Books API.
 * 
 * @param userId The user's ID for cloud sync
 * @param book The book metadata object to enrich
 * @returns A new book metadata object with enriched details
 */
export async function enrichBookMetadata(userId: string, book: BookMetadata): Promise<BookMetadata> {
  console.log(`[MetadataEnricher] Enriching book: "${book.title}" by "${book.author}"`);
  
  try {
    // Clean up title for better search (remove extension, etc. if present in title)
    const cleanTitle = book.title.replace(/\.[^/.]+$/, "").trim();
    const query = encodeURIComponent(`intitle:${cleanTitle} inauthor:${book.author}`);
    
    const response = await fetch(`/api/google-books/search?q=${query}&maxResults=1`);
    if (!response.ok) {
      console.warn(`[MetadataEnricher] Google Books search failed for "${book.title}"`);
      return book;
    }
    
    const data = await response.json();
    const googleBook = data.items?.[0]?.volumeInfo;
    
    if (!googleBook) {
      console.log(`[MetadataEnricher] No matching book found on Google Books for "${book.title}"`);
      return book;
    }
    
    // Create a copy of the book to update
    const enrichedBook: BookMetadata = { ...book };
    
    // 1. Fix Metadata and Book Details
    if (googleBook.description && !enrichedBook.description) {
      enrichedBook.description = googleBook.description;
    }
    
    if (googleBook.publisher && !enrichedBook.publisher) {
      enrichedBook.publisher = googleBook.publisher;
    }
    
    if (googleBook.publishedDate && !enrichedBook.year) {
      // Extract year from YYYY-MM-DD
      enrichedBook.year = googleBook.publishedDate.split("-")[0];
    }
    
    if (googleBook.pageCount && !enrichedBook.progress.totalPages) {
      enrichedBook.progress.totalPages = googleBook.pageCount;
    }

    // Update language if it's default and we found a more specific one
    if (googleBook.language && (enrichedBook.language === "English" || !enrichedBook.language)) {
      // Convert language codes to names if needed, but keeping them as is for now
      enrichedBook.language = googleBook.language;
    }
    
    // 2. Find Book Cover if missing
    const hasPlaceholderCover = !enrichedBook.coverUrl || 
                                enrichedBook.coverUrl.includes("placeholder") || 
                                enrichedBook.coverUrl.includes("cover-redirect");
                                
    if (hasPlaceholderCover && googleBook.imageLinks?.thumbnail) {
      // Upgrade to high quality if possible by using the proxy (proxy handles -M to -L upgrade)
      enrichedBook.coverUrl = googleBook.imageLinks.thumbnail.replace("http:", "https:");
      console.log(`[MetadataEnricher] Updated cover for "${book.title}"`);
    }
    
    // 3. Fix Genre Tags and other tags
    if (googleBook.categories && googleBook.categories.length > 0) {
      const newTags = new Set(enrichedBook.tags);
      
      googleBook.categories.forEach((cat: string) => {
        // Categories from Google Books are often multi-layered like "Fiction / Science Fiction / Space Opera"
        // We split them and add as individual tags
        const splitTags = cat.split("/").map(s => s.trim());
        splitTags.forEach(t => {
          if (t && t.length > 1) {
            newTags.add(t);
          }
        });
      });
      
      enrichedBook.tags = Array.from(newTags);
      console.log(`[MetadataEnricher] Updated tags for "${book.title}": ${enrichedBook.tags.join(", ")}`);
    }
    
    // Final sync to cloud if changed
    if (JSON.stringify(enrichedBook) !== JSON.stringify(book)) {
      enrichedBook.dateModified = Date.now();
      await syncBookToCloud(userId, enrichedBook);
      console.log(`[MetadataEnricher] Successfully enriched and synced "${book.title}"`);
      return enrichedBook;
    }
    
  } catch (error) {
    console.error(`[MetadataEnricher] Error enriching book "${book.title}":`, error);
  }
  
  return book;
}
