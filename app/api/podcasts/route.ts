import { applePodcastResourceKey, parseApplePodcastUrl } from "@/app/apple-podcasts.mjs";
import { initializeProcessingJob, runProcessingWorkUnit } from "@/app/api/_lib/resource-processing";
import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";
import { parseResourceMetadata, stringifyResourceMetadata } from "@/app/resource-model";

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { appleUrl?: string };
    const podcast = parseApplePodcastUrl(body.appleUrl || "");
    if (podcast.kind !== "episode") return jsonError(new Error("请粘贴具体单集链接再加入精听。"), 400);
    const resourceKey = applePodcastResourceKey(podcast);
    const existing = await getDatabase().prepare("SELECT * FROM resources WHERE owner_id=? AND (url=? OR (resource_type='Podcast' AND source_url=?)) LIMIT 1")
      .bind(ownerId, resourceKey, podcast.appleUrl).first<Record<string, unknown>>();
    let resourceId = Number(existing?.id || 0);
    const currentMetadata = parseResourceMetadata(existing?.metadata_json, "Podcast");
    const currentPodcast = currentMetadata.podcast && typeof currentMetadata.podcast === "object" ? currentMetadata.podcast as Record<string, unknown> : {};
    const metadataJson = stringifyResourceMetadata({
      ...currentMetadata,
      podcast: { ...currentPodcast, provider: "apple_podcasts", ...podcast, studyMode: "intensive", intensiveStatus: "queued" },
      media: { ...currentMetadata.media, kind: "audio", source: String(currentPodcast.audioUrl || ""), extensiveReady: true, intensiveStatus: "queued", playable: true, sttAccessible: false, transcriptAvailable: false, sourceRestricted: false },
      learningUses: ["Listening", "Speaking", "Vocabulary"],
    }, "Podcast");
    if (resourceId) {
      await getDatabase().prepare("UPDATE resources SET url=?,source_url=?,metadata_json=?,processing_status='queued',status='active',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
        .bind(resourceKey, podcast.appleUrl, metadataJson, resourceId, ownerId).run();
    } else {
      const result = await getDatabase().prepare(`INSERT INTO resources (owner_id,title,description,category,level,skills,resource_type,url,source_name,source_url,collection,processing_status,translation_status,metadata_json,status)
        VALUES (?,?,?,'Podcast','未分级','听力','Podcast',?,'Apple Podcasts',?,'library','queued','pending',?,'active')`)
        .bind(ownerId, `Podcast Episode ${podcast.episodeId}`, "等待解析公开RSS、音频与Transcript", resourceKey, podcast.appleUrl, metadataJson).run();
      resourceId = Number(result.meta.last_row_id);
    }
    const activeJob = await getDatabase().prepare("SELECT id FROM processing_jobs WHERE owner_id=? AND result_resource_id=? AND status IN ('queued','running','processing','pausing','paused') ORDER BY id DESC LIMIT 1")
      .bind(ownerId, resourceId).first<{ id: number }>();
    let jobId = Number(activeJob?.id || 0);
    if (!jobId) {
      jobId = await initializeProcessingJob({ ownerId, resourceId, inputType: "url", sourceName: "Apple Podcast Episode", sourceUrl: podcast.appleUrl });
    }
    return Response.json({ ok: true, resourceId, jobId, existing: Boolean(existing) });
  } catch (error) { return jsonError(error, error instanceof Error && /Apple Podcasts|具体单集/.test(error.message) ? 400 : 500); }
}

export async function PATCH(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as { resourceId?: number; jobId?: number };
    if (!body.resourceId || !body.jobId) return jsonError(new Error("缺少Podcast处理任务"), 400);
    const job = await getDatabase().prepare("SELECT id FROM processing_jobs WHERE id=? AND result_resource_id=? AND owner_id=?").bind(body.jobId, body.resourceId, ownerId).first();
    if (!job) return jsonError(new Error("Podcast处理任务不存在"), 404);
    const result = await runProcessingWorkUnit({ ownerId, jobId: body.jobId });
    return Response.json({ ok: true, ...result });
  } catch (error) { return jsonError(error); }
}
