import { canonicalBlocks, renderReviewMarkdown, validateArticleDraft } from "@/app/article-review.mjs";
import { createPipelineSteps, mapProcessingError, nextRunnableStep, normalizeJobStatus, type PipelineStepKey } from "@/app/processing-pipeline.mjs";
import { normalizeResourceType, parseResourceMetadata, stringifyResourceMetadata } from "@/app/resource-model";
import { distillDocument, extractUploadedText, extractWebPage, slugify, translateBlocksDetailed } from "./distill";
import { runOCR, runSTT, runSTTUrl } from "./providers";
import { getDatabase, getMediaBucket, getRuntimeBindings } from "./runtime";

type JobInput = { ownerId: string; resourceId: number; inputType: string; sourceName: string; sourceUrl?: string; uploadId?: number | null; startAt?: PipelineStepKey; pastedText?: string };
type ProcessInput = { ownerId: string; jobId: number };
type StepRow = Record<string, unknown> & { id: number; step_key: PipelineStepKey; step_label: string; sort_order: number; status: string; output_ref: string };
type StepExecutionResult = { completed: boolean; outputRef?: string; detail?: Record<string, unknown>; progressCurrent?: number; progressTotal?: number };

function artifactPrefix(ownerId: string, resourceId: number, jobId: number) {
  return `${ownerId}/processing/${resourceId}/${jobId}`;
}

async function putJson(key: string, value: unknown) {
  await getMediaBucket().put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  return key;
}

async function getJson<T>(key: string): Promise<T> {
  const object = await getMediaBucket().get(key);
  if (!object) throw Object.assign(new Error(`Checkpoint 不存在：${key}`), { code: "STORAGE_ERROR" });
  return JSON.parse(await object.text()) as T;
}

async function putText(key: string, value: string) {
  await getMediaBucket().put(key, value, { httpMetadata: { contentType: "text/markdown; charset=utf-8" } });
  return key;
}

