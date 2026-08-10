export type ImportedDictionaryEntry = { headword: string; phonetic: string; partOfSpeech: string; definition: string; definitionEn: string; example: string; extraJson: string };

function normalizeEntry(value: Record<string, unknown>): ImportedDictionaryEntry | null {
  const headword = String(value.headword || value.word || value.term || value["单词"] || "").trim().toLowerCase();
  if (!headword || headword.length > 180) return null;
  const known = new Set(["headword", "word", "term", "单词", "phonetic", "音标", "partOfSpeech", "part_of_speech", "pos", "词性", "definition", "meaning", "释义", "definitionEn", "definition_en", "english", "example", "例句"]);
  return {
    headword,
    phonetic: String(value.phonetic || value["音标"] || "").trim(),
    partOfSpeech: String(value.partOfSpeech || value.part_of_speech || value.pos || value["词性"] || "").trim(),
    definition: String(value.definition || value.meaning || value["释义"] || "").trim(),
    definitionEn: String(value.definitionEn || value.definition_en || value.english || "").trim(),
    example: String(value.example || value["例句"] || "").trim(),
    extraJson: JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key]) => !known.has(key)))),
  };
}

function parseDelimitedLine(line: string, delimiter: string) {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') { if (quoted && line[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { result.push(value.trim()); value = ""; }
    else value += char;
  }
  result.push(value.trim());
  return result;
}

export function parseDictionary(content: string, isJson = false): ImportedDictionaryEntry[] {
  let entries: (ImportedDictionaryEntry | null)[];
  if (isJson) {
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed)) throw new Error("JSON词典必须是对象数组");
    entries = parsed.map((item) => normalizeEntry(item as Record<string, unknown>));
  } else {
    const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) return [];
    const delimiter = lines[0].includes("\t") ? "\t" : ",";
    const rows = lines.map((line) => parseDelimitedLine(line, delimiter));
    const headers = rows[0].map((value) => value.trim());
    const hasHeader = headers.some((header) => /^(headword|word|term|单词)$/i.test(header));
    const fallback = ["headword", "definition", "phonetic", "partOfSpeech", "definitionEn", "example"];
    const keys = hasHeader ? headers : fallback;
    entries = rows.slice(hasHeader ? 1 : 0).map((row) => normalizeEntry(Object.fromEntries(row.map((value, index) => [keys[index] || `extra_${index}`, value]))));
  }
  return Array.from(new Map(entries.filter((entry): entry is ImportedDictionaryEntry => Boolean(entry)).map((entry) => [entry.headword, entry])).values()).slice(0, 100000);
}
