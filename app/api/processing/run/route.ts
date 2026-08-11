import { runProcessingWorkUnit } from "@/app/api/_lib/resource-processing";
import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { jobId?: number };
    const jobId = Number(body.jobId || 0);
    if (!jobId) return jsonError(new Error("缺少处理任务"), 400);
    const owned = await getDatabase().prepare("SELECT id FROM processing_jobs WHERE owner_id=? AND id=?").bind(ownerId, jobId).first();
    if (!owned) return jsonError(new Error("处理任务不存在"), 404);
    return Response.json(await runProcessingWorkUnit({ ownerId, jobId }));
  } catch (error) { return jsonError(error); }
}
