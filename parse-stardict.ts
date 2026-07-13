import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// StarDict parser
// Format: .idx file contains null-terminated words followed by 4-byte offset and 4-byte size (little-endian)
// .dict.dz is gzip compressed dictionary data

const IDX_FILE = path.join(process.cwd(), 'dict-en-en', 'dict-data.idx');
const DICT_FILE = path.join(process.cwd(), 'dict-en-en', 'dict-data.dict.dz');
const OUTPUT_FILE = path.join(process.cwd(), 'src', 'lib', 'dictionary-data.json');

function parseIdxFile(idxPath: string): Array<{word: string, offset: number, size: number}> {
  const buffer = fs.readFileSync(idxPath);
  const words: Array<{word: string, offset: number, size: number}> = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Find null terminator
    let end = offset;
    while (end < buffer.length && buffer[end] !== 0) {
      end++;
    }

    if (end >= buffer.length) break;

    // Extract word
    const word = buffer.toString('utf8', offset, end);
    
    // Skip null terminator
    end++;

    // Read offset (4 bytes, little-endian)
    const dataOffset = buffer.readUInt32LE(end);
    end += 4;

    // Read size (4 bytes, little-endian)
    const dataSize = buffer.readUInt32LE(end);
    end += 4;

    words.push({
      word,
      offset: dataOffset,
      size: dataSize
    });

    offset = end;
  }

  console.log(`Parsed ${words.length} words from index file`);
  return words;
}

function decompressDictFile(dictPath: string): Buffer {
  const compressed = fs.readFileSync(dictPath);
  console.log('Decompressing dictionary data...');
  const decompressed = zlib.gunzipSync(compressed);
  console.log(`Decompressed to ${decompressed.length} bytes`);
  return decompressed;
}

function extractDefinitions(words: Array<{word: string, offset: number, size: number}>, dictBuffer: Buffer): any[] {
  const entries: any[] = [];
  const maxEntries = 50000; // Limit to prevent huge file

  for (let i = 0; i < Math.min(words.length, maxEntries); i++) {
    const { word, offset, size } = words[i];
    
    try {
      const definition = dictBuffer.toString('utf8', offset, offset + size);
      
      // Clean up HTML - extract text content
      let cleanDef = definition
        .replace(/<[^>]*>/g, ' ') // Remove HTML tags
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ') // Collapse whitespace
        .trim();

      // Limit definition length
      if (cleanDef.length > 500) {
        cleanDef = cleanDef.substring(0, 500) + '...';
      }

      if (cleanDef.length > 10) {
        entries.push({
          word: word.toLowerCase(),
          definition: cleanDef,
          partOfSpeech: undefined,
          example: undefined,
          isCustom: false
        });
      }
    } catch (err: any) {
      console.warn(`Failed to extract definition for "${word}":`, err.message);
    }

    if (i > 0 && i % 10000 === 0) {
      console.log(`Processed ${i}/${Math.min(words.length, maxEntries)} entries...`);
    }
  }

  return entries;
}

function main() {
  console.log('Starting StarDict parser...');
  
  // Parse index file
  const words = parseIdxFile(IDX_FILE);
  
  // Decompress dictionary data
  const dictBuffer = decompressDictFile(DICT_FILE);
  
  // Extract definitions
  console.log('Extracting definitions...');
  const entries = extractDefinitions(words, dictBuffer);
  
  console.log(`Extracted ${entries.length} dictionary entries`);
  
  // Write output
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(entries, null, 2));
  console.log(`Written to ${OUTPUT_FILE}`);
}

main();
