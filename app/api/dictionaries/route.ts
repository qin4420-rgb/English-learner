import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";

function mapSource(row: Record<string, unknown>) {
  return { id: Number(row.id), resourceId: Number(row.resource_id), name: String(row.name), enabled: Boolean(row.enabled), sortOrder: Number(row.sort_order || 0), entryCount: Number(row.entry_count || 0), createdAt: String(row.created_at || "") };
}

export async function GET() {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const result = await getDatabase().prepare(`SELECT s.*,COUNT(e.id) AS entry_count FROM dictionary_sources s LEFT JOIN dictionary_entries e ON e.source_id=s.id WHERE s.owner_id=? GROUP BY s.id ORDER BY s.sort_order,s.id`).bind(ownerId).all();
    return Response.json({ sources: (result.results as Record<string, unknown>[]).map(mapSource) });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { id?: number; enabled?: boolean; direction?: "up" | "down" };
    if (!body.id) return jsonError(new Error("缺少词典编号"), 400);
    const current = await getDatabase().prepare("SELECT * FROM dictionary_sources WHERE id=? AND owner_id=?").bind(body.id, ownerId).first<Record<string, unknown>>();
    if (!current) return jsonError(new Error("词典不存在"), 404);
    if (typeof body.enabled === "boolean") await getDatabase().prepare("UPDATE dictionary_sources SET enabled=? WHERE id=? AND owner_id=?").bind(body.enabled ? 1 : 0, body.id, ownerId).run();
    if (body.direction) {
      const operator = body.direction === "up" ? "<" : ">";
      const order = body.direction === "up" ? "DESC" : "ASC";
      const neighbor = await getDatabase().prepare(`SELECT id,sort_order FROM dictionary_sources WHERE owner_id=? AND sort_order ${operator} ? ORDER BY sort_order ${order},id ${order} LIMIT 1`).bind(ownerId, Number(current.sort_order || 0)).first<{ id: number; sort_order: number }>();
      if (neighbor) await getDatabase().batch([
        getDatabase().prepare("UPDATE dictionary_sources SET sort_order=? WHERE id=? AND owner_id=?").bind(neighbor.sort_order, body.id, ownerId),
        getDatabase().prepare("UPDATE dictionary_sources SET sort_order=? WHERE id=? AND owner_id=?").bind(Number(current.sort_order || 0), neighbor.id, ownerId),
      ]);
    }
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
