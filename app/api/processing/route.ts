import { initializeProcessingJob } from "@/app/api/_lib/resource-processing";
import { ensureDatabase, getDatabase, getMediaBucket, getOwnerId, getRuntimeBindings, jsonError } from "@/app/api/_lib/runtime";
import { inferResourceType } from "@/app/resource-model";
import { normalizeJobStatus } from "@/app/processing-pipeline.mjs";
import type { ProcessingJob, ProcessingJobStep } from "@/app/types";

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value || "")) as T; } catch { return fallback; }
}

function mapStep(row: Record<string, unknown>): ProcessingJobStep {
  return {
    id: Number(row.id), jobId: Number(row.job_id), stepKey: String(row.step_key), stepLabel: String(row.step_label), sortOrder: Number(row.sort_order),
    status: String(row.status) as ProcessingJobStep["status"], attemptCount: Number(row.attempt_count || 0), progressCurrent: Number(row.progress_current || 0), progressTotal: Number(row.progress_total || 0),
    startedAt: String(row.started_at || ""), completedAt: String(row.completed_at || ""), errorCode: String(row.error_code || ""), errorMessage: String(row.error_message || ""),
    errorDetail: parseJson<Record<string, unknown>>(row.error_detail_json, {}), outputRef: String(row.output_ref || ""), detail: parseJson<Record<string, unknown>>(row.detail_json, {}),
  };
}

function mapJob(row: Record<string, unknown>, steps: ProcessingJobStep[]): ProcessingJob {
  const status = normalizeJobStatus(String(row.status));
  return {
    id: Number(row.id), inputType: String(row.input_type), sourceName: String(row.source_name ?? ""), sourceUrl: String(row.source_url ?? ""), uploadId: row.upload_id ? Number(row.upload_id) : null,
    status, stage: String(row.stage), progress: Number(row.progress), error: String(row.error ?? ""), currentStep: String(row.current_step || ""), lastSuccessfulStep: String(row.last_successful_step || ""),
    pauseRequested: Boolean(row.pause_requested), attemptCount: Number(row.attempt_count || 0), errorCode: String(row.error_code || ""), errorMessage: String(row.error_message || row.error || ""),
    errorDetail: parseJson<Record<string, unknown>>(row.error_detail_json, {}), suggestedActions: parseJson<string[]>(row.suggested_actions_json, []), resultResourceId: row.result_resource_id ? Number(row.result_resource_id) : null,
    deleteOriginalOnSuccess: Boolean(row.delete_original_on_success), createdAt: String(row.created_at), updatedAt: String(row.updated_at), completedAt: String(row.completed_at ?? ""), legacy: steps.length === 0, steps,
  };
}

async function loadJobs(ownerId: string, id?: number) {
  const rows = id
    ? await getDatabase().prepare("SELECT * FROM processing_jobs WHERE owner_id=? AND id=?").bind(ownerId, id).all()
    : await getDatabase().prepare("SELECT * FROM processing_jobs WHERE owner_id=? ORDER BY created_at DESC LIMIT 200").bind(ownerId).all();
  const jobRows = rows.results as Record<string, unknown>[];
  if (!jobRows.length) return [];
  const ids = jobRows.map((row) => Number(row.id));
  const placeholders = ids.map(() => "?").join(",");
  const stepRows = await getDatabase().prepare(`SELECT * FROM processing_job_steps WHERE owner_id=? AND job_id IN (${placeholders}) ORDER BY job_id,sort_order`).bind(ownerId, ...ids).all();
  const steps = (stepRows.results as Record<string, unknown>[]).map(mapStep);
  return jobRows.map((row) => mapJob(row, steps.filter((step) => step.jobId === Number(row.id))));
}

