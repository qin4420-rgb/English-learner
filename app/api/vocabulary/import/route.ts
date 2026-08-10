import { ensureDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";
import { saveVocabularyOccurrence } from "@/app/api/_lib/vocabulary-store";
import { parseWordList } from "@/app/api/_lib/word-list";

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const form = await request.formData();
    const file = form.get("file");
    const resourceId = Number(form.get("resourceId") || 0) || null;
    const sourceTitle = String(form.get("sourceTitle") || (file instanceof File ? file.name : "外部词表"));
    if (!(file instanceof File)) return jsonError(new Error("请选择词表文件"), 400);
    if (file.size > 2 * 1024 * 1024) return jsonError(new Error("词表文件暂限 2MB"), 413);
    const words = parseWordList(await file.text(), file.name.toLowerCase().endsWith(".json") || file.type.includes("json"));
    if (!words.length) return jsonError(new Error("没有识别到单词；请使用CSV、TSV、TXT或JSON格式"), 400);
    for (const word of words) {
      await saveVocabularyOccurrence(ownerId, { ...word, sourceType: resourceId ? "word-list" : "import", resourceId, sourceTitle });
    }
    return Response.json({ ok: true, processed: words.length, skipped: 0 });
  } catch (error) { return jsonError(error); }
}
