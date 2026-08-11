import { parseDictionary } from "@/app/api/_lib/dictionary";
import { saveOriginalToOneDrive } from "@/app/api/_lib/onedrive";
import { initializeProcessingJob } from "@/app/api/_lib/resource-processing";
import { ensureDatabase, getDatabase, getMediaBucket, getOwnerId, jsonError } from "@/app/api/_lib/runtime";
import { parseWordList } from "@/app/api/_lib/word-list";
import { inferResourceType, normalizeResourceType, normalizeTags, stringifyResourceMetadata, type LearningUse, type ResourceType } from "@/app/resource-model";

async function saveUpload(ownerId: string, file: File) {
  if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} 超过网页单文件25MB限制；请改用可访问的媒体链接`);
  const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120) || "file";
  const objectKey = `${ownerId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
  const bytes = await file.arrayBuffer();
  await getMediaBucket().put(objectKey, bytes, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  let storageProvider = "r2";
  let externalItemId = "";
  let externalPath = "";
  let status = "uploaded";
  try {
    const uploaded = await saveOriginalToOneDrive(ownerId, file.name, bytes, file.type || "application/octet-stream");
    storageProvider = "onedrive+r2"; externalItemId = uploaded.itemId; externalPath = uploaded.path; status = "ready_for_processing";
  } catch { status = "onedrive_pending"; }
  const result = await getDatabase().prepare("INSERT INTO uploads (owner_id,filename,object_key,content_type,size_bytes,storage_provider,external_item_id,external_path,status) VALUES (?,?,?,?,?,?,?,?,?)").bind(ownerId, file.name, objectKey, file.type || "application/octet-stream", file.size, storageProvider, externalItemId, externalPath, status).run();
  return { id: Number(result.meta.last_row_id), bytes };
}

async function insertResource(ownerId: string, input: { title: string; url: string; sourceUrl?: string; type: ResourceType; folderId?: number | null; tags?: string[]; learningUses?: LearningUse[]; metadata?: Record<string, unknown>; status?: string }) {
  const metadataJson = stringifyResourceMetadata({ ...(input.metadata || {}), tags: normalizeTags(input.tags), learningUses: input.learningUses }, input.type);
  const result = await getDatabase().prepare(`INSERT INTO resources (owner_id,title,description,category,level,skills,resource_type,url,source_name,source_url,collection,reading_folder_id,metadata_json,processing_status,translation_status,status)
    VALUES (?,?,'','未分类','未分级','综合',?,?,?,?,'library',?,?,?,'none','active')
    ON CONFLICT(owner_id,url) DO UPDATE SET title=excluded.title,resource_type=excluded.resource_type,source_url=excluded.source_url,reading_folder_id=excluded.reading_folder_id,metadata_json=excluded.metadata_json,processing_status=excluded.processing_status,status='active',updated_at=CURRENT_TIMESTAMP`)
    .bind(ownerId, input.title, input.type, input.url, input.sourceUrl ? "链接导入" : "文件导入", input.sourceUrl || "", input.folderId || null, metadataJson, input.status || "waiting").run();
  if (result.meta.last_row_id) return Number(result.meta.last_row_id);
  const existing = await getDatabase().prepare("SELECT id FROM resources WHERE owner_id=? AND url=?").bind(ownerId, input.url).first<{ id: number }>();
  return Number(existing?.id || 0);
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await request.json() as { url?: string; title?: string; resourceType?: string; tags?: string[]; learningUses?: LearningUse[]; folderId?: number };
      const sourceUrl = body.url?.trim();
      if (!sourceUrl) return jsonError(new Error("请输入资源链接"), 400);
      const parsed = new URL(sourceUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) return jsonError(new Error("只支持http或https链接"), 400);
      const type = body.resourceType ? normalizeResourceType(body.resourceType) : inferResourceType(sourceUrl);
      const title = body.title?.trim() || decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname).slice(0, 160);
      // A learning resource is separate from a Tool Directory bookmark that may
      // point to the same public URL. Keep the canonical source in source_url.
      const resourceUrl = `urn:english-room:link:${encodeURIComponent(sourceUrl)}`;
      const isMedia = ["Audio", "Video", "Podcast"].includes(type);
      const resourceId = await insertResource(ownerId, {
        title, url: resourceUrl, sourceUrl, type, folderId: body.folderId || null, tags: body.tags, learningUses: body.learningUses,
        status: isMedia ? "ready" : "waiting",
        metadata: isMedia ? { media: { kind: type === "Video" ? "video" : "audio", source: sourceUrl, extensiveReady: true, intensiveStatus: "not_requested", playable: true, sttAccessible: !/youtube\.com|youtu\.be|vimeo\.com/i.test(sourceUrl), transcriptAvailable: false, sourceRestricted: /youtube\.com|youtu\.be/i.test(sourceUrl) } } : undefined,
      });
      if (type === "Article") {
        const jobId = await initializeProcessingJob({ ownerId, resourceId, inputType: "url", sourceName: title, sourceUrl, uploadId: null });
        return Response.json({ ok: true, resources: [resourceId], jobs: [jobId], status: "queued" }, { status: 202 });
      }
      return Response.json({ ok: true, resources: [resourceId], jobs: [], status: "ready" }, { status: 202 });
    }

    const form = await request.formData();
    const files = form.getAll("files").filter((file): file is File => file instanceof File);
    if (!files.length) return jsonError(new Error("请选择文件"), 400);
    const requestedType = String(form.get("resourceType") || "");
    const folderId = Number(form.get("folderId") || 0) || null;
    const tags = normalizeTags(String(form.get("tags") || ""));
    const learningUses = String(form.get("learningUses") || "").split(",").filter(Boolean) as LearningUse[];
    const resourceIds: number[] = [];
    const jobIds: number[] = [];
    for (const file of files) {
      const upload = await saveUpload(ownerId, file);
      const type = requestedType ? normalizeResourceType(requestedType) : inferResourceType(file.name, file.type);
      const isMedia = ["Audio", "Video", "Podcast"].includes(type);
      const resourceId = await insertResource(ownerId, {
        title: file.name.replace(/\.[^.]+$/, ""), url: `urn:english-room:upload:${upload.id}`, type, folderId, tags, learningUses,
        metadata: { uploadId: upload.id, mimeType: file.type, originalFilename: file.name, ...(isMedia ? { media: { kind: type === "Video" ? "video" : "audio", source: `/api/resources/__RESOURCE_ID__/media`, extensiveReady: true, intensiveStatus: "not_requested", playable: true, sttAccessible: true, transcriptAvailable: false, sourceRestricted: false } } : {}) },
        status: ["WordList", "Dictionary"].includes(type) ? "processing" : isMedia ? "ready" : "waiting",
      });
      resourceIds.push(resourceId);
      if (isMedia) {
        const mediaMetadata = stringifyResourceMetadata({ uploadId: upload.id, mimeType: file.type, originalFilename: file.name, tags, learningUses, media: { kind: type === "Video" ? "video" : "audio", source: `/api/resources/${resourceId}/media`, extensiveReady: true, intensiveStatus: "not_requested", playable: true, sttAccessible: true, transcriptAvailable: false, sourceRestricted: false } }, type);
        await getDatabase().prepare("UPDATE resources SET metadata_json=?,processing_status='ready',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(mediaMetadata, resourceId, ownerId).run();
      }
      if (type === "WordList") {
        const words = parseWordList(new TextDecoder().decode(upload.bytes), file.name.toLowerCase().endsWith(".json") || file.type.includes("json"));
        if (!words.length) throw new Error(`${file.name} 没有识别到词汇`);
        const metadataJson = stringifyResourceMetadata({ uploadId: upload.id, mimeType: file.type, originalFilename: file.name, tags, learningUses: ["Vocabulary"], wordList: { count: words.length, importedCount: 0, words } }, type);
        await getDatabase().prepare("UPDATE resources SET metadata_json=?,processing_status='review_required',description=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(metadataJson, `${words.length} 个词，等待加入单词本`, resourceId, ownerId).run();
      } else if (type === "Dictionary") {
        const entries = parseDictionary(new TextDecoder().decode(upload.bytes), file.name.toLowerCase().endsWith(".json") || file.type.includes("json"));
        if (!entries.length) throw new Error(`${file.name} 没有识别到词典词条`);
        const order = await getDatabase().prepare("SELECT COALESCE(MAX(sort_order),-1)+1 AS next_order FROM dictionary_sources WHERE owner_id=?").bind(ownerId).first<{ next_order: number }>();
        const sourceResult = await getDatabase().prepare("INSERT INTO dictionary_sources (owner_id,resource_id,name,enabled,sort_order) VALUES (?,?,?,1,?) ON CONFLICT(owner_id,resource_id) DO UPDATE SET name=excluded.name").bind(ownerId, resourceId, file.name.replace(/\.[^.]+$/, ""), Number(order?.next_order || 0)).run();
        let sourceId = Number(sourceResult.meta.last_row_id || 0);
        if (!sourceId) sourceId = Number((await getDatabase().prepare("SELECT id FROM dictionary_sources WHERE owner_id=? AND resource_id=?").bind(ownerId, resourceId).first<{ id: number }>())?.id || 0);
        for (let index = 0; index < entries.length; index += 100) {
          await getDatabase().batch(entries.slice(index, index + 100).map((entry) => getDatabase().prepare(`INSERT INTO dictionary_entries (source_id,headword,phonetic,part_of_speech,definition,definition_en,example,extra_json) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(source_id,headword) DO UPDATE SET phonetic=excluded.phonetic,part_of_speech=excluded.part_of_speech,definition=excluded.definition,definition_en=excluded.definition_en,example=excluded.example,extra_json=excluded.extra_json`).bind(sourceId, entry.headword, entry.phonetic, entry.partOfSpeech, entry.definition, entry.definitionEn, entry.example, entry.extraJson)));
        }
        const metadataJson = stringifyResourceMetadata({ uploadId: upload.id, mimeType: file.type, originalFilename: file.name, tags, dictionary: { entryCount: entries.length, sourceId } }, type);
        await getDatabase().prepare("UPDATE resources SET metadata_json=?,processing_status='ready',description=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(metadataJson, `${entries.length} 条结构化词典词条`, resourceId, ownerId).run();
      } else if (!isMedia) {
        const jobId = await initializeProcessingJob({ ownerId, resourceId, inputType: "upload", sourceName: file.name, uploadId: upload.id });
        jobIds.push(jobId);
      }
    }
    return Response.json({ ok: true, resources: resourceIds, jobs: jobIds, status: jobIds.length ? "queued" : "ready" }, { status: 202 });
  } catch (error) { return jsonError(error); }
}
