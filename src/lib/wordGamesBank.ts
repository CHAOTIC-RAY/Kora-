/**
 * Shared offline word bank for crossword, wordscape, and word search.
 */

export interface WordEntry {
  word: string;
  clue: string;
}

export const WORD_BANK: WordEntry[] = [
  { word: "BOOK", clue: "Bound pages you read" },
  { word: "PAGE", clue: "One side of a leaf in a book" },
  { word: "READ", clue: "What you do with a novel" },
  { word: "INK", clue: "Dark fluid for pens" },
  { word: "PEN", clue: "Writing tool with ink" },
  { word: "MAP", clue: "Chart of lands and roads" },
  { word: "SUN", clue: "Daytime star" },
  { word: "MOON", clue: "Night sky companion" },
  { word: "STAR", clue: "Twinkle in the night" },
  { word: "TREE", clue: "Woody plant with leaves" },
  { word: "BIRD", clue: "Feathered flyer" },
  { word: "FISH", clue: "Swims with fins" },
  { word: "CAT", clue: "Purring house pet" },
  { word: "DOG", clue: "Loyal barking pet" },
  { word: "TEA", clue: "Hot steeped drink" },
  { word: "CAKE", clue: "Sweet baked dessert" },
  { word: "MILK", clue: "Dairy white drink" },
  { word: "RAIN", clue: "Falls from clouds" },
  { word: "SNOW", clue: "Frozen white flakes" },
  { word: "WIND", clue: "Moving air" },
  { word: "FIRE", clue: "Hot flickering flame" },
  { word: "WAVE", clue: "Ocean swell" },
  { word: "SHIP", clue: "Large seagoing vessel" },
  { word: "BOAT", clue: "Small water craft" },
  { word: "ROAD", clue: "Path for cars" },
  { word: "CITY", clue: "Large town" },
  { word: "HOME", clue: "Where you live" },
  { word: "DOOR", clue: "Entry you open" },
  { word: "LAMP", clue: "Light on a stand" },
  { word: "DESK", clue: "Writing table" },
  { word: "NOTE", clue: "Short written message" },
  { word: "WORD", clue: "Unit of language" },
  { word: "STORY", clue: "Tale with a plot" },
  { word: "POEM", clue: "Verse writing" },
  { word: "SONG", clue: "Music with lyrics" },
  { word: "DREAM", clue: "Mind movie while asleep" },
  { word: "HOPE", clue: "Wish for good things" },
  { word: "LOVE", clue: "Deep affection" },
  { word: "PEACE", clue: "Calm without conflict" },
  { word: "LIGHT", clue: "Opposite of dark" },
  { word: "NIGHT", clue: "Time after sunset" },
  { word: "DAWN", clue: "First light of day" },
  { word: "DUSK", clue: "Evening twilight" },
  { word: "LEAF", clue: "Green tree plate" },
  { word: "ROOT", clue: "Plant part underground" },
  { word: "SEED", clue: "Plant beginning" },
  { word: "BLOOM", clue: "Flower opening" },
  { word: "RIVER", clue: "Flowing freshwater" },
  { word: "STONE", clue: "Hard rock piece" },
  { word: "CLOUD", clue: "Sky vapor puff" },
  { word: "STORM", clue: "Wild weather" },
  { word: "BRIDGE", clue: "Span over water" },
  { word: "CASTLE", clue: "Fortified palace" },
  { word: "KNIGHT", clue: "Armored medieval warrior" },
  { word: "QUEEN", clue: "Female monarch" },
  { word: "CROWN", clue: "Royal headpiece" },
  { word: "SWORD", clue: "Bladed weapon" },
  { word: "SHIELD", clue: "Defensive armor plate" },
  { word: "FOREST", clue: "Dense woodland" },
  { word: "VALLEY", clue: "Low land between hills" },
  { word: "DESERT", clue: "Dry sandy region" },
  { word: "OCEAN", clue: "Vast salt water" },
  { word: "ISLAND", clue: "Land surrounded by water" },
  { word: "BEACH", clue: "Sandy shore" },
  { word: "CORAL", clue: "Reef-building sea life" },
  { word: "SHELL", clue: "Hard sea covering" },
  { word: "PEARL", clue: "Gem from an oyster" },
  { word: "GOLD", clue: "Precious yellow metal" },
  { word: "SILVER", clue: "Shiny gray metal" },
  { word: "COPPER", clue: "Reddish conductive metal" },
  { word: "CRYSTAL", clue: "Clear geometric mineral" },
  { word: "MIRROR", clue: "Reflective glass" },
  { word: "WINDOW", clue: "Glass in a wall" },
  { word: "GARDEN", clue: "Cultivated plant plot" },
  { word: "FLOWER", clue: "Blossoming plant" },
  { word: "HONEY", clue: "Sweet bee product" },
  { word: "BREAD", clue: "Baked loaf staple" },
  { word: "APPLE", clue: "Crunchy orchard fruit" },
  { word: "GRAPE", clue: "Vine berry" },
  { word: "LEMON", clue: "Sour yellow citrus" },
  { word: "ORANGE", clue: "Citrus named for its color" },
  { word: "BANANA", clue: "Yellow curved fruit" },
  { word: "CHERRY", clue: "Small red stone fruit" },
  { word: "MARKET", clue: "Place to buy goods" },
  { word: "LIBRARY", clue: "House of books" },
  { word: "MUSEUM", clue: "Hall of exhibits" },
  { word: "MUSIC", clue: "Organized sound art" },
  { word: "PIANO", clue: "Keyboard instrument" },
  { word: "VIOLIN", clue: "Bowed string instrument" },
  { word: "GUITAR", clue: "Six-string instrument" },
  { word: "DANCE", clue: "Rhythmic body movement" },
  { word: "PAINT", clue: "Colored coating" },
  { word: "CANVAS", clue: "Cloth for painting" },
  { word: "PENCIL", clue: "Graphite writing stick" },
  { word: "PAPER", clue: "Sheet for writing" },
  { word: "LETTER", clue: "Alphabet character / mail" },
  { word: "AUTHOR", clue: "Writer of a book" },
  { word: "READER", clue: "One who reads" },
  { word: "NOVEL", clue: "Long fiction book" },
  { word: "FABLE", clue: "Moral animal tale" },
  { word: "MYTH", clue: "Ancient sacred story" },
  { word: "LEGEND", clue: "Traditional heroic tale" },
  { word: "QUEST", clue: "Adventurous search" },
  { word: "JOURNEY", clue: "Long trip" },
  { word: "TRAVEL", clue: "Go from place to place" },
  { word: "COMPASS", clue: "Navigation direction tool" },
  { word: "LANTERN", clue: "Portable light" },
  { word: "CANDLE", clue: "Wax with a wick" },
  { word: "SHADOW", clue: "Dark shape from blocking light" },
  { word: "SILENCE", clue: "Absence of sound" },
  { word: "WHISPER", clue: "Soft spoken words" },
  { word: "ECHO", clue: "Sound that returns" },
  { word: "MEMORY", clue: "Stored past moment" },
  { word: "WISDOM", clue: "Deep knowing" },
  { word: "COURAGE", clue: "Bravery in fear" },
  { word: "FRIEND", clue: "Close companion" },
  { word: "FAMILY", clue: "Related household" },
  { word: "HARMONY", clue: "Pleasing accord" },
  { word: "BALANCE", clue: "Even stability" },
  { word: "RHYTHM", clue: "Musical pulse" },
  { word: "MELODY", clue: "Tune sequence" },
  { word: "HORIZON", clue: "Where sky meets land" },
  { word: "RAINBOW", clue: "Arc of spectrum colors" },
  { word: "TREASURE", clue: "Hidden valuable hoard" },
  { word: "MYSTERY", clue: "Unsolved puzzle" },
  { word: "SECRET", clue: "Hidden knowledge" },
  { word: "PUZZLE", clue: "Problem to solve" },
  { word: "RIDDLE", clue: "Worded brain teaser" },
  { word: "CIPHER", clue: "Coded writing" },
  { word: "SCROLL", clue: "Rolled parchment" },
  { word: "TOME", clue: "Large heavy book" },
  { word: "QUILL", clue: "Feather pen" },
  { word: "SHELF", clue: "Board that holds books" },
  { word: "ATLAS", clue: "Book of maps" },
  { word: "GLOBE", clue: "Spherical world model" },
  { word: "PLANET", clue: "World orbiting a star" },
  { word: "GALAXY", clue: "Vast star system" },
  { word: "COMET", clue: "Icy traveler with a tail" },
  { word: "ORBIT", clue: "Path around a body" },
  { word: "ROCKET", clue: "Space-bound craft" },
  { word: "ENGINE", clue: "Machine that powers" },
  { word: "WHEEL", clue: "Round rolling part" },
  { word: "ANCHOR", clue: "Ship's holding weight" },
  { word: "SAIL", clue: "Cloth that catches wind" },
  { word: "HARBOR", clue: "Safe place for ships" },
  { word: "VOYAGE", clue: "Long sea journey" },
  { word: "PASSAGE", clue: "Way through / book excerpt" },
  { word: "CHAPTER", clue: "Numbered book part" },
  { word: "HERO", clue: "Main brave figure" },
  { word: "VILLAIN", clue: "Story's antagonist" },
  { word: "SETTING", clue: "Where a story happens" },
  { word: "PLOT", clue: "Sequence of story events" },
  { word: "THEME", clue: "Underlying story idea" },
  { word: "SYMBOL", clue: "Thing that stands for another" },
  { word: "VERSE", clue: "Line of poetry" },
  { word: "STANZA", clue: "Group of poem lines" },
  { word: "SONNET", clue: "Fourteen-line poem" },
  { word: "BALLAD", clue: "Story song or poem" },
  { word: "JOURNAL", clue: "Personal written log" },
  { word: "DIARY", clue: "Day-by-day personal book" },
  { word: "VOLUME", clue: "One book in a set" },
  { word: "SERIES", clue: "Related books in order" },
  { word: "SEQUEL", clue: "Follow-up story" },
  { word: "INDEX", clue: "Alphabetical back list" },
  { word: "MARGIN", clue: "Blank edge of a page" },
  { word: "SPINE", clue: "Book's bound edge" },
  { word: "COVER", clue: "Outer face of a book" },
  { word: "TITLE", clue: "Name of a work" },
  { word: "GENRE", clue: "Category of story" },
  { word: "FICTION", clue: "Invented narrative" },
  { word: "HISTORY", clue: "Record of the past" },
  { word: "SCIENCE", clue: "Study of the natural world" },
  { word: "NATURE", clue: "The living outdoor world" },
  { word: "ANIMAL", clue: "Living creature" },
  { word: "SEASON", clue: "Quarter of the year" },
  { word: "WINTER", clue: "Coldest season" },
  { word: "SUMMER", clue: "Warmest season" },
  { word: "SPRING", clue: "Season of new growth" },
  { word: "AUTUMN", clue: "Fall season of leaves" },
  { word: "ARE", clue: "Form of to be" },
  { word: "ERA", clue: "Long stretch of time" },
  { word: "ART", clue: "Creative craft" },
  { word: "EAR", clue: "Hearing organ" },
  { word: "TEA", clue: "Hot steeped drink" },
  { word: "EAT", clue: "Take food" },
  { word: "SEA", clue: "Salt water expanse" },
  { word: "SET", clue: "Group of things" },
  { word: "NET", clue: "Mesh for catching" },
  { word: "TEN", clue: "Number after nine" },
  { word: "NEST", clue: "Bird's home" },
  { word: "REST", clue: "Take a break" },
  { word: "RATE", clue: "Speed or price" },
  { word: "TEAR", clue: "Rip / eye drop" },
  { word: "CARE", clue: "Gentle concern" },
  { word: "RACE", clue: "Speed contest" },
  { word: "ACRE", clue: "Land measure" },
  { word: "CASE", clue: "Box or instance" },
  { word: "LAKE", clue: "Inland water body" },
  { word: "KALE", clue: "Leafy green" },
  { word: "PEAK", clue: "Mountain top" },
  { word: "TAKE", clue: "Grab or accept" },
  { word: "TALE", clue: "Short story" },
  { word: "LATE", clue: "After the time" },
  { word: "TALE", clue: "Told story" },
  { word: "SAND", clue: "Beach grains" },
  { word: "LAND", clue: "Solid ground" },
  { word: "HAND", clue: "Palm and fingers" },
  { word: "BAND", clue: "Music group / strip" },
  { word: "DARK", clue: "Without light" },
  { word: "PARK", clue: "Green public space" },
  { word: "MARK", clue: "Visible sign" },
  { word: "LARK", clue: "Songbird" },
];

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function letterCounts(word: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ch of word.toUpperCase()) {
    if (ch < "A" || ch > "Z") continue;
    counts[ch] = (counts[ch] || 0) + 1;
  }
  return counts;
}

export function canSpellFrom(word: string, pool: Record<string, number>): boolean {
  const need = letterCounts(word);
  for (const [ch, n] of Object.entries(need)) {
    if ((pool[ch] || 0) < n) return false;
  }
  return true;
}

export type GameDifficulty = "easy" | "medium" | "hard";

export function difficultySeed(tag: number, difficulty: GameDifficulty, level: number): number {
  const d = difficulty === "easy" ? 1 : difficulty === "medium" ? 2 : 3;
  return ((level * 2654435761) ^ (d * 974698316) ^ (tag * 0x9e3779b9)) >>> 0;
}
