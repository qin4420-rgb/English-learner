import { normalizeResourceType, parseResourceMetadata, stringifyResourceMetadata } from "@/app/resource-model";
import { canonicalBlocks, renderReviewMarkdown, validateArticleDraft } from "@/app/article-review.mjs";
import { distillDocument, extractUploadedText, extractWebPage, slugify, translateBlocksDetailed } from "./distill";
import { saveMarkdownToOneDrive } from "./onedrive";
import { runOCR, runSTT, runSTTUrl } from "./providers";
import { getDatabase, getMediaBucket, getRuntimeBindings } from "./runtime";

type ProcessInput = { ownerId: string; resourceId: number; jobId: number; inputType?: "url" | "upload"; uploadId?: number | null; sourceUrl?: string };

async function setNeedsProvider(input: ProcessInput, provider: "OCR" | "STT", message: string) {
  await getDatabase().batch([
    getDatabase().prepare("UPDATE resources SET processing_status='needs_provider',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(input.resourceId, input.ownerId),
    getDatabase().prepare("UPDATE processing_jobs SET status='needs_provider',stage=?,error=?,progress=20,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(`${provider}待配置`, message, input.jobId, input.ownerId),
  ]);
  return { status: "needs_provider" as const, provider };
}

export async function processResource(input: ProcessInput) {
  const database = getDatabase();
  const resource = await database.prepare("SELECT * FROM resources WHERE id=? AND owner_id=?").bind(input.resourceId, input.ownerId).first<Record<string, unknown>>();
  if (!resource) throw new Error("Resource不存在");
  const type = normalizeResourceType(resource.resource_type);
  const metadata = parseResourceMetadata(resource.metadata_json, type);
  let upload: Record<string, unknown> | null = null;
  let bytes: ArrayBuffer | null = null;
  if (input.uploadId) {
    upload = await database.prepare("SELECT * FROM uploads WHERE id=? AND owner_id=?").bind(input.uploadId, input.ownerId).first<Record<string, unknown>>();
    if (!upload) throw new Error("上传文件不存在");
    const object = await getMediaBucket().get(String(upload.object_key));
    if (!object) throw new Error("原文件内容不存在");
    bytes = await object.arrayBuffer();
  }
  await database.prepare("UPDATE processing_jobs SET status='processing',stage=?,progress=15,error='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(["Audio", "Video"].includes(type) ? "STT文字稿" : type === "Image" ? "OCR识别" : "提取文字", input.jobId, input.ownerId).run();

  try {
    let title = String(resource.title || upload?.filename || "学习资料");
    let text = "";
    let pageCount: number | undefined;
    let rawSegments: unknown[] = [];
    if (type === "Article" && input.sourceUrl) {
      const extracted = await extractWebPage(input.sourceUrl);
      title = extracted.title;
      text = extracted.text;
    } else if (type === "Image") {
      if (!getRuntimeBindings().OCR_ENDPOINT || !getRuntimeBindings().OCR_PROVIDER) return setNeedsProvider(input, "OCR", "图片已保留；配置OCR Provider后可重新处理");
      text = await runOCR(bytes!, String(upload?.content_type || "application/octet-stream"), String(upload?.filename || title));
    } else if (["Audio", "Video"].includes(type)) {
      if (!getRuntimeBindings().STT_ENDPOINT || !getRuntimeBindings().STT_PROVIDER) return setNeedsProvider(input, "STT", "媒体可继续播放；配置STT Provider后可生成文字稿");
      const transcribed = bytes
        ? await runSTT(bytes, String(upload?.content_type || "application/octet-stream"), String(upload?.filename || title))
        : await runSTTUrl(input.sourceUrl || String(resource.source_url || resource.url));
      text = transcribed.text || transcribed.segments.map((segment) => String((segment as Record<string, unknown>).text || (segment as Record<string, unknown>).originalText || "")).filter(Boolean).join("\n\n");
      rawSegments = transcribed.segments;
    } else if (bytes && upload) {
      try {
        const extracted = await extractUploadedText(bytes, String(upload.filename), String(upload.content_type));
        title = extracted.title;
        text = extracted.text;
        pageCount = extracted.pageCount;
      } catch (error) {
        if (type === "PDF" && /OCR|扫描/.test((error as Error).message)) {
          if (!getRuntimeBindings().OCR_ENDPOINT || !getRuntimeBindings().OCR_PROVIDER) return setNeedsProvider(input, "OCR", "扫描PDF已保留；配置OCR Provider后可重新处理");
          text = await runOCR(bytes, String(upload.content_type), String(upload.filename));
        } else throw error;
      }
    }
    if (text.trim().length < 20) throw new Error("可识别文字过短，原始资料已保留等待复核");
    await database.prepare("UPDATE processing_jobs SET stage='AI元数据整理与分段翻译',progress=52,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(input.jobId, input.ownerId).run();
    const distilled = await distillDocument(title, text, pageCount);
    const originalBlocks = canonicalBlocks(distilled.original);
    const translationRun = await translateBlocksDetailed(originalBlocks.map((block) => ({ id: block.id, text: block.original })));
    const reviewBlocks = originalBlocks.map((block) => ({ ...block, translation: translationRun.translations.get(block.id) || "" }));
    const validation = validateArticleDraft(reviewBlocks);
    const reviewIssues = [...translationRun.issues, ...validation.issues].filter((issue, index, list) => list.findIndex((item) => item.id === issue.id) === index);
    const capturedAt = new Date().toISOString();
    const date = capturedAt.slice(0, 10);
    const objectKey = `${input.ownerId}/review-drafts/${date}/${crypto.randomUUID()}-${slugify(distilled.title)}.md`;
    const path = `10_Library/_Review/${type.toLowerCase()}/${date.slice(0, 4)}/${date}/${slugify(distilled.title)}-draft.md`;
    const markdown = renderReviewMarkdown(reviewBlocks, {
      id: `resource-${input.resourceId}`,
      title: distilled.title,
      sourceType: type,
      sourceUrl: input.sourceUrl || String(resource.source_url || ""),
      capturedAt,
      pageCount: distilled.pageCount || 0,
      aiEnhanced: distilled.aiEnhanced,
    }, { summary: distilled.summary, themes: distilled.themes, vocabulary: distilled.vocabulary });
    await getMediaBucket().put(objectKey, markdown, { httpMetadata: { contentType: "text/markdown; charset=utf-8" } });
    let oneDriveSynced = false;
    try { await saveMarkdownToOneDrive(input.ownerId, path, markdown); oneDriveSynced = true; } catch { /* R2 remains authoritative until OneDrive reconnects. */ }
    const nextMetadata = stringifyResourceMetadata({
      ...metadata,
      summary: distilled.summary,
      themes: distilled.themes,
      tags: metadata.tags.length ? metadata.tags : distilled.themes,
      candidateVocabulary: distilled.vocabulary,
      mediaSegments: rawSegments.length ? rawSegments : metadata.mediaSegments,
      pageCount: distilled.pageCount || 0,
      aiEnhanced: distilled.aiEnhanced,
      reviewDraftObjectKey: objectKey,
      reviewDraftPath: path,
      reviewIssues,
      manualEditedBlocks: [],
      review: {
        totalBlocks: validation.totalBlocks,
        translatedBlocks: validation.translatedBlocks,
        issues: reviewIssues,
        manualEditedBlocks: [],
        checkedAt: validation.checkedAt,
        previousPublished: metadata.review?.previousPublished || [],
      },
    }, type);
    const translationStatus = validation.translatedBlocks === validation.totalBlocks && !reviewIssues.some((issue) => issue.severity === "error") ? "complete" : validation.translatedBlocks ? "partial" : "pending";
    await database.batch([
      database.prepare(`UPDATE resources SET title=?,description=?,processing_status='review_required',translation_status=?,metadata_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`).bind(distilled.title, distilled.summary, translationStatus, nextMetadata, input.resourceId, input.ownerId),
      database.prepare("UPDATE processing_jobs SET status='review_required',stage=?,progress=100,result_resource_id=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(oneDriveSynced ? `Draft已生成：${validation.translatedBlocks}/${validation.totalBlocks}译文，等待复核` : `Draft已生成：${validation.translatedBlocks}/${validation.totalBlocks}译文，等待复核与OneDrive同步`, input.resourceId, input.jobId, input.ownerId),
    ]);
    return { status: "review_required" as const, aiEnhanced: distilled.aiEnhanced, oneDriveSynced };
  } catch (error) {
    const message = error instanceof Error ? error.message : "资料处理失败";
    await database.batch([
      database.prepare("UPDATE resources SET processing_status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(input.resourceId, input.ownerId),
      database.prepare("UPDATE processing_jobs SET status='failed',stage='处理失败',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(message, input.jobId, input.ownerId),
    ]);
    throw error;
  }
}
