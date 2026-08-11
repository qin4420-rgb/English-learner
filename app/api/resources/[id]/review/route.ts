import { normalizeReviewBlocks, parseReviewMarkdown, renderReviewMarkdown, validateArticleDraft } from "@/app/article-review.mjs";
import { normalizeResourceType, parseResourceMetadata, stringifyResourceMetadata } from "@/app/resource-model";
import type { ReviewBlock, ReviewIssue } from "@/app/types";
import { slugify, translateBlocksDetailed } from "@/app/api/_lib/distill";
import { saveMarkdownToOneDrive } from "@/app/api/_lib/onedrive";
import { ensureDatabase, getDatabase, getMediaBucket, getOwnerId, getRuntimeBindings, jsonError } from "@/app/api/_lib/runtime";

type Context = { params: Promise<{ id: string }> };
type ReviewAction = "save" | "validate" | "translate" | "aiReview" | "publish";

async function ownedResource(id: number, ownerId: string) {
  return getDatabase().prepare("SELECT * FROM resources WHERE id=? AND owner_id=? AND collection='library'").bind(id, ownerId).first<Record<string, unknown>>();
}

async function readMarkdown(key: string) {
  if (!key) return "";
  const object = await getMediaBucket().get(key);
  return object ? object.text() : "";
}

function mapResource(row: Record<string, unknown>) {
  const metadata = parseResourceMetadata(row.metadata_json, row.resource_type);
  return {
    id: Number(row.id), title: String(row.title), description: String(row.description || ""), category: String(row.category || "未分类"),
    level: String(row.level || "未分级"), skills: String(row.skills || "综合"), resourceType: normalizeResourceType(row.resource_type),
    learningUses: metadata.learningUses, tags: metadata.tags, url: String(row.url || ""), sourceName: String(row.source_name || ""), sourceUrl: String(row.source_url || ""),
    collection: String(row.collection || "library"), iconUrl: String(row.icon_url || ""), markdownObjectKey: String(row.markdown_object_key || ""), markdownPath: String(row.markdown_path || ""),
    processingStatus: String(row.processing_status || "ready"), translationStatus: String(row.translation_status || "none"), publishedAt: String(row.published_at || ""), issueDate: String(row.issue_date || ""),
    articleOrder: Number(row.article_order || 0), parentId: row.parent_id ? Number(row.parent_id) : null, readingFolderId: row.reading_folder_id ? Number(row.reading_folder_id) : null,
    metadataJson: String(row.metadata_json || "{}"), status: String(row.status || "active"), sortOrder: Number(row.sort_order || 0), isFavorite: Boolean(row.is_favorite),
    createdAt: String(row.created_at || ""), updatedAt: String(row.updated_at || ""),
  };
}

async function payloadFor(resource: Record<string, unknown>) {
  const type = normalizeResourceType(resource.resource_type);
  const metadata = parseResourceMetadata(resource.metadata_json, type);
  const draftMarkdown = await readMarkdown(String(metadata.reviewDraftObjectKey || ""));
  const publishedMarkdown = await readMarkdown(String(resource.markdown_object_key || ""));
  const manualEdited = new Set(metadata.manualEditedBlocks || metadata.review?.manualEditedBlocks || []);
  const blocks = parseReviewMarkdown(draftMarkdown || publishedMarkdown).map((block) => ({ ...block, manualEdited: manualEdited.has(block.id) }));
  const validation = validateArticleDraft(blocks);
  const review = metadata.review || { ...validation, manualEditedBlocks: metadata.manualEditedBlocks || [] };
  return { resource: mapResource(resource), draftMarkdown, publishedMarkdown, blocks, review, hasPublished: Boolean(resource.markdown_object_key) };
}

