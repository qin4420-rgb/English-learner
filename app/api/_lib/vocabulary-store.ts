import { getDatabase } from "./runtime";

export type VocabularyWrite = {
  word: string;
  phonetic?: string;
  definition?: string;
  dictionaryDefinition?: string;
  aiExplanation?: string;
  example?: string;
  exampleTranslation?: string;
  sourceType?: string;
  resourceId?: number | null;
  sourceTitle?: string;
  sourceAnchor?: string;
  sourceSentence?: string;
  tags?: string;
};

export async function saveVocabularyOccurrence(ownerId: string, input: VocabularyWrite) {
  const word = input.word.replace(/\s+/g, " ").trim().toLowerCase();
  if (!word) throw new Error("单词不能为空");
  const database = getDatabase();
  await database.prepare(`INSERT INTO vocabulary (owner_id,word,phonetic,definition,dictionary_definition,ai_explanation,example,example_translation,source_type,source_id,source_anchor,source_sentence,tags,next_review_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(owner_id,word) DO UPDATE SET phonetic=CASE WHEN excluded.phonetic!='' THEN excluded.phonetic ELSE vocabulary.phonetic END,definition=CASE WHEN excluded.definition!='' THEN excluded.definition ELSE vocabulary.definition END,dictionary_definition=CASE WHEN excluded.dictionary_definition!='' THEN excluded.dictionary_definition ELSE vocabulary.dictionary_definition END,ai_explanation=CASE WHEN excluded.ai_explanation!='' THEN excluded.ai_explanation ELSE vocabulary.ai_explanation END,example=CASE WHEN excluded.example!='' THEN excluded.example ELSE vocabulary.example END,example_translation=CASE WHEN excluded.example_translation!='' THEN excluded.example_translation ELSE vocabulary.example_translation END,tags=CASE WHEN excluded.tags!='' THEN excluded.tags ELSE vocabulary.tags END,updated_at=CURRENT_TIMESTAMP`)
    .bind(ownerId, word, input.phonetic || "", input.definition || "", input.dictionaryDefinition || "", input.aiExplanation || "", input.example || "", input.exampleTranslation || "", input.sourceType || "manual", input.resourceId ? String(input.resourceId) : "", input.sourceAnchor || "", input.sourceSentence || "", input.tags || "").run();
  const vocabulary = await database.prepare("SELECT id FROM vocabulary WHERE owner_id=? AND word=?").bind(ownerId, word).first<{ id: number }>();
  const vocabularyId = Number(vocabulary?.id || 0);
  if (!vocabularyId) throw new Error("单词保存失败");
  await database.prepare(`INSERT INTO vocabulary_occurrences (owner_id,vocabulary_id,resource_id,source_type,source_title,source_anchor,source_sentence) VALUES (?,?,?,?,?,?,?)`)
    .bind(ownerId, vocabularyId, input.resourceId || null, input.sourceType || "manual", input.sourceTitle || "", input.sourceAnchor || "", input.sourceSentence || "").run();
  return vocabularyId;
}
