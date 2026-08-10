import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";

export async function GET() {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const result = await getDatabase().prepare("SELECT * FROM learning_plans WHERE owner_id=? ORDER BY status, due_date IS NULL, due_date, created_at DESC").bind(ownerId).all();
    const plans = (result.results as Record<string, unknown>[]).map((row) => ({
      id: Number(row.id),
      title: String(row.title),
      planType: String(row.plan_type),
      referenceId: String(row.reference_id ?? ""),
      dueDate: row.due_date ? String(row.due_date) : "",
      status: String(row.status),
      createdAt: String(row.created_at),
    }));
    return Response.json({ plans });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { id?: number; title?: string; planType?: string; referenceId?: string; dueDate?: string; status?: string };
    if (!body.title?.trim()) return jsonError(new Error("计划名称不能为空"), 400);
    if (body.id) {
      await getDatabase().prepare("UPDATE learning_plans SET title=?, plan_type=?, reference_id=?, due_date=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
        .bind(body.title.trim(), body.planType || "课程", body.referenceId || "", body.dueDate || null, body.status || "todo", body.id, ownerId).run();
    } else {
      await getDatabase().prepare("INSERT INTO learning_plans (owner_id,title,plan_type,reference_id,due_date,status) VALUES (?,?,?,?,?,?)")
        .bind(ownerId, body.title.trim(), body.planType || "课程", body.referenceId || "", body.dueDate || null, body.status || "todo").run();
    }
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { id?: number; status?: string };
    if (!body.id || !body.status) return jsonError(new Error("计划信息不完整"), 400);
    await getDatabase().prepare("UPDATE learning_plans SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(body.status, body.id, ownerId).run();
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
    if (!id) return jsonError(new Error("缺少计划编号"), 400);
    await getDatabase().prepare("DELETE FROM learning_plans WHERE id=? AND owner_id=?").bind(id, ownerId).run();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