export async function GET(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const id = Number(new URL(request.url).searchParams.get("id") || 0) || undefined;
    const jobs = await loadJobs(ownerId, id);
    if (id && !jobs.length) return jsonError(new Error("处理任务不存在"), 404);
    const connection = await getDatabase().prepare("SELECT status FROM onedrive_connections WHERE owner_id=?").bind(ownerId).first<{ status: string }>();
    return Response.json({ jobs, job: id ? jobs[0] : undefined, aiConfigured: Boolean(getRuntimeBindings().DEEPSEEK_API_KEY), oneDriveConnected: connection?.status === "connected" });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { resourceId?: number; inputType?: "url" | "upload" | "paste"; sourceUrl?: string; uploadId?: number; category?: string; title?: string; pastedText?: string };
    let resourceId = Number(body.resourceId || 0);
    const inputType = body.inputType || (body.pastedText ? "paste" : "url");
    let sourceUrl = body.sourceUrl?.trim() || "";
    const pastedText = body.pastedText?.trim() || "";
    const uploadId = Number(body.uploadId || 0) || null;
    if (inputType === "paste" && pastedText.length < 20) return jsonError(new Error("请粘贴至少20个字符的英文正文"), 400);

    if (!resourceId) {
      if (inputType === "url" && !sourceUrl) return jsonError(new Error("请输入网页链接"), 400);
      if (inputType === "upload" && !uploadId) return jsonError(new Error("请选择已上传文件"), 400);
      const upload = uploadId ? await getDatabase().prepare("SELECT * FROM uploads WHERE owner_id=? AND id=?").bind(ownerId, uploadId).first<Record<string, unknown>>() : null;
      if (uploadId && !upload) return jsonError(new Error("上传文件不存在"), 404);
      const title = body.title?.trim() || (upload ? String(upload.filename) : inputType === "paste" ? pastedText.split(/\n/).find(Boolean)?.slice(0, 120) || "粘贴的英文文章" : sourceUrl);
      const resourceType = inferResourceType(title, upload ? String(upload.content_type) : "", sourceUrl);
      const resourceUrl = sourceUrl ? `urn:english-room:link:${encodeURIComponent(sourceUrl)}` : inputType === "paste" ? `urn:english-room:paste:${crypto.randomUUID()}` : `urn:english-room:upload:${uploadId}`;
      const result = await getDatabase().prepare(`INSERT INTO resources (owner_id,title,description,category,level,skills,resource_type,url,source_name,source_url,collection,processing_status,translation_status,metadata_json,status)
        VALUES (?,?,?,?,'不限','综合',?,?,?,?,'library','queued','pending','{}','active')
        ON CONFLICT(owner_id,url) DO UPDATE SET processing_status='queued',updated_at=CURRENT_TIMESTAMP`)
        .bind(ownerId, title, "等待处理", body.category?.trim() || "待整理", resourceType, resourceUrl, inputType === "url" ? "网页链接" : inputType === "paste" ? "粘贴正文" : "文件上传", sourceUrl).run();
      resourceId = Number(result.meta.last_row_id || 0);
      if (!resourceId) resourceId = Number((await getDatabase().prepare("SELECT id FROM resources WHERE owner_id=? AND url=?").bind(ownerId, resourceUrl).first<{ id: number }>())?.id || 0);
    } else {
      const resource = await getDatabase().prepare("SELECT source_url,url FROM resources WHERE owner_id=? AND id=?").bind(ownerId, resourceId).first<Record<string, unknown>>();
      if (!resource) return jsonError(new Error("资源不存在"), 404);
      sourceUrl ||= String(resource.source_url || "");
    }

    const jobId = await initializeProcessingJob({ ownerId, resourceId, inputType, sourceName: body.title?.trim() || sourceUrl || `资源 #${resourceId}`, sourceUrl, uploadId, startAt: inputType === "paste" ? "structure" : "original", pastedText });
    return Response.json({ ok: true, resourceId, jobId, status: "queued" }, { status: 202 });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { id?: number; action?: "pause" | "resume" | "retry_step" | "resume_from_failure" | "restart" | "cancel" | "later" | "confirm"; stepKey?: string };
    if (!body.id || !body.action) return jsonError(new Error("缺少处理任务或操作"), 400);
    const job = await getDatabase().prepare("SELECT * FROM processing_jobs WHERE owner_id=? AND id=?").bind(ownerId, body.id).first<Record<string, unknown>>();
    if (!job) return jsonError(new Error("处理任务不存在"), 404);
    const steps = await getDatabase().prepare("SELECT * FROM processing_job_steps WHERE owner_id=? AND job_id=? ORDER BY sort_order").bind(ownerId, body.id).all();
    if (body.action === "confirm") return jsonError(new Error("请打开复核工作台，完成检查后再发布"), 400);
    if (body.action === "later") {
      await getDatabase().prepare("UPDATE processing_jobs SET status='review_required',stage='稍后复核',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=?").bind(ownerId, body.id).run();
      return Response.json({ ok: true });
    }
    if (body.action === "pause") {
      const nextStatus = normalizeJobStatus(String(job.status)) === "running" ? "pausing" : "paused";
      await getDatabase().prepare("UPDATE processing_jobs SET status=?,pause_requested=1,stage=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=?").bind(nextStatus, nextStatus === "paused" ? "已暂停" : "等待安全暂停", ownerId, body.id).run();
    } else if (body.action === "cancel") {
      await getDatabase().batch([
        getDatabase().prepare("UPDATE processing_jobs SET status='cancelled',pause_requested=1,stage='已取消',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=?").bind(ownerId, body.id),
        getDatabase().prepare("UPDATE processing_job_steps SET status='paused',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND job_id=? AND status='running'").bind(ownerId, body.id),
      ]);
    } else if (body.action === "resume" || body.action === "resume_from_failure" || body.action === "retry_step") {
      if (!(steps.results as Record<string, unknown>[]).length) return jsonError(new Error("旧版任务没有断点记录，请使用从头重新处理"), 409);
      const stepKey = body.stepKey || String(job.current_step || "");
      if (!stepKey) return jsonError(new Error("没有可继续的处理步骤"), 400);
      await getDatabase().batch([
        getDatabase().prepare("UPDATE processing_job_steps SET status='pending',error_code='',error_message='',error_detail_json='{}',completed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND job_id=? AND step_key=? AND status NOT IN ('completed','skipped')").bind(ownerId, body.id, stepKey),
        getDatabase().prepare("UPDATE processing_job_steps SET status='pending',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND job_id=? AND status='paused'").bind(ownerId, body.id),
        getDatabase().prepare("UPDATE processing_jobs SET status='queued',pause_requested=0,stage='从断点继续',current_step=?,error='',error_code='',error_message='',error_detail_json='{}',suggested_actions_json='[]',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=?").bind(stepKey, ownerId, body.id),
        getDatabase().prepare("UPDATE resources SET processing_status='queued',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=?").bind(ownerId, Number(job.result_resource_id)),
      ]);
    } else if (body.action === "restart") {
      let pastedText = "";
      if (String(job.input_type) === "paste") {
        const oldExtract = (steps.results as Record<string, unknown>[]).find((step) => step.step_key === "extract");
        if (oldExtract?.output_ref) pastedText = await (await getMediaBucket().get(String(oldExtract.output_ref)))?.text() || "";
      }
      const newJobId = await initializeProcessingJob({ ownerId, resourceId: Number(job.result_resource_id), inputType: String(job.input_type), sourceName: String(job.source_name), sourceUrl: String(job.source_url || ""), uploadId: job.upload_id ? Number(job.upload_id) : null, startAt: pastedText ? "structure" : "original", pastedText });
      await getDatabase().prepare("UPDATE resources SET processing_status='queued',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=?").bind(ownerId, Number(job.result_resource_id)).run();
      return Response.json({ ok: true, jobId: newJobId, status: "queued" });
    } else return jsonError(new Error("不支持的处理操作"), 400);
    return Response.json({ ok: true, job: (await loadJobs(ownerId, body.id))[0] });
  } catch (error) { return jsonError(error); }
}
