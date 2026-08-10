import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";

type ImportedWord = { word: string; definition: string; phonetic: string; example: string; tags: string };

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

function parseText(content: string): ImportedWord[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (!lines.length) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : lines[0].includes(";") ? ";" : "\t";
  const rows = lines.map((line) => parseLine(line, delimiter));
  const normalizedHeaders = rows[0].map((value) => value.trim().toLowerCase());
  const headerAliases: Record<string, keyof ImportedWord> = {
    word: "word", term: "word", 单词: "word", 词汇: "word",
    definition: "definition", meaning: "definition", 释义: "definition", 中文: "definition",
    phonetic: "phonetic", pronunciation: "phonetic", 音标: "phonetic",
    example: "example", sentence: "example", 例句: "example",
    tags: "tags", tag: "tags", 标签: "tags",
  };
  const hasHeader = normalizedHeaders.some((header) => headerAliases[header] === "word");
  const headerMap = hasHeader ? normalizedHeaders.map((header) => headerAliases[header]) : ["word", "definition", "phonetic", "example", "tags"] as (keyof ImportedWord)[];
  return rows.slice(hasHeader ? 1 : 0).map((row) => {
    const item: Partial<ImportedWord> = {};
    row.forEach((value, index) => { const field = headerMap[index]; if (field) item[field] = value; });
    return normalize(item);
  }).filter((item): item is ImportedWord => Boolean(item));
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError(new Error("请选择词表文件"), 400);
    if (file.size > 2 * 1024 * 1024) return jsonError(new Error("词表文件暂限 2MB"), 413);
    const content = await file.text();
    let words: ImportedWord[];
    if (file.name.toLowerCase().endsWith(".json") || file.type.includes("json")) {
      const parsed = JSON.parse(content) as unknown;
      if (!Array.isArray(parsed)) throw new Error("JSON词表必须是对象数组");
      words = parsed.map((item) => normalize(item as Partial<ImportedWord>)).filter((item): item is ImportedWord => Boolean(item));
    } else words = parseText(content);
    const unique = Array.from(new Map(words.map((item) => [item.word, item])).values()).slice(0, 10000);
    if (!unique.length) return jsonError(new Error("没有识别到单词；请使用CSV、TSV、TXT或JSON格式"), 400);

    const statements = unique.map((item) => getDatabase().prepare(`INSERT INTO vocabulary (owner_id,word,phonetic,definition,example,source_type,tags,next_review_at)
      VALUES (?,?,?,?,?,'import',?,CURRENT_TIMESTAMP)
      ON CONFLICT(owner_id,word) DO UPDATE SET phonetic=CASE WHEN excluded.phonetic!='' THEN excluded.phonetic ELSE vocabulary.phonetic END,definition=CASE WHEN excluded.definition!='' THEN excluded.definition ELSE vocabulary.definition END,example=CASE WHEN excluded.example!='' THEN excluded.example ELSE vocabulary.example END,tags=CASE WHEN excluded.tags!='' THEN excluded.tags ELSE vocabulary.tags END,updated_at=CURRENT_TIMESTAMP`)
      .bind(ownerId, item.word, item.phonetic, item.definition, item.example, item.tags));
    for (let index = 0; index < statements.length; index += 200) await getDatabase().batch(statements.slice(index, index + 200));
    return Response.json({ ok: true, processed: unique.length, skipped: words.length - unique.length });
  } catch (error) { return jsonError(error); }
}