async function writeDraft(resource: Record<string, unknown>, ownerId: string, inputBlocks: ReviewBlock[], extraIssues: ReviewIssue[] = []) {
  const type = normalizeResourceType(resource.resource_type);
  const metadata = parseResourceMetadata(resource.metadata_json, type);
  const blocks = normalizeReviewBlocks(inputBlocks) as ReviewBlock[];
  const validation = validateArticleDraft(blocks);
  const issues = [...extraIssues, ...validation.issues].filter((issue, index, list) => list.findIndex((item) => item.id === issue.id) === index);
  const objectKey = String(metadata.reviewDraftObjectKey || `${ownerId}/review-drafts/resource-${resource.id}-${crypto.randomUUID()}.md`);
  const path = String(metadata.reviewDraftPath || `10_Library/_Review/${type.toLowerCase()}/resource-${resource.id}-draft.md`);
  const markdown = renderReviewMarkdown(blocks, {
    id: `resource-${resource.id}`, title: resource.title, sourceType: type, sourceUrl: resource.source_url,
    capturedAt: new Date().toISOString(), issueDate: resource.issue_date || "", pageCount: metadata.pageCount || 0, aiEnhanced: metadata.aiEnhanced,
  }, { summary: metadata.summary, themes: metadata.themes, vocabulary: metadata.candidateVocabulary });
  await getMediaBucket().put(objectKey, markdown, { httpMetadata: { contentType: "text/markdown; charset=utf-8" } });
  try { await saveMarkdownToOneDrive(ownerId, path, markdown); } catch { /* R2 remains the authoritative review draft. */ }
  const manualEditedBlocks = blocks.filter((block) => block.manualEdited).map((block) => block.id);
  const nextMetadata = stringifyResourceMetadata({
    ...metadata, reviewDraftObjectKey: objectKey, reviewDraftPath: path, reviewIssues: issues, manualEditedBlocks,
    review: { ...metadata.review, totalBlocks: validation.totalBlocks, translatedBlocks: validation.translatedBlocks, issues, manualEditedBlocks, checkedAt: validation.checkedAt },
  }, type);
  const translationStatus = validation.translatedBlocks === validation.totalBlocks && !issues.some((issue) => issue.severity === "error") ? "complete" : validation.translatedBlocks ? "partial" : "pending";
  await getDatabase().prepare("UPDATE resources SET metadata_json=?,processing_status='review_required',translation_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
    .bind(nextMetadata, translationStatus, resource.id, ownerId).run();
  return { blocks, validation: { ...validation, issues }, markdown, objectKey, path };
}

async function reviewWithAI(blocks: ReviewBlock[]) {
  const bindings = getRuntimeBindings();
  if (!bindings.DEEPSEEK_API_KEY) throw new Error("DeepSeek尚未配置");
  const selected = blocks.slice(0, 30).map((block) => ({ id: block.id, english: block.original, chinese: block.translation }));
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${bindings.DEEPSEEK_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: bindings.DEEPSEEK_MODEL || "deepseek-v4-pro", thinking: { type: "disabled" }, response_format: { type: "json_object" }, max_tokens: 6000,
      messages: [
        { role: "system", content: "你是双语文章复核员。检查漏译、误译、数字、日期、人名、地名、机构名、专业术语和明显语义错误。只输出JSON：{\"reviews\":[{\"id\":\"p0001\",\"status\":\"pass|warning\",\"issues\":[\"...\"],\"suggestedTranslation\":\"\"}]}。不得自动改写输入。" },
        { role: "user", content: JSON.stringify({ blocks: selected }) },
      ],
    }),
  });
  const data = await response.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || "AI审核失败");
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI没有返回审核结果");
  const parsed = JSON.parse(content) as { reviews?: { id?: string; status?: string; issues?: unknown[]; suggestedTranslation?: string }[] };
  return Object.fromEntries((parsed.reviews || []).filter((item) => selected.some((block) => block.id === item.id)).map((item) => [String(item.id), {
    status: item.status === "pass" ? "pass" : "warning", issues: Array.isArray(item.issues) ? item.issues.map(String).slice(0, 12) : [], suggestedTranslation: String(item.suggestedTranslation || ""),
  }]));
}

