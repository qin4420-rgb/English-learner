import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";

export async function GET() {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const result = await getDatabase()
      .prepare("SELECT * FROM study_progress WHERE owner_id=? ORDER BY last_studied_at DESC")
      .bind(ownerId)
      .all();
    const progress = (result.results as Record<string, unknown>[]).map((row) => ({
      id: Number(row.id),
      lessonKey: String(row.lesson_key),
      bookKey: String(row.book_key),
      lessonTitle: String(row.lesson_title),
      progressSeconds: Number(row.progress_seconds),
      durationSeconds: Number(row.duration_seconds),
      completed: Boolean(row.completed),
      note: String(row.note ?? ""),
      lastStudiedAt: String(row.last_studied_at),
    }));
    return Response.json({ progress });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as {
      lessonKey?: string;
      bookKey?: string;
      lessonTitle?: string;
      progressSeconds?: number;
      durationSeconds?: number;
      completed?: boolean;
      note?: string;
    };
    if (!body.lessonKey || !body.bookKey || !body.lessonTitle) {
      return jsonError(new Error("课程信息不完整"), 400);
    }
    await getDatabase()
      .prepare(`INSERT INTO study_progress (owner_id,lesson_key,book_key,lesson_title,progress_seconds,duration_seconds,completed,note,last_studied_at)
        VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(owner_id,lesson_key) DO UPDATE SET book_key=excluded.book_key, lesson_title=excluded.lesson_title, progress_seconds=excluded.progress_seconds, duration_seconds=excluded.duration_seconds, completed=excluded.completed, note=excluded.note, last_studied_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP`)
      .bind(ownerId, body.lessonKey, body.bookKey, body.lessonTitle, Math.max(0, Math.round(body.progressSeconds ?? 0)), Math.max(0, Math.round(body.durationSeconds ?? 0)), body.completed ? 1 : 0, body.note?.trim() ?? "")
      .run();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

