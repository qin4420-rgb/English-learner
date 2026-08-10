import { ensureDatabase, getDatabase, getMediaBucket, getOwnerId, jsonError } from "@/app/api/_lib/runtime";
import { moveOneDriveItemToRecycleBin } from "@/app/api/_lib/onedrive";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const { id } = await context.params;
    const row = await getDatabase().prepare("SELECT * FROM uploads WHERE id=? AND owner_id=?").bind(Number(id), ownerId).first<Record<string, unknown>>();
    if (!row) return Response.json({ error: "文件不存在" }, { status: 404 });
    const object = await getMediaBucket().get(String(row.object_key));
    if (!object) return Response.json({ error: "文件内容不存在" }, { status: 404 });
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(String(row.filename))}`);
    headers.set("cache-control", "private, max-age=300");
    return new Response(object.body, { headers });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const { id } = await context.params;
    const row = await getDatabase().prepare("SELECT object_key,external_item_id FROM uploads WHERE id=? AND owner_id=?").bind(Number(id), ownerId).first<Record<string, unknown>>();
    if (!row) return Response.json({ error: "文件不存在" }, { status: 404 });
    if (row.external_item_id) {
      await moveOneDriveItemToRecycleBin(ownerId, String(row.external_item_id));
    }
    await getMediaBucket().delete(String(row.object_key));
    await getDatabase().prepare("DELETE FROM uploads WHERE id=? AND owner_id=?").bind(Number(id), ownerId).run();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
