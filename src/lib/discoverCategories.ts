// Define all possible categories tied to their connector IDs
export const ALL_CATEGORIES = [
  { id: "hardcover-fiction",    title: "NYT: Hardcover Fiction",    query: "hardcover-fiction", source: "nyt" },
  { id: "hardcover-nonfiction", title: "NYT: Hardcover Nonfiction", query: "hardcover-nonfiction", source: "nyt" },
  { id: "paperback-nonfiction", title: "NYT: Paperback Nonfiction", query: "paperback-nonfiction", source: "nyt" },
  { id: "e-book-fiction",       title: "NYT: E-Book Fiction",       query: "e-book-fiction", source: "nyt" },
  { id: "e-book-nonfiction",    title: "NYT: E-Book Nonfiction",    query: "e-book-nonfiction", source: "nyt" },
  { id: "nyt-combined-fiction", title: "NYT: Combined Fiction", query: "combined-print-and-e-book-fiction", source: "nyt" },
  { id: "nyt-combined-nonfiction", title: "NYT: Combined Nonfiction", query: "combined-print-and-e-book-nonfiction", source: "nyt" },
  { id: "nyt-business",         title: "NYT: Business",            query: "business-books", source: "nyt" },
  { id: "advice-how-to",        title: "Advice & How-To",           query: "advice-how-to", source: "nyt" },
  { id: "childrens-middle-grade-hardcover", title: "Middle Grade", query: "childrens-middle-grade-hardcover", source: "nyt" },
  { id: "young-adult-hardcover", title: "Young Adult", query: "young-adult-hardcover", source: "nyt" },
  { id: "goodreads-weekly-blog", title: "Goodreads: Trending This Week", query: "goodreads-blog-3182-weekly", source: "goodreads" },
  { id: "goodreads-best-ever",  title: "Goodreads: Best Ever",     query: "1.Best_Books_Ever", source: "goodreads" },
  { id: "goodreads-read-once",  title: "Goodreads: Read Once",      query: "264.Books_That_Everyone_Should_Read_At_Least_Once", source: "goodreads" },
  { id: "goodreads-21st",       title: "Goodreads: 21st Century",   query: "7.Best_Books_of_the_21st_Century", source: "goodreads" },
  { id: "audiobooks-popular",   title: "Popular Audiobooks",        query: "popular", source: "audiobook", mode: "popular" },
  { id: "audiobooks-fiction",   title: "Fiction Audiobooks",        query: "fiction", source: "audiobook", mode: "search" },
  { id: "audiobooks-mystery",   title: "Mystery & Thriller Audiobooks", query: "mystery thriller", source: "audiobook", mode: "search" },
  { id: "audiobooks-scifi",     title: "Sci-Fi & Fantasy Audiobooks", query: "science fiction fantasy", source: "audiobook", mode: "search" },
  { id: "netgalley-recent-audiobooks", title: "NetGalley: Recent Audiobooks", query: "recentlyAddedAudiobooks", source: "netgalley" },
  { id: "netgalley-requested-audiobooks", title: "NetGalley: Most Requested Audiobooks", query: "mostRequestedAudiobooks", source: "netgalley" },
  { id: "netgalley-recent-drcs", title: "NetGalley: Recently Added Books", query: "recentlyAddedDRCs", source: "netgalley" },
  { id: "netgalley-requested-drcs", title: "NetGalley: Most Requested Books", query: "mostRequested", source: "netgalley" },
  { id: "netgalley-mystery", title: "NetGalley: Mystery & Thrillers", query: "16", source: "netgalley" },
  { id: "netgalley-scifi", title: "NetGalley: Sci-Fi & Fantasy", query: "22", source: "netgalley" },
  { id: "netgalley-horror", title: "NetGalley: Horror", query: "41", source: "netgalley" },
  { id: "netgalley-romance", title: "NetGalley: Romance", query: "21", source: "netgalley" },
  { id: "netgalley-fiction", title: "NetGalley: General Fiction", query: "35", source: "netgalley" },
  { id: "netgalley-ya", title: "NetGalley: Young Adult", query: "27", source: "netgalley" },
];

export function getCategoryDescription(category: { source?: string }) {
  if (category.source === "netgalley") {
    return "Official catalog listings from NetGalley. Browse digital review copies (DRCs), requested audiobooks, and genre collections.";
  }
  if (category.source === "audiobook") {
    return "Popular audiobooks from free streaming archives. Click any title for downloads and listening options.";
  }
  if (category.source === "goodreads") {
    return "Trending picks from Goodreads lists. Click any book to search and download.";
  }
  return "Top trending books currently featured on the New York Times Best Sellers list. Click any book to search and download.";
}
