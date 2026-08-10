import {
  ensureDatabase,
  getDatabase,
  getMediaBucket,
  getOwnerId,
  jsonError,
} from "@/app/api/_lib/runtime";
import { saveMarkdownToOneDrive } from "@/app/api/_lib/onedrive";

type Context = { params: Promise<{ id: string }> };

async function ownedResource(id: number, ownerId: string) {
  return getDatabase()
    .prepare("SELECT id,title,markdown_object_key,markdown_path,source_url,translation_status FROM resources WHERE id=? AND owner_id=? AND collection='library'")
    .bind(id, ownerId)
    .first<Record<string, unknown>>();
}

export async function GET(_request: Request, context: Context) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const { id } = await context.params;
    const resource = await ownedResource(Number(id), ownerId);
    if (!resource) return Response.json({ error: "文章不存在" }, { status: 404 });
    const key = String(resource.markdown_object_key || "");
    if (!key) return Response.json({ resource, markdown: "" });
    const object = await getMediaBucket().get(key);
    return Response.json({
      resource,
      markdown: object ? await object.text() : "",
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const { id } = await context.params;
    const resource = await ownedResource(Number(id), ownerId);
    if (!resource) return Response.json({ error: "文章不存在" }, { status: 404 });
    const body = await request.json() as { markdown?: string };
    const markdown = body.markdown?.trim();
    if (!markdown) return jsonError(new Error("Markdown 内容不能为空"), 400);
    const key = String(resource.markdown_object_key || `${ownerId}/markdown/resource-${id}.md`);
    const path = String(resource.markdown_path || `10_Library/articles/resource-${id}.md`);
    await getMediaBucket().put(key, markdown, {
      httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    });
    let syncStatus = "pending";
    try {
      await saveMarkdownToOneDrive(ownerId, path, markdown);
      syncStatus = "synced";
    } catch {
      syncStatus = "pending";
    }
    await getDatabase()
      .prepare("UPDATE resources SET markdown_object_key=?,markdown_path=?,processing_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
      .bind(key, path, syncStatus === "synced" ? "ready" : "sync_pending", Number(id), ownerId)
      .run();
    return Response.json({ ok: true, syncStatus });
  } catch (error) {
    return jsonError(error);
  }
}
