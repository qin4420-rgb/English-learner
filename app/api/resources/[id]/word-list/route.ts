import { saveVocabularyOccurrence } from "@/app/api/_lib/vocabulary-store";
import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";
import { normalizeResourceType, parseResourceMetadata, stringifyResourceMetadata } from "@/app/resource-model";

async function loadWordList(ownerId: string, id: number) {
  const resource = await getDatabase().prepare("SELECT * FROM resources WHERE owner_id=? AND id=?").bind(ownerId, id).first<Record<string, unknown>>();
  if (!resource || normalizeResourceType(resource.resource_type) !== "WordList") throw new Error("词库资源不存在");
  const metadata = parseResourceMetadata(resource.metadata_json, "WordList");
  return { resource, metadata, words: metadata.wordList?.words || [] };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase(); const ownerId = await getOwnerId(); const { id } = await context.params;
    const { metadata, words } = await loadWordList(ownerId, Number(id));
    return Response.json({ count: words.length, importedCount: metadata.wordList?.importedCount || 0, words: words.slice(0, 100) });
  } catch (error) { return jsonError(error, 404); }
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureDatabase(); const ownerId = await getOwnerId(); const { id } = await context.params; const resourceId = Number(id);
    const { resource, metadata, words } = await loadWordList(ownerId, resourceId);
    let processed = 0;
    for (const item of words) {
      await saveVocabularyOccurrence(ownerId, {
        word: item.word, definition: item.definition, phonetic: item.phonetic, example: item.example, tags: item.tags,
        sourceType: "wordlist", sourceId: String(resourceId), resourceId, sourceTitle: String(resource.title),
      });
      processed += 1;
    }
    const next = stringifyResourceMetadata({ ...metadata, wordList: { ...metadata.wordList!, importedCount: words.length } }, "WordList");
    await getDatabase().prepare("UPDATE resources SET metadata_json=?,processing_status='ready',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id=?").bind(next, ownerId, resourceId).run();
    return Response.json({ ok: true, processed });
  } catch (error) { return jsonError(error); }
}
