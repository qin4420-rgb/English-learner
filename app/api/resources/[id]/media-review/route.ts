import { translateBlocksDetailed } from "@/app/api/_lib/distill";
import { ensureDatabase, getDatabase, getMediaBucket, getOwnerId, getRuntimeBindings, jsonError } from "@/app/api/_lib/runtime";
import { normalizeMediaSegments, validateMediaDraft } from "@/app/media-processing.mjs";
import { normalizeResourceType, parseResourceMetadata, stringifyResourceMetadata } from "@/app/resource-model";
import type { MediaReviewPayload, MediaSegment, ResourceItem, ReviewIssue } from "@/app/types";

type Context = { params: Promise<{ id: string }> };
type ReviewAction = "save" | "validate" | "translate" | "aiReview" | "publish";
const MEDIA_TYPES = new Set(["Audio", "Video", "Podcast"]);

async function ownedResource(id: number, ownerId: string) {
  const resource = await getDatabase().prepare("SELECT * FROM resources WHERE id=? AND owner_id=? AND collection='library'").bind(id, ownerId).first<Record<string, unknown>>();
  return resource && MEDIA_TYPES.has(normalizeResourceType(resource.resource_type)) ? resource : null;
}

function mapResource(row: Record<string, unknown>): ResourceItem {
  const metadata = parseResourceMetadata(row.metadata_json, row.resource_type);
  return {
    id: Number(row.id), title: String(row.title), description: String(row.description || ""), category: String(row.category || "未分类"), level: String(row.level || "未分级"), skills: String(row.skills || "综合"),
    resourceType: normalizeResourceType(row.resource_type), learningUses: metadata.learningUses, tags: metadata.tags, url: String(row.url || ""), sourceName: String(row.source_name || ""), sourceUrl: String(row.source_url || ""),
    collection: String(row.collection || "library"), iconUrl: String(row.icon_url || ""), markdownObjectKey: String(row.markdown_object_key || ""), markdownPath: String(row.markdown_path || ""), processingStatus: String(row.processing_status || "ready"),
    translationStatus: String(row.translation_status || "none"), publishedAt: String(row.published_at || ""), issueDate: String(row.issue_date || ""), articleOrder: Number(row.article_order || 0), parentId: row.parent_id ? Number(row.parent_id) : null,
    readingFolderId: row.reading_folder_id ? Number(row.reading_folder_id) : null, metadataJson: String(row.metadata_json || "{}"), status: String(row.status || "active"), sortOrder: Number(row.sort_order || 0), isFavorite: Boolean(row.is_favorite),
    createdAt: String(row.created_at || ""), updatedAt: String(row.updated_at || ""),
  };
}

function mediaSource(resource: Record<string, unknown>, metadata: ReturnType<typeof parseResourceMetadata>) {
  if (metadata.uploadId) return `/api/resources/${resource.id}/media`;
  return String(metadata.media?.source || metadata.podcast?.audioUrl || resource.source_url || "");
}

function payloadFor(resource: Record<string, unknown>): MediaReviewPayload {
  const type = normalizeResourceType(resource.resource_type);
  const metadata = parseResourceMetadata(resource.metadata_json, type);
  const sourceUrl = mediaSource(resource, metadata);
  const segments = normalizeMediaSegments(metadata.mediaDraftSegments?.length ? metadata.mediaDraftSegments : metadata.mediaSegments, { durationMs: Number(metadata.media?.durationMs || metadata.podcast?.durationMs || 0) });
  const review = validateMediaDraft(segments, { durationMs: Number(metadata.media?.durationMs || metadata.podcast?.durationMs || 0), mediaKind: String(metadata.media?.kind || (type === "Video" ? "video" : "audio")), playableSource: sourceUrl, transcriptSource: String(metadata.media?.transcriptSource || "") });
  return {
    resource: mapResource(resource), kind: type === "Video" ? "video" : "audio", sourceUrl, segments,
    publishedSegments: metadata.mediaSegments, review: metadata.mediaReview || review,
    media: { durationMs: Number(metadata.media?.durationMs || metadata.podcast?.durationMs || 0), transcriptSource: String(metadata.media?.transcriptSource || ""), intensiveStatus: String(metadata.media?.intensiveStatus || "review_required"), extensiveReady: Boolean(metadata.media?.extensiveReady ?? true), playable: Boolean(metadata.media?.playable ?? sourceUrl) },
    hasPublished: Boolean(metadata.mediaSegments.length),
  };
}

