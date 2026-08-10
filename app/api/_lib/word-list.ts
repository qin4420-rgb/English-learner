export type ImportedWord = { word: string; definition: string; phonetic: string; example: string; tags: string };

function parseLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) { values.push(value.trim()); value = ""; }
    else value += character;
  }
  values.push(value.trim());
  return values;
}

function normalize(item: Partial<ImportedWord>): ImportedWord | null {
  const word = String(item.word || "").trim().toLowerCase();
  if (!word || word.length > 160) return null;
  return { word, definition: String(item.definition || "").trim(), phonetic: String(item.phonetic || "").trim(), example: String(item.example || "").trim(), tags: String(item.tags || "").trim() };
}

export function parseWordList(content: string, isJson = false): ImportedWord[] {
  if (isJson) {
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) throw new Error("JSON词表必须是对象数组");
    return Array.from(new Map(parsed.map((item) => normalize(item as Partial<ImportedWord>)).filter((item): item is ImportedWord => Boolean(item)).map((item) => [item.word, item])).values()).slice(0, 10000);
  }
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (!lines.length) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : lines[0].includes(";") ? ";" : "\t";
  const rows = lines.map((line) => parseLine(line, delimiter));
  const headers = rows[0].map((value) => value.toLowerCase());
  const aliases: Record<string, keyof ImportedWord> = { word: "word", term: "word", 单词: "word", 词汇: "word", definition: "definition", meaning: "definition", 释义: "definition", 中文: "definition", phonetic: "phonetic", pronunciation: "phonetic", 音标: "phonetic", example: "example", sentence: "example", 例句: "example", tags: "tags", tag: "tags", 标签: "tags" };
  const hasHeader = headers.some((header) => aliases[header] === "word");
  const headerMap = hasHeader ? headers.map((header) => aliases[header]) : ["word", "definition", "phonetic", "example", "tags"] as (keyof ImportedWord)[];
  const words = rows.slice(hasHeader ? 1 : 0).map((row) => {
    const item: Partial<ImportedWord> = {};
    row.forEach((value, index) => { const field = headerMap[index]; if (field) item[field] = value; });
    return normalize(item);
  }).filter((item): item is ImportedWord => Boolean(item));
  return Array.from(new Map(words.map((item) => [item.word, item])).values()).slice(0, 10000);
}