async function getText(key: string) {
  const object = await getMediaBucket().get(key);
  if (!object) throw Object.assign(new Error(`Checkpoint 不存在：${key}`), { code: "STORAGE_ERROR" });
  return object.text();
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function initializeProcessingJob(input: JobInput) {
  const database = getDatabase();
  const resource = await database.prepare("SELECT resource_type FROM resources WHERE id=? AND owner_id=?").bind(input.resourceId, input.ownerId).first<{ resource_type: string }>();
  if (!resource) throw new Error("资源不存在");
  const startAt = input.startAt || "original";
  const result = await database.prepare(`INSERT INTO processing_jobs (
    owner_id,input_type,source_name,source_url,upload_id,status,stage,progress,result_resource_id,delete_original_on_success,current_step
  ) VALUES (?,?,?,?,?,'queued','等待处理',0,?,0,?)`).bind(
    input.ownerId, input.inputType, input.sourceName, input.sourceUrl || "", input.uploadId || null, input.resourceId, startAt,
  ).run();
  const jobId = Number(result.meta.last_row_id);
  const steps = createPipelineSteps(normalizeResourceType(resource.resource_type), startAt);
  await database.batch(steps.map((step) => database.prepare(`INSERT INTO processing_job_steps (
    owner_id,job_id,step_key,step_label,sort_order,status,attempt_count,progress_current,progress_total
  ) VALUES (?,?,?,?,?,?,?,?,?)`).bind(input.ownerId, jobId, step.key, step.label, step.order, step.status, 0, 0, 0)));
  if (input.pastedText) {
    const key = `${artifactPrefix(input.ownerId, input.resourceId, jobId)}/pasted-source.md`;
    await putText(key, input.pastedText.trim());
    await database.prepare("UPDATE processing_job_steps SET output_ref=?,detail_json=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND job_id=? AND step_key='extract'")
      .bind(key, JSON.stringify({ source: "pasted_text", characters: input.pastedText.trim().length }), input.ownerId, jobId).run();
  }
  return jobId;
}

async function rowsForJob(ownerId: string, jobId: number) {
  const result = await getDatabase().prepare("SELECT * FROM processing_job_steps WHERE owner_id=? AND job_id=? ORDER BY sort_order").bind(ownerId, jobId).all();
  return result.results as StepRow[];
}

async function stepOutput(ownerId: string, jobId: number, key: PipelineStepKey) {
  const row = await getDatabase().prepare("SELECT output_ref FROM processing_job_steps WHERE owner_id=? AND job_id=? AND step_key=?").bind(ownerId, jobId, key).first<{ output_ref: string }>();
  if (!row?.output_ref) throw Object.assign(new Error(`缺少 ${key} Checkpoint`), { code: "STORAGE_ERROR" });
  return row.output_ref;
}

async function loadUpload(ownerId: string, uploadId: number) {
  const upload = await getDatabase().prepare("SELECT * FROM uploads WHERE id=? AND owner_id=?").bind(uploadId, ownerId).first<Record<string, unknown>>();
  if (!upload) throw new Error("上传文件不存在");
  const object = await getMediaBucket().get(String(upload.object_key));
  if (!object) throw Object.assign(new Error("原文件内容不存在"), { code: "STORAGE_ERROR" });
  return { upload, bytes: await object.arrayBuffer() };
}

async function executeStep(job: Record<string, unknown>, resource: Record<string, unknown>, step: StepRow): Promise<StepExecutionResult> {
  const ownerId = String(job.owner_id);
  const resourceId = Number(job.result_resource_id);
  const jobId = Number(job.id);
  const type = normalizeResourceType(resource.resource_type);
  const prefix = artifactPrefix(ownerId, resourceId, jobId);

  if (step.step_key === "original") {
    const ref = { inputType: job.input_type, sourceUrl: job.source_url, uploadId: job.upload_id, resourceId, preserved: true, createdAt: new Date().toISOString() };
    return { completed: true, outputRef: await putJson(`${prefix}/original-ref.json`, ref), detail: ref };
  }

  if (step.step_key === "extract") {
    let title = String(resource.title || job.source_name || "学习资料");
    let text = "";
    let pageCount = 0;
    let segments: unknown[] = [];
    if (String(job.input_type) === "paste" && step.output_ref) {
      text = await getText(step.output_ref);
    } else if (type === "Article" && job.source_url) {
      const extracted = await extractWebPage(String(job.source_url)); title = extracted.title; text = extracted.text;
    } else if (["Audio", "Video"].includes(type) && !job.upload_id) {
      if (!getRuntimeBindings().STT_ENDPOINT || !getRuntimeBindings().STT_PROVIDER) throw Object.assign(new Error("STT Provider 尚未配置"), { code: "STT_REQUIRED" });
      const value = await runSTTUrl(String(job.source_url || resource.source_url || resource.url)); text = value.text; segments = value.segments;
    } else if (job.upload_id) {
      const { upload, bytes } = await loadUpload(ownerId, Number(job.upload_id));
      title = String(upload.filename || title);
      if (type === "Image") {
        if (!getRuntimeBindings().OCR_ENDPOINT || !getRuntimeBindings().OCR_PROVIDER) throw Object.assign(new Error("OCR Provider 尚未配置"), { code: "OCR_REQUIRED" });
        text = await runOCR(bytes, String(upload.content_type), title);
      } else if (["Audio", "Video"].includes(type)) {
        if (!getRuntimeBindings().STT_ENDPOINT || !getRuntimeBindings().STT_PROVIDER) throw Object.assign(new Error("STT Provider 尚未配置"), { code: "STT_REQUIRED" });
        const value = await runSTT(bytes, String(upload.content_type), title); text = value.text; segments = value.segments;
      } else {
        try {
          const value = await extractUploadedText(bytes, title, String(upload.content_type)); title = value.title; text = value.text; pageCount = value.pageCount || 0;
        } catch (error) {
          if (type === "PDF" && /OCR|扫描/.test((error as Error).message)) throw Object.assign(error as Error, { code: "OCR_REQUIRED" });
          throw error;
        }
      }
    }
    if (text.trim().length < 20) throw Object.assign(new Error("可识别文字过短，原始资料已保留"), { code: "SOURCE_EXTRACTION_FAILED" });
    const artifact = { title, text, pageCount, segments, extractedAt: new Date().toISOString() };
    return { completed: true, outputRef: await putJson(`${prefix}/extracted.json`, artifact), detail: { title, characters: text.length, pageCount, segments: segments.length } };
  }

  if (step.step_key === "structure") {
    const extractRef = await stepOutput(ownerId, jobId, "extract");
    let title = String(resource.title || "学习资料");
    let text = "";
    let pageCount = 0;
    let segments: unknown[] = [];
    if (extractRef.endsWith(".md")) text = await getText(extractRef);
    else { const extracted = await getJson<{ title: string; text: string; pageCount?: number; segments?: unknown[] }>(extractRef); title = extracted.title; text = extracted.text; pageCount = extracted.pageCount || 0; segments = extracted.segments || []; }
    const structured = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const contentHash = await sha256(structured);
    const outputRef = await putText(`${prefix}/structured.md`, structured);
    return { completed: true, outputRef, detail: { title, pageCount, segments, contentHash, characters: structured.length } };
  }

  if (step.step_key === "blockify") {
    const structured = await getText(await stepOutput(ownerId, jobId, "structure"));
    const blocks = canonicalBlocks(structured).map((block, index) => ({ ...block, id: ["Audio", "Video"].includes(type) ? `s${String(index + 1).padStart(4, "0")}` : block.id }));
    return { completed: true, outputRef: await putJson(`${prefix}/blocks.json`, blocks), detail: { totalBlocks: blocks.length }, progressCurrent: blocks.length, progressTotal: blocks.length };
  }

  if (step.step_key === "enrich") {
    const structured = await getText(await stepOutput(ownerId, jobId, "structure"));
    const structureStep = (await rowsForJob(ownerId, jobId)).find((item) => item.step_key === "structure");
    const detail = JSON.parse(String(structureStep?.detail_json || "{}")) as { title?: string; pageCount?: number };
    const result = await distillDocument(detail.title || String(resource.title), structured, detail.pageCount || 0);
    const enrichment = { title: result.title, summary: result.summary, themes: result.themes, vocabulary: result.vocabulary, pageCount: result.pageCount || 0, aiEnhanced: result.aiEnhanced };
    return { completed: true, outputRef: await putJson(`${prefix}/enrichment.json`, enrichment), detail: { aiEnhanced: result.aiEnhanced, themes: result.themes.length, vocabulary: result.vocabulary.length } };
  }

  if (step.step_key === "translate") {
    const blocks = await getJson<{ id: string; original: string }[]>(await stepOutput(ownerId, jobId, "blockify"));
    const outputRef = step.output_ref || `${prefix}/translation.json`;
    let artifact = { totalBlocks: blocks.length, translatedBlocks: 0, translations: {} as Record<string, string>, failedBlockIds: [] as string[], updatedAt: new Date().toISOString() };
    if (step.output_ref) artifact = await getJson<typeof artifact>(step.output_ref);
    const pending = blocks.filter((block) => !artifact.translations[block.id]);
    if (!pending.length) return { completed: true, outputRef, detail: { totalBlocks: blocks.length }, progressCurrent: blocks.length, progressTotal: blocks.length };
    const batch: typeof pending = [];
    let characters = 0;
    for (const block of pending) { if (batch.length >= 10 || (batch.length >= 5 && characters + block.original.length > 7000)) break; batch.push(block); characters += block.original.length; }
    const run = await translateBlocksDetailed(batch.map((block) => ({ id: block.id, text: block.original })));
    for (const [id, translation] of run.translations) artifact.translations[id] = translation;
    artifact.translatedBlocks = Object.keys(artifact.translations).length;
    artifact.failedBlockIds = batch.filter((block) => !artifact.translations[block.id]).map((block) => block.id);
    artifact.updatedAt = new Date().toISOString();
    await putJson(outputRef, artifact);
    if (artifact.failedBlockIds.length) {
      const protocolCode = run.issues.find((issue) => ["AI_RESPONSE_TRUNCATED", "AI_RESPONSE_INVALID_JSON", "AI_RESPONSE_EMPTY", "AI_HTTP_ERROR"].includes(issue.type))?.type;
      throw Object.assign(new Error(run.issues.map((issue) => issue.message).join("；") || "部分翻译未返回"), { code: protocolCode || "TRANSLATION_PARTIAL", detail: artifact });
    }
    return { completed: artifact.translatedBlocks >= artifact.totalBlocks, outputRef, detail: { failedBlockIds: [], updatedAt: artifact.updatedAt }, progressCurrent: artifact.translatedBlocks, progressTotal: artifact.totalBlocks };
  }

  if (step.step_key === "qa") {
    const blocks = await getJson<{ id: string; type: string; original: string }[]>(await stepOutput(ownerId, jobId, "blockify"));
    const translations = await getJson<{ translations: Record<string, string> }>(await stepOutput(ownerId, jobId, "translate"));
    const enrichment = await getJson<{ title: string; summary: string; themes: string[]; vocabulary: { word: string; meaning: string; example?: string }[]; pageCount: number; aiEnhanced: boolean }>(await stepOutput(ownerId, jobId, "enrich"));
    const reviewBlocks = blocks.map((block) => ({ ...block, translation: translations.translations[block.id] || "", manualEdited: false }));
    const validation = validateArticleDraft(reviewBlocks);
    const capturedAt = new Date().toISOString();
    const draftKey = `${prefix}/draft.md`;
    const markdown = renderReviewMarkdown(reviewBlocks, { id: `resource-${resourceId}`, title: enrichment.title, sourceType: type, sourceUrl: String(job.source_url || resource.source_url || ""), capturedAt, pageCount: enrichment.pageCount, aiEnhanced: enrichment.aiEnhanced }, { summary: enrichment.summary, themes: enrichment.themes, vocabulary: enrichment.vocabulary });
    await putText(draftKey, markdown);
    const qaRef = await putJson(`${prefix}/qa.json`, validation);
    const metadata = parseResourceMetadata(resource.metadata_json, type);
    const nextMetadata = stringifyResourceMetadata({ ...metadata, summary: enrichment.summary, themes: enrichment.themes, tags: metadata.tags.length ? metadata.tags : enrichment.themes, candidateVocabulary: enrichment.vocabulary, pageCount: enrichment.pageCount, aiEnhanced: enrichment.aiEnhanced, reviewDraftObjectKey: draftKey, reviewDraftPath: `10_Library/_Review/${type.toLowerCase()}/${capturedAt.slice(0, 4)}/${slugify(enrichment.title)}-draft.md`, reviewIssues: validation.issues, manualEditedBlocks: [], review: { totalBlocks: validation.totalBlocks, translatedBlocks: validation.translatedBlocks, issues: validation.issues, manualEditedBlocks: [], checkedAt: validation.checkedAt, previousPublished: metadata.review?.previousPublished || [] } }, type);
    const translationStatus = validation.translatedBlocks === validation.totalBlocks ? "complete" : validation.translatedBlocks ? "partial" : "pending";
    await getDatabase().prepare("UPDATE resources SET title=?,description=?,metadata_json=?,processing_status='review_required',translation_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
      .bind(enrichment.title, enrichment.summary, nextMetadata, translationStatus, resourceId, ownerId).run();
    return { completed: true, outputRef: qaRef, detail: { draftRef: draftKey, errors: validation.issues.filter((issue) => issue.severity === "error").length, warnings: validation.issues.filter((issue) => issue.severity === "warning").length }, progressCurrent: validation.translatedBlocks, progressTotal: validation.totalBlocks };
  }

  throw Object.assign(new Error(`${step.step_label} 需要用户操作`), { code: "UNKNOWN_PROCESSING_ERROR" });
}

export async function runProcessingWorkUnit(input: ProcessInput) {
  const database = getDatabase();
  const job = await database.prepare("SELECT * FROM processing_jobs WHERE id=? AND owner_id=?").bind(input.jobId, input.ownerId).first<Record<string, unknown>>();
  if (!job) throw new Error("处理任务不存在");
  const status = normalizeJobStatus(String(job.status));
  if (["paused", "needs_action", "needs_provider", "failed", "review_required", "completed", "cancelled"].includes(status)) return { status, jobId: input.jobId };
  const steps = await rowsForJob(input.ownerId, input.jobId);
  if (!steps.length) return { status: "legacy", jobId: input.jobId };
  if (job.pause_requested) {
    await database.batch([
      database.prepare("UPDATE processing_jobs SET status='paused',stage='已安全暂停',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(input.jobId, input.ownerId),
      database.prepare("UPDATE processing_job_steps SET status='paused',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND job_id=? AND status='running'").bind(input.ownerId, input.jobId),
    ]);
    return { status: "paused", jobId: input.jobId };
  }
  const step = nextRunnableStep(steps);
  if (!step) {
    await database.prepare("UPDATE processing_jobs SET status='completed',stage='处理完成',progress=100,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(input.jobId, input.ownerId).run();
    return { status: "completed", jobId: input.jobId };
  }
  if (step.step_key === "review") {
    await database.batch([
      database.prepare("UPDATE processing_job_steps SET status='needs_action',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(step.id),
      database.prepare("UPDATE processing_jobs SET status='review_required',stage='等待人工复核',current_step='review',progress=80,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(input.jobId, input.ownerId),
    ]);
    return { status: "review_required", jobId: input.jobId };
  }
  const resource = await database.prepare("SELECT * FROM resources WHERE id=? AND owner_id=?").bind(Number(job.result_resource_id), input.ownerId).first<Record<string, unknown>>();
  if (!resource) throw new Error("资源不存在");
  await database.batch([
    database.prepare("UPDATE processing_job_steps SET status='running',attempt_count=attempt_count+1,started_at=COALESCE(started_at,CURRENT_TIMESTAMP),error_code='',error_message='',error_detail_json='{}',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(step.id),
    database.prepare("UPDATE processing_jobs SET status='running',stage=?,current_step=?,attempt_count=attempt_count+1,error='',error_code='',error_message='',error_detail_json='{}',suggested_actions_json='[]',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(step.step_label, step.step_key, input.jobId, input.ownerId),
  ]);
  try {
    const result = await executeStep(job, resource, step);
    const control = await database.prepare("SELECT status,pause_requested FROM processing_jobs WHERE id=? AND owner_id=?").bind(input.jobId, input.ownerId).first<{ status: string; pause_requested: number }>();
    if (control?.status === "cancelled") {
      await database.prepare("UPDATE processing_job_steps SET status='paused',output_ref=?,detail_json=?,progress_current=?,progress_total=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(result.outputRef || "", JSON.stringify(result.detail || {}), result.progressCurrent || 0, result.progressTotal || 0, step.id).run();
      return { status: "cancelled", jobId: input.jobId };
    }
    if (control?.pause_requested) {
      await database.batch([
        database.prepare("UPDATE processing_job_steps SET status=?,output_ref=?,detail_json=?,progress_current=?,progress_total=?,completed_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(result.completed ? "completed" : "paused", result.outputRef || "", JSON.stringify(result.detail || {}), result.progressCurrent || 0, result.progressTotal || 0, result.completed ? "completed" : "paused", step.id),
        database.prepare("UPDATE processing_jobs SET status='paused',stage='已安全暂停',last_successful_step=CASE WHEN ? THEN ? ELSE last_successful_step END,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
          .bind(result.completed ? 1 : 0, step.step_key, input.jobId, input.ownerId),
      ]);
      return { status: "paused", jobId: input.jobId, completedStep: result.completed ? step.step_key : "" };
    }
    if (!result.completed) {
      await database.batch([
        database.prepare("UPDATE processing_job_steps SET output_ref=?,detail_json=?,progress_current=?,progress_total=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(result.outputRef, JSON.stringify(result.detail || {}), result.progressCurrent || 0, result.progressTotal || 0, step.id),
        database.prepare("UPDATE processing_jobs SET status='running',stage=?,progress=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(`${step.step_label} ${result.progressCurrent || 0}/${result.progressTotal || 0}`, Math.min(79, Math.round((Number(step.sort_order) - 10 + 10 * ((result.progressCurrent || 0) / Math.max(1, result.progressTotal || 1))) / 100 * 100)), input.jobId, input.ownerId),
      ]);
      return { status: "running", jobId: input.jobId, step: step.step_key, progressCurrent: result.progressCurrent || 0, progressTotal: result.progressTotal || 0 };
    }
    const nextSteps = steps.map((item) => item.id === step.id ? { ...item, status: "completed" } : item);
    const next = nextRunnableStep(nextSteps);
    const nextIsReview = next?.step_key === "review";
    await database.batch([
      database.prepare("UPDATE processing_job_steps SET status='completed',output_ref=?,detail_json=?,progress_current=?,progress_total=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(result.outputRef || "", JSON.stringify(result.detail || {}), result.progressCurrent || 0, result.progressTotal || 0, step.id),
      ...(nextIsReview ? [database.prepare("UPDATE processing_job_steps SET status='needs_action',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(next!.id)] : []),
      database.prepare("UPDATE processing_jobs SET status=?,stage=?,progress=?,current_step=?,last_successful_step=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
        .bind(nextIsReview ? "review_required" : "queued", nextIsReview ? "等待人工复核" : `等待${next?.step_label || "完成"}`, nextIsReview ? 80 : Math.min(79, Number(step.sort_order)), next?.step_key || "", step.step_key, input.jobId, input.ownerId),
    ]);
    return { status: nextIsReview ? "review_required" : "queued", jobId: input.jobId, completedStep: step.step_key, nextStep: next?.step_key || "" };
  } catch (error) {
    const structured = mapProcessingError(error, { jobId: input.jobId, step: step.step_key, completedSteps: steps.filter((item) => ["completed", "skipped"].includes(item.status)).map((item) => item.step_key) });
    await database.batch([
      database.prepare("UPDATE processing_job_steps SET status=?,error_code=?,error_message=?,error_detail_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(structured.status === "needs_provider" ? "needs_provider" : structured.status === "needs_action" ? "needs_action" : "failed", structured.code, structured.userMessage, JSON.stringify({ technicalMessage: structured.technicalMessage, ...structured.detail }), step.id),
      database.prepare("UPDATE processing_jobs SET status=?,stage=?,error=?,error_code=?,error_message=?,error_detail_json=?,suggested_actions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(structured.status, `${step.step_label}需要处理`, structured.userMessage, structured.code, structured.userMessage, JSON.stringify({ technicalMessage: structured.technicalMessage, ...structured.detail }), JSON.stringify(structured.suggestedActions), input.jobId, input.ownerId),
      database.prepare("UPDATE resources SET processing_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(structured.status, Number(job.result_resource_id), input.ownerId),
    ]);
    return { status: structured.status, jobId: input.jobId, error: structured };
  }
}

export async function processResource(input: { ownerId: string; jobId: number }) {
  return runProcessingWorkUnit(input);
}