async function writeDraft(resource: Record<string, unknown>, ownerId: string, inputSegments: MediaSegment[], extraIssues: ReviewIssue[] = []) {
  const type = normalizeResourceType(resource.resource_type);
  const metadata = parseResourceMetadata(resource.metadata_json, type);
  const segments = normalizeMediaSegments(inputSegments, { durationMs: Number(metadata.media?.durationMs || metadata.podcast?.durationMs || 0) });
  const sourceUrl = mediaSource(resource, metadata);
  const checked = validateMediaDraft(segments, { durationMs: Number(metadata.media?.durationMs || metadata.podcast?.durationMs || 0), mediaKind: String(metadata.media?.kind || (type === "Video" ? "video" : "audio")), playableSource: sourceUrl, transcriptSource: String(metadata.media?.transcriptSource || "") });
  const validation = { ...checked, issues: [...extraIssues, ...checked.issues].filter((issue, index, list) => list.findIndex((item) => item.id === issue.id) === index) };
  const objectKey = String(metadata.media?.draftArtifactKey || `${ownerId}/media-review/resource-${resource.id}-${crypto.randomUUID()}.json`);
  await getMediaBucket().put(objectKey, JSON.stringify({ media: metadata.media, segments, review: validation, savedAt: new Date().toISOString() }), { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  const nextMetadata = stringifyResourceMetadata({ ...metadata, mediaDraftSegments: segments, mediaReview: validation, reviewIssues: validation.issues, media: { ...metadata.media, draftArtifactKey: objectKey, intensiveStatus: "review_required", segmentCount: segments.length } }, type);
  const translationStatus = validation.translatedSegments === validation.totalSegments ? "complete" : validation.translatedSegments ? "partial" : "pending";
  await getDatabase().prepare("UPDATE resources SET metadata_json=?,processing_status='review_required',translation_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
    .bind(nextMetadata, translationStatus, resource.id, ownerId).run();
  return { segments, validation, objectKey };
}

async function reviewWithAI(segments: MediaSegment[]): Promise<ReviewIssue[]> {
  const bindings = getRuntimeBindings();
  if (!bindings.DEEPSEEK_API_KEY) throw new Error("DeepSeek尚未配置");
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST", headers: { authorization: `Bearer ${bindings.DEEPSEEK_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: bindings.DEEPSEEK_MODEL || "deepseek-v4-pro", thinking: { type: "disabled" }, response_format: { type: "json_object" }, max_tokens: 4000,
      messages: [
        { role: "system", content: "你是英语精听字幕复核员。检查英文识别错误、明显漏词、中文误译和时间跨度异常。不得改写原文。只输出JSON：{\"issues\":[{\"id\":\"s0001\",\"severity\":\"warning|error|info\",\"message\":\"...\"}]}" },
        { role: "user", content: JSON.stringify({ segments: segments.slice(0, 30).map((segment) => ({ id: segment.id, startMs: segment.startMs, endMs: segment.endMs, english: segment.originalText, chinese: segment.translationText || "" })) }) },
      ],
    }),
  });
  const data = await response.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || "媒体AI检查失败");
  const parsed = JSON.parse(String(data.choices?.[0]?.message?.content || "{}")) as { issues?: { id?: string; severity?: string; message?: string }[] };
  return (parsed.issues || []).filter((issue) => segments.some((segment) => segment.id === issue.id) && issue.message).map((issue, index) => ({ id: `ai-media-${issue.id}-${index}`, blockId: String(issue.id), severity: issue.severity === "error" ? "error" : issue.severity === "info" ? "info" : "warning", type: "ai_media_review", message: String(issue.message) }));
}

