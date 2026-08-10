import {
  ensureDatabase,
  getDatabase,
  getMediaBucket,
  getOwnerId,
  getRuntimeBindings,
  jsonError,
} from "@/app/api/_lib/runtime";
import {
  distillDocument,
  extractUploadedText,
  extractWebPage,
  slugify,
  toMarkdown,
} from "@/app/api/_lib/distill";
import {
  moveOneDriveItemToRecycleBin,
  saveMarkdownToOneDrive,
} from "@/app/api/_lib/onedrive";

function mapJob(row: Record<string, unknown>) {
  return {
    id: Number(row.id), inputType: String(row.input_type), sourceName: String(row.source_name ?? ""), sourceUrl: String(row.source_url ?? ""), uploadId: row.upload_id ? Number(row.upload_id) : null,
    status: String(row.status), stage: String(row.stage), progress: Number(row.progress), error: String(row.error ?? ""), resultResourceId: row.result_resource_id ? Number(row.result_resource_id) : null,
    deleteOriginalOnSuccess: Boolean(row.delete_original_on_success), createdAt: String(row.created_at), updatedAt: String(row.updated_at), completedAt: String(row.completed_at ?? ""),
  };
}

export async function GET() {
  try {
    await ensureDatabase(); const ownerId = await getOwnerId();
    const result = await getDatabase().prepare("SELECT * FROM processing_jobs WHERE owner_id=? ORDER BY created_at DESC LIMIT 100").bind(ownerId).all();
    const connection = await getDatabase().prepare("SELECT status FROM onedrive_connections WHERE owner_id=?").bind(ownerId).first<{ status: string }>();
    return Response.json({
      jobs: (result.results as Record<string, unknown>[]).map(mapJob),
      aiConfigured: Boolean(getRuntimeBindings().DEEPSEEK_API_KEY),
      oneDriveConnected: connection?.status === "connected",
    });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  await ensureDatabase();
  const ownerId = await getOwnerId();
  const body = await request.json() as { inputType?: "url" | "upload"; sourceUrl?: string; uploadId?: number; category?: string; deleteOriginalOnSuccess?: boolean };
  if (body.inputType !== "url" && body.inputType !== "upload") return jsonError(new Error("请选择链接或已上传文件"), 400);
  if (body.inputType === "url" && !body.sourceUrl?.trim()) return jsonError(new Error("请输入网页链接"), 400);
  if (body.inputType === "upload" && !body.uploadId) return jsonError(new Error("请选择已上传文件"), 400);
  const initialName = body.inputType === "url" ? body.sourceUrl!.trim() : `上传文件 #${body.uploadId}`;
  const jobResult = await getDatabase().prepare("INSERT INTO processing_jobs (owner_id,input_type,source_name,source_url,upload_id,status,stage,progress,delete_original_on_success) VALUES (?,?,?,?,?,'processing','提取文字',10,?)").bind(ownerId, body.inputType, initialName, body.sourceUrl?.trim() || "", body.uploadId || null, body.deleteOriginalOnSuccess === false ? 0 : 1).run();
  const jobId = Number(jobResult.meta.last_row_id);
  try {
    let extracted: { title: string; text: string; pageCount?: number };
    let upload: Record<string, unknown> | null = null;
    if (body.inputType === "url") {
      extracted = await extractWebPage(body.sourceUrl!.trim());
    } else {
      upload = await getDatabase().prepare("SELECT * FROM uploads WHERE id=? AND owner_id=?").bind(body.uploadId, ownerId).first<Record<string, unknown>>();
      if (!upload) throw new Error("上传文件不存在");
      const object = await getMediaBucket().get(String(upload.object_key));
      if (!object) throw new Error("临时文件内容不存在");
      extracted = await extractUploadedText(await object.arrayBuffer(), String(upload.filename), String(upload.content_type));
    }
    if (extracted.text.length < 80) throw new Error("可识别正文过短，已保留原文件等待人工检查");
    await getDatabase().prepare("UPDATE processing_jobs SET source_name=?,stage='AI整理与Markdown排版',progress=45,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(extracted.title, jobId, ownerId).run();
    const distilled = await distillDocument(extracted.title, extracted.text, extracted.pageCount);
    const capturedAt = new Date().toISOString();
    const date = capturedAt.slice(0, 10);
    const category = body.category?.trim() || (body.inputType === "url" ? "收藏的网站文章" : "离线文章阅读");
    const sourceUrl = body.sourceUrl?.trim() || "";
    // Keep an archived article separate from a learning-tool bookmark that happens
    // to point at the same public URL. The canonical source stays in source_url.
    const resourceUrl = sourceUrl
      ? `urn:english-room:web:${encodeURIComponent(sourceUrl)}`
      : `urn:english-room:upload:${body.uploadId}`;
    const baseFolder = body.inputType === "url" ? "web-articles" : "offline-articles";
    const path = `10_Library/${baseFolder}/${date.slice(0, 4)}/${date}/${slugify(distilled.title)}.md`;
    const objectKey = `${ownerId}/markdown/${date}/${crypto.randomUUID()}-${slugify(distilled.title)}.md`;
    const markdown = toMarkdown(distilled, { id: `resource-${jobId}`, sourceType: body.inputType, sourceUrl, capturedAt });
    await getMediaBucket().put(objectKey, markdown, { httpMetadata: { contentType: "text/markdown; charset=utf-8" } });
    await getDatabase().prepare("UPDATE processing_jobs SET stage='保存资源库与OneDrive',progress=75,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(jobId, ownerId).run();
    let oneDriveSynced = false;
    try { await saveMarkdownToOneDrive(ownerId, path, markdown); oneDriveSynced = true; } catch { /* Saved in R2 and queued for later sync. */ }
    const resourceInsert = await getDatabase().prepare(`INSERT INTO resources (owner_id,title,description,category,level,skills,resource_type,url,source_name,source_url,collection,markdown_object_key,markdown_path,processing_status,translation_status,metadata_json)
      VALUES (?,?,?,?,?,'阅读','离线文章',?,?,?,?,?,?,?,?,?)
      ON CONFLICT(owner_id,url) DO UPDATE SET title=excluded.title,description=excluded.description,category=excluded.category,resource_type=excluded.resource_type,source_name=excluded.source_name,source_url=excluded.source_url,collection='library',markdown_object_key=excluded.markdown_object_key,markdown_path=excluded.markdown_path,processing_status=excluded.processing_status,translation_status=excluded.translation_status,metadata_json=excluded.metadata_json,updated_at=CURRENT_TIMESTAMP`)
      .bind(ownerId, distilled.title, distilled.summary, category, "不限", resourceUrl, body.inputType === "url" ? "网页蒸馏" : "文件蒸馏", sourceUrl, "library", objectKey, path, oneDriveSynced ? "ready" : "sync_pending", distilled.translation ? "complete" : "pending", JSON.stringify({ themes: distilled.themes, vocabularyCount: distilled.vocabulary.length, aiEnhanced: distilled.aiEnhanced, pageCount: distilled.pageCount || 0 }))
      .run();
    let resourceId = Number(resourceInsert.meta.last_row_id || 0);
    if (!resourceId) {
      const existing = await getDatabase().prepare("SELECT id FROM resources WHERE owner_id=? AND url=?").bind(ownerId, resourceUrl).first<{ id: number }>();
      resourceId = Number(existing?.id || 0);
    }
    if (distilled.vocabulary.length) {
      const statements = distilled.vocabulary.map((item) => getDatabase().prepare(`INSERT INTO vocabulary (owner_id,word,definition,example,source_type,source_id)
        VALUES (?,?,?,?, 'resource',?) ON CONFLICT(owner_id,word) DO UPDATE SET definition=CASE WHEN vocabulary.definition='' THEN excluded.definition ELSE vocabulary.definition END,example=CASE WHEN vocabulary.example='' THEN excluded.example ELSE vocabulary.example END,source_type='resource',source_id=excluded.source_id,updated_at=CURRENT_TIMESTAMP`).bind(ownerId, item.word.toLowerCase(), item.meaning, item.example || "", String(resourceId)));
      for (let index = 0; index < statements.length; index += 50) await getDatabase().batch(statements.slice(index, index + 50));
    }
    if (upload && body.deleteOriginalOnSuccess !== false && oneDriveSynced) {
      if (upload.external_item_id) await moveOneDriveItemToRecycleBin(ownerId, String(upload.external_item_id));
      await getMediaBucket().delete(String(upload.object_key));
      const deleteAfter = new Date(Date.now() + 30 * 86400000).toISOString();
      await getDatabase().prepare("UPDATE uploads SET status='recycle_bin',delete_after=? WHERE id=? AND owner_id=?").bind(deleteAfter, body.uploadId, ownerId).run();
    }
    await getDatabase().prepare("UPDATE processing_jobs SET status='complete',stage=?,progress=100,result_resource_id=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(oneDriveSynced ? "整理完成，原文件已按规则处理" : "Markdown已生成，等待OneDrive同步", resourceId, jobId, ownerId).run();
    return Response.json({ ok: true, jobId, resourceId, oneDriveSynced, aiEnhanced: distilled.aiEnhanced });
  } catch (error) {
    const message = error instanceof Error ? error.message : "资料整理失败";
    await getDatabase().prepare("UPDATE processing_jobs SET status='failed',stage='处理失败，原文件已保留',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(message, jobId, ownerId).run();
    return jsonError(new Error(message));
  }
}
