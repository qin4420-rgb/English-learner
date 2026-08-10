import { processResource } from "@/app/api/_lib/resource-processing";
import { ensureDatabase, getDatabase, getOwnerId, getRuntimeBindings, jsonError } from "@/app/api/_lib/runtime";
import { inferResourceType } from "@/app/resource-model";

function mapJob(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    inputType: String(row.input_type),
    sourceName: String(row.source_name ?? ""),
    sourceUrl: String(row.source_url ?? ""),
    uploadId: row.upload_id ? Number(row.upload_id) : null,
    status: String(row.status),
    stage: String(row.stage),
    progress: Number(row.progress),
    error: String(row.error ?? ""),
    resultResourceId: row.result_resource_id ? Number(row.result_resource_id) : null,
    deleteOriginalOnSuccess: Boolean(row.delete_original_on_success),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: String(row.completed_at ?? ""),
  };
}

export async function GET() {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const result = await getDatabase().prepare("SELECT * FROM processing_jobs WHERE owner_id=? ORDER BY created_at DESC LIMIT 200").bind(ownerId).all();
    const connection = await getDatabase().prepare("SELECT status FROM onedrive_connections WHERE owner_id=?").bind(ownerId).first<{ status: string }>();
    return Response.json({
      jobs: (result.results as Record<string, unknown>[]).map(mapJob),
      aiConfigured: Boolean(getRuntimeBindings().DEEPSEEK_API_KEY),
      oneDriveConnected: connection?.status === "connected",
    });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { resourceId?: number; inputType?: "url" | "upload"; sourceUrl?: string; uploadId?: number; category?: string };
    let resourceId = Number(body.resourceId || 0);
    const inputType = body.inputType || "url";
    let sourceUrl = body.sourceUrl?.trim() || "";
    const uploadId = Number(body.uploadId || 0) || null;

    if (!resourceId) {
      if (inputType === "url" && !sourceUrl) return jsonError(new Error("请输入网页链接"), 400);
      if (inputType === "upload" && !uploadId) return jsonError(new Error("请选择已上传文件"), 400);
      const upload = uploadId ? await getDatabase().prepare("SELECT * FROM uploads WHERE owner_id=? AND id=?").bind(ownerId, uploadId).first<Record<string, unknown>>() : null;
      if (uploadId && !upload) return jsonError(new Error("上传文件不存在"), 404);
      const title = upload ? String(upload.filename) : sourceUrl;
      const resourceType = inferResourceType(title, upload ? String(upload.content_type) : "", sourceUrl);
      const resourceUrl = sourceUrl ? `urn:english-room:link:${encodeURIComponent(sourceUrl)}` : `urn:english-room:upload:${uploadId}`;
      const result = await getDatabase().prepare(`INSERT INTO resources (owner_id,title,description,category,level,skills,resource_type,url,source_name,source_url,collection,processing_status,translation_status,metadata_json,status)
        VALUES (?,?,?,?,'不限','综合',?,?,?,?,'library','queued','pending','{}','active')
        ON CONFLICT(owner_id,url) DO UPDATE SET processing_status='queued',updated_at=CURRENT_TIMESTAMP`)
        .bind(ownerId, title, "等待处理", body.category?.trim() || "待整理", resourceType, resourceUrl, inputType === "url" ? "网页链接" : "文件上传", sourceUrl).run();
      resourceId = Number(result.meta.last_row_id || 0);
      if (!resourceId) resourceId = Number((await getDatabase().prepare("SELECT id FROM resources WHERE owner_id=? AND url=?").bind(ownerId, resourceUrl).first<{ id: number }>())?.id || 0);
    } else {
      const resource = await getDatabase().prepare("SELECT source_url,url FROM resources WHERE owner_id=? AND id=?").bind(ownerId, resourceId).first<Record<string, unknown>>();
      if (!resource) return jsonError(new Error("资源不存在"), 404);
      sourceUrl ||= String(resource.source_url || (/^https?:/.test(String(resource.url)) ? resource.url : ""));
    }

    const job = await getDatabase().prepare(`INSERT INTO processing_jobs (owner_id,input_type,source_name,source_url,upload_id,status,stage,progress,result_resource_id,delete_original_on_success)
      VALUES (?,?,?,?,?,'queued','等待处理',0,?,0)`).bind(ownerId, inputType, sourceUrl || `资源 #${resourceId}`, sourceUrl, uploadId, resourceId).run();
    const jobId = Number(job.meta.last_row_id);
    const result = await processResource({ ownerId, resourceId, jobId, inputType, sourceUrl, uploadId });
    return Response.json({ ok: true, jobId, resourceId, ...result });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { id?: number; action?: "retry" | "confirm" | "later" };
    if (!body.id || !body.action) return jsonError(new Error("缺少处理任务或操作"), 400);
    const job = await getDatabase().prepare("SELECT * FROM processing_jobs WHERE owner_id=? AND id=?").bind(ownerId, body.id).first<Record<string, unknown>>();
    if (!job) return jsonError(new Error("处理任务不存在"), 404);
    const resourceId = Number(job.result_resource_id || 0);
    if (body.action === "confirm") {
      await getDatabase().batch([
        getDatabase().prepare("UPDATE processing_jobs SET status='complete',stage='已确认入库',progress=100,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=?").bind(ownerId, body.id),
        getDatabase().prepare("UPDATE resources SET processing_status='ready',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=?").bind(ownerId, resourceId),
      ]);
      return Response.json({ ok: true });
    }
    if (body.action === "later") {
      await getDatabase().prepare("UPDATE processing_jobs SET status='review_required',stage='稍后复核',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=?").bind(ownerId, body.id).run();
      return Response.json({ ok: true });
    }
    await getDatabase().prepare("UPDATE processing_jobs SET status='queued',stage='重新排队',progress=0,error='',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=?").bind(ownerId, body.id).run();
    const result = await processResource({
      ownerId,
      resourceId,
      jobId: body.id,
      inputType: String(job.input_type) as "url" | "upload",
      sourceUrl: String(job.source_url || ""),
      uploadId: job.upload_id ? Number(job.upload_id) : null,
    });
    return Response.json({ ok: true, ...result });
  } catch (error) { return jsonError(error); }
}