export async function GET(_request: Request, context: Context) {
  try {
    await ensureDatabase(); const ownerId = await getOwnerId(); const { id } = await context.params;
    const resource = await ownedResource(Number(id), ownerId);
    if (!resource) return jsonError(new Error("媒体资源不存在"), 404);
    return Response.json(payloadFor(resource));
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    await ensureDatabase(); const ownerId = await getOwnerId(); const { id } = await context.params;
    let resource = await ownedResource(Number(id), ownerId);
    if (!resource) return jsonError(new Error("媒体资源不存在"), 404);
    const body = await request.json() as { action?: ReviewAction; segments?: MediaSegment[]; segmentIds?: string[]; force?: boolean };
    if (!body.action) return jsonError(new Error("缺少复核操作"), 400);
    const current = payloadFor(resource);
    let segments = Array.isArray(body.segments) ? body.segments : current.segments;
    let extraIssues: ReviewIssue[] = [];
    if (body.action === "translate") {
      const selected = new Set(body.segmentIds?.length ? body.segmentIds : segments.filter((segment) => !segment.translationText).map((segment) => segment.id));
      const targets = segments.filter((segment) => selected.has(segment.id));
      const result = await translateBlocksDetailed(targets.map((segment) => ({ id: segment.id, text: segment.originalText })));
      segments = segments.map((segment) => result.translations.has(segment.id) ? { ...segment, translationText: result.translations.get(segment.id) || segment.translationText } : segment);
    } else if (body.action === "aiReview") {
      const selected = new Set(body.segmentIds?.length ? body.segmentIds : segments.map((segment) => segment.id));
      extraIssues = await reviewWithAI(segments.filter((segment) => selected.has(segment.id)));
    }
    const saved = await writeDraft(resource, ownerId, segments, extraIssues);
    if (body.action === "publish") {
      const errors = saved.validation.issues.filter((issue) => issue.severity === "error");
      if (errors.length && !body.force) return Response.json({ error: `仍有${errors.length}个错误，默认不能发布`, issues: errors }, { status: 409 });
      resource = await ownedResource(Number(id), ownerId) as Record<string, unknown>;
      const type = normalizeResourceType(resource.resource_type);
      const metadata = parseResourceMetadata(resource.metadata_json, type);
      const previousPublished = [...(metadata.media?.previousPublished || [])];
      if (metadata.mediaSegments.length) previousPublished.push({ segments: metadata.mediaSegments, publishedAt: String(resource.published_at || new Date().toISOString()), transcriptSource: metadata.media?.transcriptSource });
      const publishedAt = new Date().toISOString();
      const nextMetadata = stringifyResourceMetadata({
        ...metadata, mediaSegments: saved.segments, mediaDraftSegments: [], mediaReview: saved.validation,
        media: { ...metadata.media, intensiveStatus: "ready", segmentCount: saved.segments.length, transcriptAvailable: true, previousPublished: previousPublished.slice(-5), draftArtifactKey: "" },
        podcast: metadata.podcast ? { ...metadata.podcast, intensiveStatus: "ready" } : metadata.podcast,
      }, type);
      await getDatabase().batch([
        getDatabase().prepare("UPDATE resources SET metadata_json=?,processing_status='ready',translation_status='complete',published_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(nextMetadata, publishedAt, resource.id, ownerId),
        getDatabase().prepare("UPDATE processing_jobs SET status='completed',stage='媒体复核后已发布',progress=100,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND result_resource_id=? AND status='review_required'").bind(ownerId, resource.id),
        getDatabase().prepare("UPDATE processing_job_steps SET status='completed',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND job_id IN (SELECT id FROM processing_jobs WHERE owner_id=? AND result_resource_id=?) AND step_key IN ('review','publish')").bind(ownerId, ownerId, resource.id),
        getDatabase().prepare("UPDATE processing_job_steps SET status='skipped',detail_json=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND job_id IN (SELECT id FROM processing_jobs WHERE owner_id=? AND result_resource_id=?) AND step_key='sync'").bind(JSON.stringify({ reason: "媒体Metadata由R2正式保存；原媒体引用不重复同步" }), ownerId, ownerId, resource.id),
      ]);
    }
    resource = await ownedResource(Number(id), ownerId) as Record<string, unknown>;
    return Response.json({ ok: true, ...payloadFor(resource) });
  } catch (error) { return jsonError(error); }
}
