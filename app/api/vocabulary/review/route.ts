import { scheduleVocabulary } from "@/app/api/_lib/fsrs";
import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { id?: number; rating?: number; masteryCheck?: boolean };
    if (!body.id || !body.rating) return jsonError(new Error("缺少复习评分"), 400);
    const current = await getDatabase().prepare("SELECT * FROM vocabulary WHERE id=? AND owner_id=?").bind(body.id, ownerId).first<Record<string, unknown>>();
    if (!current) return jsonError(new Error("单词不存在"), 404);

    const now = new Date();
    const result = scheduleVocabulary(current, body.rating, now);
    const card = result.card;
    const keepMastered = Boolean(current.mastered && body.masteryCheck && body.rating >= 3);
    await getDatabase().batch([
      getDatabase().prepare(`UPDATE vocabulary SET mastered=?,review_count=?,next_review_at=?,fsrs_state=?,fsrs_stability=?,fsrs_difficulty=?,fsrs_elapsed_days=?,fsrs_scheduled_days=?,fsrs_learning_steps=?,fsrs_reps=?,fsrs_lapses=?,fsrs_last_review_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`)
        .bind(keepMastered ? 1 : 0, card.reps, card.due.toISOString(), card.state, card.stability, card.difficulty, card.elapsed_days, card.scheduled_days, card.learning_steps, card.reps, card.lapses, card.last_review?.toISOString() || now.toISOString(), body.id, ownerId),
      getDatabase().prepare(`INSERT INTO vocabulary_reviews (owner_id,vocabulary_id,rating,state_before,state_after,due_at,stability,difficulty,scheduled_days,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(ownerId, body.id, body.rating, Number(current.fsrs_state ?? 0), card.state, card.due.toISOString(), card.stability, card.difficulty, card.scheduled_days, now.toISOString()),
    ]);
    return Response.json({ ok: true, nextReviewAt: card.due.toISOString(), scheduledDays: card.scheduled_days, state: card.state });
  } catch (error) { return jsonError(error); }
}
