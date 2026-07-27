export interface TxtParserRule {
  id: string;
  name: string;
  description: string;
  pattern: string;
  isBuiltIn?: boolean;
}

export const BUILT_IN_TXT_PARSERS: TxtParserRule[] = [
  {
    id: "default",
    name: "Default parser",
    description: "Suitable for most txt files",
    pattern: "^\\s*(Chapter|CHAPTER|Part|PART|Book|BOOK|第[0-9一二三四五六七八九十百千万零]+[章回])\\s*",
    isBuiltIn: true,
  },
  {
    id: "chinese",
    name: "Chinese novel parser",
    description: "Suitable for most Chinese novels, eg. 第一章, 第2回",
    pattern: "^\\s*(第[0-9一二三四五六七八九十百千万零壹贰叁肆伍陆柒捌玖拾佰仟]+[章回])\\s*",
    isBuiltIn: true,
  },
  {
    id: "english",
    name: "English novel parser",
    description: "Suitable for most English novels, eg. Chapter 1, Part II",
    pattern: "^\\s*(Chapter|Part|Book|CHAPTER|PART|BOOK)\\s*",
    isBuiltIn: true,
  },
  {
    id: "number",
    name: "Number parser",
    description: "Suitable for novels with number chapter titles, eg. 1, 2, 3",
    pattern: "^\\s*([0-9]+[\\s、：:\\—\\─]+|[一二三四五六七八九十百千万零]+[\\s、：:\\—\\─]+).+",
    isBuiltIn: true,
  },
];

const CUSTOM_PARSERS_KEY = "kora_custom_txt_parsers";
const ACTIVE_PARSER_KEY = "kora_active_txt_parser";

export function getCustomTxtParsers(): TxtParserRule[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PARSERS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveCustomTxtParser(parser: Omit<TxtParserRule, "id" | "isBuiltIn">): TxtParserRule {
  const custom = getCustomTxtParsers();
  const newRule: TxtParserRule = {
    ...parser,
    id: `custom_${Date.now()}`,
    isBuiltIn: false,
  };
  const updated = [...custom, newRule];
  localStorage.setItem(CUSTOM_PARSERS_KEY, JSON.stringify(updated));
  return newRule;
}

export function deleteCustomTxtParser(id: string): void {
  const custom = getCustomTxtParsers().filter((p) => p.id !== id);
  localStorage.setItem(CUSTOM_PARSERS_KEY, JSON.stringify(custom));
  if (getActiveTxtParserId() === id) {
    setActiveTxtParserId("default");
  }
}

export function getActiveTxtParserId(): string {
  return localStorage.getItem(ACTIVE_PARSER_KEY) || "default";
}

export function setActiveTxtParserId(id: string): void {
  localStorage.setItem(ACTIVE_PARSER_KEY, id);
}

export function getAllTxtParsers(): TxtParserRule[] {
  return [...BUILT_IN_TXT_PARSERS, ...getCustomTxtParsers()];
}

export function getActiveTxtParser(): TxtParserRule {
  const activeId = getActiveTxtParserId();
  const all = getAllTxtParsers();
  return all.find((p) => p.id === activeId) || BUILT_IN_TXT_PARSERS[0];
}
