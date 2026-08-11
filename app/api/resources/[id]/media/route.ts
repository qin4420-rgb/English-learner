import { initializeProcessingJob } from "@/app/api/_lib/resource-processing";
import { ensureDatabase, getDatabase, getMediaBucket, getOwnerId, jsonError } from "@/app/api/_lib/runtime";
import { normalizeResourceType, parseResourceMetadata, stringifyResourceMetadata } from "@/app/resource-model";

type Context = { params: Promise<{ id: string }> };
const MEDIA_TYPES = new Set(["Audio", "Video", "Podcast"]);

async function ownedMedia(id: number, ownerId: string) {
  const resource = await getDatabase().prepare("SELECT * FROM resources WHERE id=? AND owner_id=? AND collection='library'").bind(id, ownerId).first<Record<string, unknown>>();
  if (!resource || !MEDIA_TYPES.has(normalizeResourceType(resource.resource_type))) return null;
  return resource;
}

async function activeJob(ownerId: string, resourceId: number) {
  return getDatabase().prepare("SELECT id FROM processing_jobs WHERE owner_id=? AND result_resource_id=? AND status IN ('queued','running','processing','pausing','paused') ORDER BY id DESC LIMIT 1")
    .bind(ownerId, resourceId).first<{ id: number }>();
}

export async function GET(_request: Request, context: Context) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const { id } = await context.params;
    const resource = await ownedMedia(Number(id), ownerId);
    if (!resource) return jsonError(new Error("媒体资源不存在"), 404);
    const metadata = parseResourceMetadata(resource.metadata_json, resource.resource_type);
    const uploadId = Number(metadata.uploadId || 0);
    if (uploadId) {
      const upload = await getDatabase().prepare("SELECT object_key,content_type,filename FROM uploads WHERE id=? AND owner_id=?").bind(uploadId, ownerId).first<{ object_key: string; content_type: string; filename: string }>();
      if (!upload) return jsonError(new Error("原始媒体记录不存在"), 404);
      const object = await getMediaBucket().get(upload.object_key);
      if (!object) return jsonError(new Error("原始媒体文件不存在"), 404);
      return new Response(object.body, { headers: { "content-type": upload.content_type || "application/octet-stream", "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(upload.filename)}`, "cache-control": "private, max-age=300" } });
    }
    const source = String(metadata.media?.source || metadata.podcast?.audioUrl || resource.source_url || "");
    if (/^https?:/i.test(source)) return Response.redirect(source, 307);
    return jsonError(new Error("这个媒体没有可访问的播放来源"), 404);
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const { id } = await context.params;
    const resourceId = Number(id);
    const resource = await ownedMedia(resourceId, ownerId);
    if (!resource) return jsonError(new Error("媒体资源不存在"), 404);
    const type = normalizeResourceType(resource.resource_type);
    const metadata = parseResourceMetadata(resource.metadata_json, type);
    const contentType = request.headers.get("content-type") || "";
    let nextMetadata = metadata;
    let sourceName = String(resource.title || `媒体 #${resourceId}`);

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("subtitle");
      if (!(file instanceof File) || !file.size) return jsonError(new Error("请选择SRT或VTT字幕"), 400);
      const extension = file.name.toLowerCase().split(".").pop() || "";
      if (!["srt", "vtt"].includes(extension)) return jsonError(new Error("只支持SRT或VTT字幕"), 400);
      if (file.size > 5 * 1024 * 1024) return jsonError(new Error("字幕文件超过5MB安全限制"), 413);
      const objectKey = `${ownerId}/media-sidecars/resource-${resourceId}-${crypto.randomUUID()}.${extension}`;
      await getMediaBucket().put(objectKey, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || "text/plain; charset=utf-8" } });
      nextMetadata = { ...metadata, mediaDraftSegments: [], media: { ...metadata.media, sidecarSubtitleKey: objectKey, sidecarSubtitleType: extension, intensiveStatus: "queued", forceTranscriptSource: "", forceRegenerate: true } };
      sourceName = `${sourceName} · ${file.name}`;
    } else {
      const body = await request.json() as { action?: "request_intensive" | "reprocess_transcript" | "use_stt" };
      if (!body.action) return jsonError(new Error("缺少媒体操作"), 400);
      nextMetadata = {
        ...metadata,
        mediaDraftSegments: body.action === "request_intensive" ? metadata.mediaDraftSegments : [],
        media: {
          ...metadata.media,
          extensiveReady: true,
          intensiveStatus: "queued",
          forceTranscriptSource: body.action === "use_stt" ? "stt" : "",
          forceRegenerate: body.action === "reprocess_transcript",
        },
      };
    }

    const running = await activeJob(ownerId, resourceId);
    if (running && !contentType.includes("multipart/form-data")) return Response.json({ ok: true, resourceId, jobId: running.id, status: "already_queued" });
    await getDatabase().prepare("UPDATE resources SET metadata_json=?,processing_status='queued',translation_status='pending',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
      .bind(stringifyResourceMetadata(nextMetadata, type), resourceId, ownerId).run();
    const jobId = await initializeProcessingJob({
      ownerId, resourceId, inputType: resource.source_url ? "url" : "upload", sourceName,
      sourceUrl: String(resource.source_url || nextMetadata.media?.source || ""), uploadId: Number(nextMetadata.uploadId || 0) || null,
      startAt: contentType.includes("multipart/form-data") ? "extract" : "original",
    });
    return Response.json({ ok: true, resourceId, jobId, status: "queued" }, { status: 202 });
  } catch (error) { return jsonError(error); }
}
