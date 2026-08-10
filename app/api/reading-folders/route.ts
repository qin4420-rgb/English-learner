import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";

function mapFolder(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    name: String(row.name),
    sortOrder: Number(row.sort_order ?? 0),
    articleCount: Number(row.article_count ?? 0),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function GET() {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const result = await getDatabase().prepare(`SELECT f.*, COUNT(r.id) AS article_count
      FROM reading_folders f
      LEFT JOIN resources r
        ON r.owner_id=f.owner_id
        AND r.reading_folder_id=f.id
        AND r.collection='library'
        AND r.markdown_object_key!=''
      WHERE f.owner_id=?
      GROUP BY f.id
      ORDER BY f.sort_order,f.created_at,f.id`).bind(ownerId).all();
    return Response.json({ folders: (result.results as Record<string, unknown>[]).map(mapFolder) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { name?: string };
    const name = body.name?.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name) return jsonError(new Error("文件夹名称不能为空"), 400);
    const existing = await getDatabase().prepare("SELECT id FROM reading_folders WHERE owner_id=? AND name=?").bind(ownerId, name).first();
    if (existing) return jsonError(new Error("已经有同名文件夹"), 409);
    const orderRow = await getDatabase().prepare("SELECT COALESCE(MAX(sort_order),-1)+1 AS next_order FROM reading_folders WHERE owner_id=?").bind(ownerId).first<{ next_order?: number }>();
    const result = await getDatabase().prepare("INSERT INTO reading_folders (owner_id,name,sort_order) VALUES (?,?,?)").bind(ownerId, name, Number(orderRow?.next_order ?? 0)).run();
    return Response.json({ ok: true, id: Number(result.meta.last_row_id) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { id?: number; name?: string; resourceId?: number; folderId?: number | null };

    if (body.resourceId) {
      const folderId = body.folderId ? Number(body.folderId) : null;
      if (folderId) {
        const folder = await getDatabase().prepare("SELECT id FROM reading_folders WHERE id=? AND owner_id=?").bind(folderId, ownerId).first();
        if (!folder) return jsonError(new Error("目标文件夹不存在"), 404);
      }
      const resource = await getDatabase().prepare("SELECT id FROM resources WHERE id=? AND owner_id=? AND collection='library'").bind(body.resourceId, ownerId).first();
      if (!resource) return jsonError(new Error("文章不存在"), 404);
      await getDatabase().prepare("UPDATE resources SET reading_folder_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(folderId, body.resourceId, ownerId).run();
      return Response.json({ ok: true });
    }

    if (!body.id) return jsonError(new Error("缺少文件夹编号"), 400);
    const name = body.name?.replace(/\s+/g, " ").trim().slice(0, 60);
    if (!name) return jsonError(new Error("文件夹名称不能为空"), 400);
    const duplicate = await getDatabase().prepare("SELECT id FROM reading_folders WHERE owner_id=? AND name=? AND id!=?").bind(ownerId, name, body.id).first();
    if (duplicate) return jsonError(new Error("已经有同名文件夹"), 409);
    await getDatabase().prepare("UPDATE reading_folders SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(name, body.id, ownerId).run();
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
    if (!id) return jsonError(new Error("缺少文件夹编号"), 400);
    await getDatabase().batch([
      getDatabase().prepare("UPDATE resources SET reading_folder_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND reading_folder_id=?").bind(ownerId, id),
      getDatabase().prepare("DELETE FROM reading_folders WHERE owner_id=? AND id=?").bind(ownerId, id),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
