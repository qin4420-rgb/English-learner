import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";
import { saveVocabularyOccurrence } from "@/app/api/_lib/vocabulary-store";

function mapWord(row: Record<string, unknown>, occurrences: Record<number, { count: number; sources: string[] }>) {
  const occurrence = occurrences[Number(row.id)] || { count: 0, sources: [] };
  return {
    id: Number(row.id), word: String(row.word), phonetic: String(row.phonetic ?? ""), definition: String(row.definition ?? ""), dictionaryDefinition: String(row.dictionary_definition ?? ""), aiExplanation: String(row.ai_explanation ?? ""), example: String(row.example ?? ""), exampleTranslation: String(row.example_translation ?? ""),
    sourceType: String(row.source_type ?? "manual"), sourceId: String(row.source_id ?? ""), sourceAnchor: String(row.source_anchor ?? ""), sourceSentence: String(row.source_sentence ?? ""), tags: String(row.tags ?? ""), mastered: Boolean(row.mastered),
    reviewCount: Number(row.review_count ?? 0), nextReviewAt: String(row.next_review_at ?? ""), fsrsState: Number(row.fsrs_state ?? 0), fsrsStability: Number(row.fsrs_stability ?? 0),
    fsrsDifficulty: Number(row.fsrs_difficulty ?? 0), fsrsScheduledDays: Number(row.fsrs_scheduled_days ?? 0), fsrsReps: Number(row.fsrs_reps ?? 0), fsrsLapses: Number(row.fsrs_lapses ?? 0),
    fsrsLastReviewAt: String(row.fsrs_last_review_at ?? ""), createdAt: String(row.created_at ?? ""),
    occurrenceCount: occurrence.count,
    occurrenceSources: occurrence.sources,
  };
}
export async function GET() {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const [result, occurrenceResult] = await Promise.all([
      getDatabase().prepare("SELECT * FROM vocabulary WHERE owner_id=? ORDER BY mastered,COALESCE(next_review_at,'1970-01-01'),updated_at DESC").bind(ownerId).all(),
      getDatabase().prepare("SELECT vocabulary_id,source_type,source_title FROM vocabulary_occurrences WHERE owner_id=? ORDER BY created_at DESC").bind(ownerId).all(),
    ]);
    const occurrences: Record<number, { count: number; sources: string[] }> = {};
    for (const row of occurrenceResult.results as Record<string, unknown>[]) {
      const id = Number(row.vocabulary_id);
      const item = occurrences[id] ||= { count: 0, sources: [] };
      item.count += 1;
      const label = String(row.source_title || row.source_type || "来源");
      if (label && !item.sources.includes(label)) item.sources.push(label);
    }
    return Response.json({ vocabulary: (result.results as Record<string, unknown>[]).map((row) => mapWord(row, occurrences)) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { word?: string; phonetic?: string; definition?: string; dictionaryDefinition?: string; aiExplanation?: string; example?: string; exampleTranslation?: string; sourceType?: string; sourceId?: string; resourceId?: number; sourceTitle?: string; sourceAnchor?: string; sourceSentence?: string; tags?: string };
    const word = body.word?.trim().toLowerCase();
    if (!word) return jsonError(new Error("单词不能为空"), 400);
    const resourceId = Number(body.resourceId || body.sourceId || 0) || null;
    await saveVocabularyOccurrence(ownerId, { ...body, word, resourceId, sourceTitle: body.sourceTitle || (resourceId ? `Resource #${resourceId}` : body.sourceType === "import" ? "外部词表" : "手工添加") });
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
      getDatabase().prepare("DELETE FROM vocabulary_occurrences WHERE vocabulary_id=? AND owner_id=?").bind(id, ownerId),
      getDatabase().prepare("DELETE FROM vocabulary WHERE id=? AND owner_id=?").bind(id, ownerId),
    ]);
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
