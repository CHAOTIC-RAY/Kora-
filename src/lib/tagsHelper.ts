/**
 * Smart metadata and tag inference helper for ebooks
 */

export function inferBookTags(title: string, author: string, extension: string): string[] {
  const tagsSet = new Set<string>();
  const lowerTitle = title.toLowerCase();
  const lowerAuthor = author.toLowerCase();

  // Add default format tag
  if (extension.toLowerCase() === "pdf") {
    tagsSet.add("PDF");
  } else if (extension.toLowerCase() === "epub" || extension.toLowerCase() === "epub3") {
    tagsSet.add("Ebook");
  }

  // Fiction / Fantasy / Sci-Fi
  const fictionKeywords = [
    "novel", "fiction", "fantasy", "thrones", "dragon", "witcher", "tolkien", "potter", 
    "magic", "shadow", "star wars", "chronicles", "hobbit", "legend", "sword", "king", 
    "queen", "empire", "revolution", "dark", "blood", "beast", "glass", "dune", "asimov", 
    "cyberpunk", "huxley", "orwell", "adventure", "story", "tales", "dracula", "frankenstein"
  ];
  if (fictionKeywords.some(kw => lowerTitle.includes(kw) || lowerAuthor.includes(kw))) {
    tagsSet.add("Fiction");
    if (lowerTitle.includes("thrones") || lowerTitle.includes("dragon") || lowerTitle.includes("magic") || lowerTitle.includes("witcher")) {
      tagsSet.add("Fantasy");
    }
    if (lowerTitle.includes("star wars") || lowerTitle.includes("dune") || lowerTitle.includes("cyberpunk") || lowerTitle.includes("asimov")) {
      tagsSet.add("Sci-Fi");
    }
  }

  // Technology / Programming / Development
  const techKeywords = [
    "science", "physics", "math", "calculus", "algebra", "chemistry", "biology", "design", 
    "programming", "react", "javascript", "typescript", "python", "data science", "neural", 
    "learning", "ai", "coding", "software", "development", "database", "sql", "guide", 
    "tutorial", "handbook", "manual", "engineering", "machine", "algorithm", "developer", "computer"
  ];
  if (techKeywords.some(kw => lowerTitle.includes(kw))) {
    tagsSet.add("Non-Fiction");
    tagsSet.add("Technology");
    if (lowerTitle.includes("programming") || lowerTitle.includes("javascript") || lowerTitle.includes("typescript") || lowerTitle.includes("python") || lowerTitle.includes("coding") || lowerTitle.includes("software")) {
      tagsSet.add("Programming");
    }
  }

  // History / Politics / Society
  const historyKeywords = [
    "history", "war", "century", "world war", "civilization", "politic", "democracy", 
    "president", "roman", "greece", "ancient", "medieval", "sociology", "economy", "capital"
  ];
  if (historyKeywords.some(kw => lowerTitle.includes(kw))) {
    tagsSet.add("Non-Fiction");
    tagsSet.add("History");
  }

  // Biography / Memoir
  const bioKeywords = ["biography", "memoir", "autobiography", "life of", "diary"];
  if (bioKeywords.some(kw => lowerTitle.includes(kw))) {
    tagsSet.add("Non-Fiction");
    tagsSet.add("Biography");
  }

  // Classic / Literature / Philosophy
  const classicKeywords = [
    "classic", "shakespeare", "homer", "iliad", "odyssey", "plato", "aristotle", "dickens", 
    "austen", "dostoyevsky", "tolstoy", "literature", "poetry", "poem", "philosophy", "socrates", "nietzsche"
  ];
  if (classicKeywords.some(kw => lowerTitle.includes(kw) || lowerAuthor.includes(kw))) {
    tagsSet.add("Classic");
    tagsSet.add("Literature");
    if (lowerTitle.includes("philosophy") || lowerTitle.includes("plato") || lowerTitle.includes("nietzsche") || lowerTitle.includes("aristotle")) {
      tagsSet.add("Philosophy");
    }
  }

  // Fallbacks if no tags generated
  if (tagsSet.size <= 1) {
    if (lowerTitle.includes("the") || lowerTitle.includes("of") || lowerTitle.includes("and")) {
      tagsSet.add("Fiction");
    } else {
      tagsSet.add("Research");
    }
  }

  return Array.from(tagsSet);
}
