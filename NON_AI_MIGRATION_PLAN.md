# Non-AI Migration Plan

## Overview
Replace Gemini API dependencies with deterministic, rule-based alternatives for all AI-powered features.

## Feature 1: Web Clipper (`/api/convert-url`)

### Current Implementation
- Uses `gemini-3.5-flash` to parse web content, remove ads/clutter, and organize into chapters
- AI extracts title, author, description, and structured chapters

### Non-AI Alternative
**Use Readability.js + HTML parsing libraries**

**Libraries needed:**
- `@mozilla/readability` - Extract article content from web pages
- `jsdom` - DOM manipulation in Node.js
- `turndown` - Convert HTML to Markdown

**Implementation approach:**
1. Fetch HTML from target URL
2. Use Readability.js to extract main article content
3. Parse metadata (title, author) from HTML meta tags
4. Split content into sections using `<h2>`, `<h3>` tags as chapter boundaries
5. Convert to clean Markdown format
6. Generate description from first paragraph

**Pros:**
- Deterministic, consistent results
- No API costs
- Faster response times
- Works offline

**Cons:**
- Less sophisticated content organization
- May not handle complex page structures as well

---

## Feature 2: Oxford Dictionary (`/api/oxford-dictionary`)

### Current Implementation
- Uses `gemini-2.0-flash-exp` to generate OED-style dictionary entries
- AI generates phonetic spelling, etymology, definitions, examples

### Non-AI Alternative
**DEPRECATE THIS ENDPOINT** - The app already has a built-in dictionary system:

**Existing solution:**
- **`src/lib/dictionary.ts`** - Client-side dictionary with StarDict support
- **`dict-en-en/`** - StarDict files (795,912 words from Wiktionary)
- **`parse-stardict.js/ts`** - Parser to convert StarDict to JSON
- Can load 50,000 entries from `dictionary-data.json`
- Supports custom user additions via localStorage

**Action:**
- Remove `/api/oxford-dictionary` endpoint entirely
- The built-in dictionary already provides word lookup functionality
- No need for AI-generated OED entries

---

## Feature 3: NYT Book Details (`/api/nyt/book-details`)

### Current Implementation
- Uses `gemini-2.0-flash-exp` to generate comprehensive NYT-style book details
- AI generates bestseller history, reviews, summaries, subjects

### Non-AI Alternative
**Use Open Library API + Google Books API**

**APIs to use:**
1. **Open Library API** - https://openlibrary.org/api/books
2. **Google Books API** - https://books.google.com/books?bibkeys=ISBN:...
3. **Goodreads API** (requires API key) or scrape Goodreads

**Implementation approach:**
1. Search Open Library by title/author
2. Search Google Books by title/author
3. Combine results: description, page count, publication date, subjects
4. Extract reviews from Google Books/Goodreads
5. Format response to mimic NYT structure
6. Use NYT Books API for actual bestseller data (if available)

**Pros:**
- Real book data from authoritative sources
- No AI generation needed
- Free APIs available

**Cons:**
- NYT-specific data (bestseller rankings) may be limited without NYT API
- Less polished than AI-generated content
- May not have all books

---

## Implementation Steps

### Phase 1: Research & Setup
1. Install required npm packages:
   ```bash
   npm install @mozilla/readability jsdom turndown axios cheerio
   ```
2. Test each alternative API/service
3. Document API rate limits and requirements

### Phase 2: Web Clipper Migration
1. Create new endpoint `/api/convert-url-non-ai`
2. Implement Readability.js extraction
3. Add chapter detection logic
4. Test with various URLs
5. Replace existing endpoint

### Phase 3: Dictionary Migration
1. Remove `/api/oxford-dictionary` endpoint from server.ts
2. Update any frontend code that calls this endpoint to use built-in dictionary
3. Verify built-in dictionary is working correctly

### Phase 4: Book Details Migration
1. Create new endpoint `/api/nyt/book-details-non-ai`
2. Implement Open Library + Google Books integration
3. Add NYT API integration for bestseller data
4. Test with various books
5. Replace existing endpoint

### Phase 5: Cleanup (Server-side)
1. Remove `@google/generative-ai` dependency from package.json
2. Remove `getGeminiClient()` function from server.ts
3. Remove `GEMINI_API_KEY` from .env.example
4. Remove `/api/oxford-dictionary` endpoint
5. Update metadata.json to remove Gemini capability

### Phase 6: Optional AI Features (Client-side)
1. Add settings panel in SettingsView.tsx for user API key input
2. Store user's Gemini API key in localStorage (encrypted if possible)
3. Create client-side AI service that uses user's key when available
4. Add "Enhanced with AI" toggle for features like:
   - Enhanced dictionary lookup (etymology, more examples)
   - Enhanced book details (better summaries, reviews)
5. AI features only activate when user provides key + enables toggle
6. Show clear UI indicators when AI is being used

---

## Dependencies to Remove (Server-side)
- `@google/generative-ai` from server dependencies (move to client-side only)

## Dependencies to Add
- `@mozilla/readability` - Article content extraction
- `jsdom` - DOM manipulation
- `turndown` - HTML to Markdown conversion
- `axios` - HTTP requests (if not already present)
- `cheerio` - HTML parsing (if not already present)
- `@google/generative-ai` - Keep for client-side optional AI features (user-provided key)

---

## Testing Strategy
1. Test each endpoint with 10+ diverse inputs
2. Compare output quality with AI version
3. Verify error handling for missing data
4. Check performance improvements
5. Validate edge cases (missing content, API failures)

---

## Rollback Plan
**No AI fallback** - Remove all AI dependencies completely. Instead, make AI features **fully optional** via user settings:

**Settings-based AI approach:**
- Add a settings panel where users can optionally enter their own Gemini API key
- AI features (enhanced dictionary, better book details) only activate when user provides API key
- App works fully without any AI - all core features use non-AI implementations
- Users who want AI enhancements can opt-in by providing their own key
- No server-side AI dependencies or environment variables needed

**Benefits:**
- Zero AI costs for the app/developer
- Privacy-focused (users control their own API key)
- App works offline without AI
- Optional AI enhancements for power users
