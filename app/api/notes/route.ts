import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";
import { saveMarkdownToOneDrive } from "@/app/api/_lib/onedrive";

function mapNote(row: Record<string, unknown>) {
  return { id: Number(row.id), title: String(row.title), content: String(row.content ?? ""), referenceType: String(row.reference_type ?? "general"), referenceId: String(row.reference_id ?? ""), anchor: String(row.anchor ?? ""), tags: String(row.tags ?? ""), markdownPath: String(row.markdown_path ?? ""), syncStatus: String(row.sync_status ?? "pending"), createdAt: String(row.created_at ?? ""), updatedAt: String(row.updated_at ?? "") };
}

export async function GET() {
  try {
    await ensureDatabase(); const ownerId = await getOwnerId();
    const result = await getDatabase().prepare("SELECT * FROM notes WHERE owner_id=? ORDER BY updated_at DESC").bind(ownerId).all();
    return Response.json({ notes: (result.results as Record<string, unknown>[]).map(mapNote) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase(); const ownerId = await getOwnerId();
    const body = await request.json() as { id?: number; title?: string; content?: string; referenceType?: string; referenceId?: string; anchor?: string; tags?: string };
    if (!body.title?.trim()) return jsonError(new Error("笔记标题不能为空"), 400);
    let id = body.id;
    if (id) {
      await getDatabase().prepare("UPDATE notes SET title=?,content=?,reference_type=?,reference_id=?,anchor=?,tags=?,sync_status='pending',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(body.title.trim(), body.content || "", body.referenceType || "general", body.referenceId || "", body.anchor || "", body.tags || "", id, ownerId).run();
    } else {
      const result = await getDatabase().prepare("INSERT INTO notes (owner_id,title,content,reference_type,reference_id,anchor,tags) VALUES (?,?,?,?,?,?,?)").bind(ownerId, body.title.trim(), body.content || "", body.referenceType || "general", body.referenceId || "", body.anchor || "", body.tags || "").run();
      id = Number(result.meta.last_row_id);
    }
    const path = `20_Notes/note-${id}.md`;
    const markdown = `---\nid: note-${id}\ntitle: ${JSON.stringify(body.title.trim())}\nreference_type: ${body.referenceType || "general"}\nreference_id: ${body.referenceId || ""}\nanchor: ${body.anchor || ""}\ntags: ${body.tags || ""}\n---\n\n# ${body.title.trim()}\n\n${body.content || ""}\n`;
    let syncStatus = "pending";
    try { await saveMarkdownToOneDrive(ownerId, path, markdown); syncStatus = "synced"; } catch { /* OneDrive may not be connected yet. */ }
    await getDatabase().prepare("UPDATE notes SET markdown_path=?,sync_status=? WHERE id=? AND owner_id=?").bind(path, syncStatus, id, ownerId).run();
    return Response.json({ ok: true, id, syncStatus });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: Request) {
  try { await ensureDatabase(); const ownerId = await getOwnerId(); const id = Number(new URL(request.url).searchParams.get("id")); await getDatabase().prepare("DELETE FROM notes WHERE id=? AND owner_id=?").bind(id, ownerId).run(); return Response.json({ ok: true }); } catch (error) { return jsonError(error); }
}
