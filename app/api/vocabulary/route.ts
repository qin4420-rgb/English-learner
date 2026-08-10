import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";

function mapWord(row: Record<string, unknown>) {
  return {
    id: Number(row.id), word: String(row.word), phonetic: String(row.phonetic ?? ""), definition: String(row.definition ?? ""), dictionaryDefinition: String(row.dictionary_definition ?? ""), aiExplanation: String(row.ai_explanation ?? ""), example: String(row.example ?? ""), exampleTranslation: String(row.example_translation ?? ""),
    sourceType: String(row.source_type ?? "manual"), sourceId: String(row.source_id ?? ""), sourceAnchor: String(row.source_anchor ?? ""), sourceSentence: String(row.source_sentence ?? ""), tags: String(row.tags ?? ""), mastered: Boolean(row.mastered),
    reviewCount: Number(row.review_count ?? 0), nextReviewAt: String(row.next_review_at ?? ""), fsrsState: Number(row.fsrs_state ?? 0), fsrsStability: Number(row.fsrs_stability ?? 0),
    fsrsDifficulty: Number(row.fsrs_difficulty ?? 0), fsrsScheduledDays: Number(row.fsrs_scheduled_days ?? 0), fsrsReps: Number(row.fsrs_reps ?? 0), fsrsLapses: Number(row.fsrs_lapses ?? 0),
    fsrsLastReviewAt: String(row.fsrs_last_review_at ?? ""), createdAt: String(row.created_at ?? ""),
  };
}
export async function GET() {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const result = await getDatabase().prepare("SELECT * FROM vocabulary WHERE owner_id=? ORDER BY mastered,COALESCE(next_review_at,'1970-01-01'),updated_at DESC").bind(ownerId).all();
    return Response.json({ vocabulary: (result.results as Record<string, unknown>[]).map(mapWord) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { word?: string; phonetic?: string; definition?: string; dictionaryDefinition?: string; aiExplanation?: string; example?: string; exampleTranslation?: string; sourceType?: string; sourceId?: string; sourceAnchor?: string; sourceSentence?: string; tags?: string };
    const word = body.word?.trim().toLowerCase();
    if (!word) return jsonError(new Error("单词不能为空"), 400);
    await getDatabase().prepare(`INSERT INTO vocabulary (owner_id,word,phonetic,definition,dictionary_definition,ai_explanation,example,example_translation,source_type,source_id,source_anchor,source_sentence,tags,next_review_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(owner_id,word) DO UPDATE SET phonetic=CASE WHEN excluded.phonetic!='' THEN excluded.phonetic ELSE vocabulary.phonetic END,definition=CASE WHEN excluded.definition!='' THEN excluded.definition ELSE vocabulary.definition END,dictionary_definition=CASE WHEN excluded.dictionary_definition!='' THEN excluded.dictionary_definition ELSE vocabulary.dictionary_definition END,ai_explanation=CASE WHEN excluded.ai_explanation!='' THEN excluded.ai_explanation ELSE vocabulary.ai_explanation END,example=CASE WHEN excluded.example!='' THEN excluded.example ELSE vocabulary.example END,example_translation=CASE WHEN excluded.example_translation!='' THEN excluded.example_translation ELSE vocabulary.example_translation END,source_type=excluded.source_type,source_id=excluded.source_id,source_anchor=excluded.source_anchor,source_sentence=CASE WHEN excluded.source_sentence!='' THEN excluded.source_sentence ELSE vocabulary.source_sentence END,tags=CASE WHEN excluded.tags!='' THEN excluded.tags ELSE vocabulary.tags END,updated_at=CURRENT_TIMESTAMP`)
      .bind(ownerId, word, body.phonetic || "", body.definition || "", body.dictionaryDefinition || "", body.aiExplanation || "", body.example || "", body.exampleTranslation || "", body.sourceType || "manual", body.sourceId || "", body.sourceAnchor || "", body.sourceSentence || "", body.tags || "").run();
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { id?: number; mastered?: boolean; definition?: string; dictionaryDefinition?: string; aiExplanation?: string; example?: string; exampleTranslation?: string; sourceSentence?: string; tags?: string };
    if (!body.id) return jsonError(new Error("缺少单词编号"), 400);
    const current = await getDatabase().prepare("SELECT * FROM vocabulary WHERE id=? AND owner_id=?").bind(body.id, ownerId).first<Record<string, unknown>>();
    if (!current) return jsonError(new Error("单词不存在"), 404);
    await getDatabase().prepare("UPDATE vocabulary SET mastered=?,definition=?,dictionary_definition=?,ai_explanation=?,example=?,example_translation=?,source_sentence=?,tags=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
      .bind(typeof body.mastered === "boolean" ? (body.mastered ? 1 : 0) : Number(current.mastered), body.definition ?? current.definition, body.dictionaryDefinition ?? current.dictionary_definition, body.aiExplanation ?? current.ai_explanation, body.example ?? current.example, body.exampleTranslation ?? current.example_translation, body.sourceSentence ?? current.source_sentence, body.tags ?? current.tags, body.id, ownerId).run();
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const id = Number(new URL(request.url).searchParams.get("id"));
    await getDatabase().batch([
      getDatabase().prepare("DELETE FROM vocabulary_reviews WHERE vocabulary_id=? AND owner_id=?").bind(id, ownerId),
      getDatabase().prepare("DELETE FROM vocabulary WHERE id=? AND owner_id=?").bind(id, ownerId),
    ]);
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
