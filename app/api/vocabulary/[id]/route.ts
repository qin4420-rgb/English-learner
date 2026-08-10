import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const id = Number((await context.params).id);
    if (!id) return jsonError(new Error("单词编号无效"), 400);
    const [occurrences, reviews] = await Promise.all([
      getDatabase().prepare("SELECT id,vocabulary_id,resource_id,source_type,source_title,source_anchor,source_sentence,created_at FROM vocabulary_occurrences WHERE owner_id=? AND vocabulary_id=? ORDER BY created_at DESC").bind(ownerId, id).all(),
      getDatabase().prepare("SELECT rating,state_before,state_after,due_at,stability,difficulty,scheduled_days,reviewed_at FROM vocabulary_reviews WHERE owner_id=? AND vocabulary_id=? ORDER BY reviewed_at DESC LIMIT 100").bind(ownerId, id).all(),
    ]);
    return Response.json({
      occurrences: (occurrences.results as Record<string, unknown>[]).map((row) => ({ id: Number(row.id), vocabularyId: Number(row.vocabulary_id), resourceId: row.resource_id ? Number(row.resource_id) : null, sourceType: String(row.source_type), sourceTitle: String(row.source_title || ""), sourceAnchor: String(row.source_anchor || ""), sourceSentence: String(row.source_sentence || ""), createdAt: String(row.created_at) })),
      reviews: reviews.results,
    });
  } catch (error) { return jsonError(error); }
}
