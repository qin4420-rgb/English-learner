import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";

function mapReadingProgress(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    resourceId: Number(row.resource_id),
    progressRatio: Number(row.progress_ratio ?? 0),
    anchor: String(row.anchor ?? ""),
    completed: Boolean(row.completed),
    fontSize: Number(row.font_size ?? 20),
    fontFamily: String(row.font_family ?? "serif"),
    lineHeight: Number(row.line_height ?? 1.9),
    contentWidth: String(row.content_width ?? "standard"),
    translationMode: String(row.translation_mode ?? "original"),
    outlineJson: String(row.outline_json ?? "[]"),
    formatVersion: Number(row.format_version ?? 1),
    lastReadAt: String(row.last_read_at ?? ""),
  };
}

export async function GET() {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const result = await getDatabase()
      .prepare("SELECT * FROM reading_progress WHERE owner_id=? ORDER BY last_read_at DESC")
      .bind(ownerId)
      .all();
    return Response.json({ progress: (result.results as Record<string, unknown>[]).map(mapReadingProgress) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = await request.json() as {
      resourceId?: number;
      progressRatio?: number;
      anchor?: string;
      completed?: boolean;
      fontSize?: number;
      fontFamily?: string;
      lineHeight?: number;
      contentWidth?: string;
      translationMode?: string;
      outlineJson?: string;
      formatVersion?: number;
    };
    const resourceId = Number(body.resourceId);
    if (!resourceId) return jsonError(new Error("缺少文章编号"), 400);
    const resource = await getDatabase()
      .prepare("SELECT id FROM resources WHERE id=? AND owner_id=? AND collection='library'")
      .bind(resourceId, ownerId)
      .first();
    if (!resource) return jsonError(new Error("文章不存在"), 404);

    const progressRatio = Math.min(1, Math.max(0, Number(body.progressRatio ?? 0)));
    const fontSize = Math.min(30, Math.max(14, Math.round(Number(body.fontSize ?? 20))));
    const lineHeight = Math.min(2.5, Math.max(1.35, Number(body.lineHeight ?? 1.9)));
    const fontFamily = ["serif", "sans"].includes(body.fontFamily || "") ? body.fontFamily : "serif";
    const contentWidth = ["narrow", "standard", "wide"].includes(body.contentWidth || "") ? body.contentWidth : "standard";
    const translationMode = ["original", "bilingual", "translation"].includes(body.translationMode || "") ? body.translationMode : "original";
    const outlineJson = String(body.outlineJson || "[]").slice(0, 24000);
    const completed = Boolean(body.completed || progressRatio >= 0.98);

    await getDatabase()
      .prepare(`INSERT INTO reading_progress (owner_id,resource_id,progress_ratio,anchor,completed,font_size,font_family,line_height,content_width,translation_mode,outline_json,format_version,last_read_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(owner_id,resource_id) DO UPDATE SET progress_ratio=excluded.progress_ratio,anchor=excluded.anchor,completed=excluded.completed,font_size=excluded.font_size,font_family=excluded.font_family,line_height=excluded.line_height,content_width=excluded.content_width,translation_mode=excluded.translation_mode,outline_json=CASE WHEN excluded.outline_json!='[]' THEN excluded.outline_json ELSE reading_progress.outline_json END,format_version=excluded.format_version,last_read_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`)
      .bind(ownerId, resourceId, progressRatio, String(body.anchor || "").slice(0, 180), completed ? 1 : 0, fontSize, fontFamily, lineHeight, contentWidth, translationMode, outlineJson, Math.max(1, Number(body.formatVersion || 1)))
      .run();
    return Response.json({ ok: true, progressRatio, completed });
  } catch (error) {
    return jsonError(error);
  }
}
