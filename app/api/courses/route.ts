import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";

function mapCourse(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    title: String(row.title),
    courseType: String(row.course_type),
    description: String(row.description ?? ""),
    icon: String(row.icon ?? "book"),
    status: String(row.status ?? "active"),
    pinned: Boolean(row.pinned),
    sortOrder: Number(row.sort_order ?? 0),
    resourceCount: Number(row.resource_count ?? 0),
    resourceIds: String(row.resource_ids ?? "").split(",").filter(Boolean).map(Number),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function GET() {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    await getDatabase()
      .prepare(`INSERT INTO courses (owner_id,title,course_type,description,icon,pinned,sort_order)
        VALUES (?, '新概念英语', 'nce', '四册课程、逐句字幕、精听进度与课堂笔记', 'headphones', 1, 0)
        ON CONFLICT(owner_id,title) DO NOTHING`)
      .bind(ownerId)
      .run();
    const result = await getDatabase()
      .prepare(`SELECT c.*, COUNT(cr.id) AS resource_count, GROUP_CONCAT(cr.resource_id) AS resource_ids FROM courses c
        LEFT JOIN course_resources cr ON cr.owner_id=c.owner_id AND cr.course_id=c.id
        WHERE c.owner_id=? GROUP BY c.id ORDER BY c.pinned DESC,c.sort_order,c.created_at`)
      .bind(ownerId)
      .all();
    return Response.json({ courses: (result.results as Record<string, unknown>[]).map(mapCourse) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as {
      title?: string; courseType?: string; description?: string; icon?: string;
      resourceId?: number; courseId?: number;
    };
    if (body.courseId && body.resourceId) {
      const count = await getDatabase().prepare("SELECT COUNT(*) AS total FROM course_resources WHERE owner_id=? AND course_id=?").bind(ownerId, body.courseId).first<{ total: number }>();
      await getDatabase().prepare("INSERT INTO course_resources (owner_id,course_id,resource_id,sort_order) VALUES (?,?,?,?) ON CONFLICT(owner_id,course_id,resource_id) DO NOTHING").bind(ownerId, body.courseId, body.resourceId, Number(count?.total ?? 0)).run();
      return Response.json({ ok: true });
    }
    if (!body.title?.trim()) return jsonError(new Error("课程名称不能为空"), 400);
    await getDatabase().prepare("INSERT INTO courses (owner_id,title,course_type,description,icon,sort_order) VALUES (?,?,?,?,?,(SELECT COUNT(*) FROM courses WHERE owner_id=?))").bind(ownerId, body.title.trim(), body.courseType || "custom", body.description?.trim() || "", body.icon || "book", ownerId).run();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { id?: number; title?: string; description?: string; status?: string; pinned?: boolean; sortOrder?: number };
    if (!body.id) return jsonError(new Error("缺少课程编号"), 400);
    const current = await getDatabase().prepare("SELECT * FROM courses WHERE id=? AND owner_id=?").bind(body.id, ownerId).first<Record<string, unknown>>();
    if (!current) return jsonError(new Error("课程不存在"), 404);
    await getDatabase().prepare("UPDATE courses SET title=?,description=?,status=?,pinned=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
      .bind(body.title?.trim() || current.title, body.description?.trim() ?? current.description, body.status || current.status, typeof body.pinned === "boolean" ? (body.pinned ? 1 : 0) : Number(current.pinned), Number.isFinite(body.sortOrder) ? body.sortOrder : Number(current.sort_order), body.id, ownerId).run();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id) return jsonError(new Error("缺少课程编号"), 400);
    const course = await getDatabase().prepare("SELECT course_type FROM courses WHERE id=? AND owner_id=?").bind(id, ownerId).first<{ course_type: string }>();
    if (course?.course_type === "nce") return jsonError(new Error("内置NCE课程可以隐藏，但不能删除"), 400);
    await getDatabase().batch([
      getDatabase().prepare("DELETE FROM course_resources WHERE course_id=? AND owner_id=?").bind(id, ownerId),
      getDatabase().prepare("DELETE FROM courses WHERE id=? AND owner_id=?").bind(id, ownerId),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
