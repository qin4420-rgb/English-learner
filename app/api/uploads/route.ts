import { ensureDatabase, getDatabase, getMediaBucket, getOwnerId, jsonError } from "@/app/api/_lib/runtime";
import { saveOriginalToOneDrive } from "@/app/api/_lib/onedrive";

export async function GET() {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const result = await getDatabase().prepare("SELECT id,filename,content_type,size_bytes,storage_provider,external_path,status,delete_after,created_at FROM uploads WHERE owner_id=? ORDER BY created_at DESC").bind(ownerId).all();
    return Response.json({ uploads: (result.results as Record<string, unknown>[]).map((row) => ({
      id: Number(row.id), filename: String(row.filename), contentType: String(row.content_type), sizeBytes: Number(row.size_bytes), storageProvider: String(row.storage_provider ?? "r2"), externalPath: String(row.external_path ?? ""), status: String(row.status ?? "uploaded"), deleteAfter: String(row.delete_after ?? ""), createdAt: String(row.created_at), url: `/api/uploads/${row.id}`,
    })) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError(new Error("请选择要上传的文件"), 400);
    if (file.size > 25 * 1024 * 1024) return jsonError(new Error("网页维护窗口单个文件暂限 25MB；更大的音视频请放对象存储或网盘后添加链接"), 413);
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120) || "file";
    const objectKey = `${ownerId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
    const bytes = await file.arrayBuffer();
    await getMediaBucket().put(objectKey, bytes, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
    let storageProvider = "r2";
    let externalItemId = "";
    let externalPath = "";
    let status = "uploaded";
    const connection = await getDatabase().prepare("SELECT status FROM onedrive_connections WHERE owner_id=?").bind(ownerId).first<{ status: string }>();
    if (connection?.status === "connected") {
      try {
        const uploaded = await saveOriginalToOneDrive(ownerId, file.name, bytes, file.type || "application/octet-stream");
        storageProvider = "onedrive+r2";
        externalItemId = uploaded.itemId;
        externalPath = uploaded.path;
        status = "ready_for_processing";
      } catch {
        status = "onedrive_pending";
      }
    }
    const result = await getDatabase().prepare("INSERT INTO uploads (owner_id,filename,object_key,content_type,size_bytes,storage_provider,external_item_id,external_path,status) VALUES (?,?,?,?,?,?,?,?,?)").bind(ownerId, file.name, objectKey, file.type || "application/octet-stream", file.size, storageProvider, externalItemId, externalPath, status).run();
    return Response.json({ ok: true, id: result.meta.last_row_id, storageProvider, status });
  } catch (error) {
    return jsonError(error);
  }
}
