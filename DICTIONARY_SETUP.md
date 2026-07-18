# Dictionary Setup Instructions

## Overview
This project now supports loading a comprehensive English dictionary from the ebook-reader-dict project (Wiktionary-based).

## Files Downloaded
- `dict-en-en.zip` - Downloaded from https://www.reader-dict.com/file/en/dict-en-en.zip
- Extracted to `dict-en-en/` folder containing StarDict format files

## Steps to Complete Setup

### 1. Run the StarDict Parser
Due to execution restrictions in the current environment, you need to run the parser script manually:

```bash
npm run parse-dict
```

This will:
- Parse the StarDict files (`dict-data.idx` and `dict-data.dict.dz`)
- Extract up to 50,000 dictionary entries
- Generate `src/lib/dictionary-data.json`

### 2. Copy to Public Folder
After parsing, copy the generated JSON file to the public folder for serving:

```bash
# Windows PowerShell
Copy-Item src\lib\dictionary-data.json public\

# Or manually copy the file from src/lib/dictionary-data.json to public/
```

### 3. Verify
The dictionary will be automatically loaded by the application when:
- The app starts
- A user looks up a word in the book reader
- The dictionary settings page is opened

## Dictionary Stats
- Source: reader.dict (Wiktionary-based)
- Total words in source: 795,912
- Parsed entries: 50,000 (limited to prevent huge file size)
- Format: JSON with word, definition, partOfSpeech, example fields

## Fallback Behavior
If the external dictionary fails to load, the app falls back to the original small dictionary with 6 custom words (kora, pensieve, ephemeral, sovereignty, aesthetic, lucid).

## NYT API Key Issue (Resolved)
The Cloudflare deployment was using localStorage for NYT data because the `NYT_BOOKS_API_KEY` secret was not configured. To fix:

```bash
npx wrangler secret put NYT_BOOKS_API_KEY
```

Then enter your NYT Books API key when prompted.
