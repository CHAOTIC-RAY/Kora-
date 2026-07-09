/**
 * Smart Client-side Offline Reading Companion & Analytical Helper
 */

// Simple Stop Words for scoring sentences in extractive summarization
const STOP_WORDS = new Set([
  "the", "and", "a", "of", "to", "in", "is", "that", "it", "he", "was", "for", "on", "are", "as", "with",
  "his", "they", "i", "at", "be", "this", "have", "from", "or", "one", "had", "by", "word", "but", "not",
  "what", "all", "were", "we", "when", "your", "can", "said", "there", "use", "an", "each", "which", "she",
  "do", "how", "their", "if", "will", "up", "other", "about", "out", "many", "then", "them", "these", "so"
]);

/**
 * Extracts a list of major nouns/topics from a selection of text
 */
function extractMainTopic(text: string): string {
  // Extract words, remove punctuation, filter for length and stop words
  const words = text
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()));

  if (words.length === 0) return "";
  
  // Find the most frequent word, or return the first capitalized word
  const freqMap: Record<string, number> = {};
  for (const w of words) {
    freqMap[w] = (freqMap[w] || 0) + 1;
  }
  
  const sorted = Object.entries(freqMap).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || words[0] || "";
}

/**
 * Performs a Wikipedia search summary retrieval (Free, No Keys Required!)
 */
export async function fetchWikipediaSummary(topic: string): Promise<string | null> {
  if (!topic) return null;
  try {
    const formattedTopic = topic.trim().replace(/\s+/g, "_");
    const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(formattedTopic)}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.extract || null;
  } catch (err) {
    console.warn("Wikipedia fetch failed for:", topic, err);
    return null;
  }
}

/**
 * Highly functional client-side extractive text summarizer
 */
export function summarizeTextOffline(text: string, sentenceCount = 4): string {
  // Strip HTML elements
  const cleanText = text.replace(/<[^>]*>/g, " ");
  
  // Split into sentences using punctuation markers
  const sentences = cleanText.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 10);
  if (sentences.length <= sentenceCount) {
    return sentences.join(" ");
  }

  // Tokenize and build frequency map of keywords
  const wordFreq: Record<string, number> = {};
  const words = cleanText.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/);
  
  for (const w of words) {
    if (w.length > 3 && !STOP_WORDS.has(w)) {
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    }
  }

  // Score sentences based on word frequencies
  const scoredSentences = sentences.map((sentence, idx) => {
    const sWords = sentence.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/);
    let score = 0;
    for (const sw of sWords) {
      if (wordFreq[sw]) {
        score += wordFreq[sw];
      }
    }
    // Moderate length penalty/bonus to favor informative sentences of medium length
    const lengthRatio = Math.min(1.5, sWords.length / 15);
    return { sentence, score: score * lengthRatio, index: idx };
  });

  // Sort by score and pick top sentences
  const topSentences = scoredSentences
    .sort((a, b) => b.score - a.score)
    .slice(0, sentenceCount)
    // Restore original reading order
    .sort((a, b) => a.index - b.index)
    .map(s => s.sentence);

  return topSentences.join("\n\n");
}

/**
 * Smart Local Keyword & Semantic Answer engine for the book context
 */
export function answerQuestionOffline(query: string, text: string, bookTitle: string): string {
  const lowerQuery = query.toLowerCase();
  const cleanText = text.replace(/<[^>]*>/g, " ");
  const sentences = cleanText.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 1);

  // Extract keywords from user query
  const queryKeywords = lowerQuery
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));

  if (queryKeywords.length === 0) {
    return `### Companion Search Index\n\nWe scanned the active passages for your query, but could not identify strong keywords. Try searching for specific names, objects, or terms (e.g. "thrones", "battle", "sword").`;
  }

  // Search sentences for matches
  const matches = sentences.map((sentence, idx) => {
    const lowerSentence = sentence.toLowerCase();
    let hits = 0;
    for (const kw of queryKeywords) {
      if (lowerSentence.includes(kw)) {
        hits += 1;
      }
    }
    return { sentence, hits, index: idx };
  }).filter(m => m.hits > 0);

  if (matches.length === 0) {
    return `### Companion Index Search\n\nWe scanned the active chapter of **${bookTitle}** for the key concepts: *[${queryKeywords.join(", ")}]* but no exact matching segments were located.\n\nTry checking another chapter, or drafting a general note about this concept!`;
  }

  // Sort matches by hits, then return top 3
  const topMatches = matches
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 3)
    .sort((a, b) => a.index - b.index);

  let result = `### 🔍 Smart Companion Index results for: "${queryKeywords.join(", ")}"\n\n`;
  topMatches.forEach((m, idx) => {
    result += `${idx + 1}. "... ${m.sentence} ..."\n\n`;
  });

  return result;
}

/**
 * Main Orchestrator for the companion reading helper
 */
export async function runOfflineCompanion(mode: string, selectedText: string, fullContextText: string, bookTitle: string, query = ""): Promise<string> {
  const textToAnalyze = selectedText || fullContextText || "";
  
  if (mode === "explain") {
    // 1. Extract the main topic
    const topic = extractMainTopic(textToAnalyze);
    if (!topic) {
      return "Unable to identify a primary keyword or concept from this passage. Please highlight a word or phrase with more detail!";
    }

    // 2. Query Wikipedia rest API for a real background explanation
    const wikiResult = await fetchWikipediaSummary(topic);
    if (wikiResult) {
      return `### Background Knowledge: ${topic}\n\n${wikiResult}\n\n*(Sourced dynamically and safely from Wikipedia encyclopedia)*`;
    }

    // Fallback: Smart grammatical analysis/definition
    return `### Term Analysis: "${topic}"\n\nThis key terminology is featured in **${bookTitle}**. In literary contexts, it refers to a significant theme, focal entity, or descriptive element of the narrative environment.\n\n*Tip: Connect to a network to load dynamic real-time definitions and wiki articles!*`;
  }

  if (mode === "summarize") {
    const summary = summarizeTextOffline(textToAnalyze);
    return `### 📝 Key Extracted Concepts\n\nHere are the most significant sentences extracted from the selected content:\n\n${summary}`;
  }

  if (mode === "chat") {
    return answerQuestionOffline(query || "", fullContextText, bookTitle);
  }

  return "Unsupported offline assistant action mode.";
}