export async function GET(_request: Request, context: Context) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const { id } = await context.params;
    const resource = await ownedResource(Number(id), ownerId);
    if (!resource) return jsonError(new Error("资源不存在"), 404);
    return Response.json(await payloadFor(resource));
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const { id } = await context.params;
    let resource = await ownedResource(Number(id), ownerId);
    if (!resource) return jsonError(new Error("资源不存在"), 404);
    const body = await request.json() as { action?: ReviewAction; blocks?: ReviewBlock[]; blockIds?: string[]; overwriteManual?: boolean; force?: boolean };
    if (!body.action) return jsonError(new Error("缺少复核操作"), 400);
    const current = await payloadFor(resource);
    const sourceBlocks = Array.isArray(body.blocks) ? body.blocks : current.blocks;

    if (body.action === "save" || body.action === "validate") {
      await writeDraft(resource, ownerId, sourceBlocks);
    } else if (body.action === "translate") {
      const selected = new Set(body.blockIds?.length ? body.blockIds : sourceBlocks.filter((block) => !block.translation).map((block) => block.id));
      const targets = sourceBlocks.filter((block) => selected.has(block.id) && (body.overwriteManual || !block.manualEdited));
      const run = await translateBlocksDetailed(targets.map((block) => ({ id: block.id, text: block.original })));
      const translated = sourceBlocks.map((block) => run.translations.has(block.id) ? { ...block, translation: run.translations.get(block.id) || block.translation } : block);
      await writeDraft(resource, ownerId, translated, run.issues);
    } else if (body.action === "aiReview") {
      const metadata = parseResourceMetadata(resource.metadata_json, resource.resource_type);
      const selected = new Set(body.blockIds?.length ? body.blockIds : (metadata.review?.issues || []).map((issue) => issue.blockId).filter(Boolean));
      const targets = sourceBlocks.filter((block) => selected.has(block.id));
      if (!targets.length) return jsonError(new Error("请选择要审核的Block"), 400);
      const reviews = await reviewWithAI(targets);
      const nextMetadata = stringifyResourceMetadata({ ...metadata, review: { ...metadata.review, aiReviews: { ...(metadata.review?.aiReviews || {}), ...reviews } } }, resource.resource_type);
      await getDatabase().prepare("UPDATE resources SET metadata_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(nextMetadata, resource.id, ownerId).run();
    } else if (body.action === "publish") {
      const saved = await writeDraft(resource, ownerId, sourceBlocks);
      const errors = saved.validation.issues.filter((issue) => issue.severity === "error");
      if (errors.length && !body.force) return Response.json({ error: `仍有${errors.length}个错误，默认不能发布`, issues: errors }, { status: 409 });
      resource = await ownedResource(Number(id), ownerId) as Record<string, unknown>;
      const type = normalizeResourceType(resource.resource_type);
      const metadata = parseResourceMetadata(resource.metadata_json, type);
      const previousPublished = [...(metadata.review?.previousPublished || [])];
      if (resource.markdown_object_key) previousPublished.push({ objectKey: String(resource.markdown_object_key), path: String(resource.markdown_path || ""), publishedAt: new Date().toISOString() });
      const publishedAt = new Date().toISOString();
      const publishedPath = `10_Library/${type.toLowerCase()}/${publishedAt.slice(0, 4)}/${slugify(String(resource.title || `resource-${resource.id}`))}.md`;
      try { await saveMarkdownToOneDrive(ownerId, publishedPath, saved.markdown); } catch { /* R2 stays readable if OneDrive is temporarily unavailable. */ }
      const nextMetadata = stringifyResourceMetadata({
        ...metadata, reviewDraftObjectKey: "", reviewDraftPath: "", reviewIssues: saved.validation.issues,
        review: { ...metadata.review, totalBlocks: saved.validation.totalBlocks, translatedBlocks: saved.validation.translatedBlocks, issues: saved.validation.issues, checkedAt: saved.validation.checkedAt, previousPublished: previousPublished.slice(-10), lastPublishedAt: publishedAt },
      }, type);
      const translationStatus = saved.validation.translatedBlocks === saved.validation.totalBlocks ? "complete" : "partial";
      await getDatabase().batch([
        getDatabase().prepare("UPDATE resources SET markdown_object_key=?,markdown_path=?,metadata_json=?,processing_status='ready',translation_status=?,published_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
          .bind(saved.objectKey, publishedPath, nextMetadata, translationStatus, publishedAt, resource.id, ownerId),
        getDatabase().prepare("UPDATE processing_jobs SET status='complete',stage='人工复核后已发布',progress=100,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND result_resource_id=? AND status='review_required'").bind(ownerId, resource.id),
      ]);
    }
    resource = await ownedResource(Number(id), ownerId) as Record<string, unknown>;
    return Response.json({ ok: true, ...(await payloadFor(resource)) });
  } catch (error) { return jsonError(error); }
}
