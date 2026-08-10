import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";

export async function POST(request: Request) {
  try {
    await ensureDatabase(); const ownerId = await getOwnerId();
    const body = await request.json() as {
      ids?: number[];
      action?: "delete" | "category" | "hide" | "renameCategory" | "mergeCategory" | "deleteCategory";
      category?: string;
      fromCategory?: string;
      targetCategory?: string;
    };
    if (["renameCategory", "mergeCategory", "deleteCategory"].includes(body.action || "")) {
      const fromCategory = body.fromCategory?.trim();
      if (!fromCategory) return jsonError(new Error("缺少原分类"), 400);
      const targetCategory = body.action === "deleteCategory" ? "未分类" : body.targetCategory?.trim();
      if (!targetCategory) return jsonError(new Error("请选择目标分类"), 400);
      if (targetCategory === fromCategory) return jsonError(new Error("目标分类不能与原分类相同"), 400);
      const result = await getDatabase().prepare("UPDATE resources SET category=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND collection='tool' AND category=?").bind(targetCategory, ownerId, fromCategory).run();
      return Response.json({ ok: true, affected: result.meta.changes || 0, category: targetCategory });
    }
    const ids = [...new Set((body.ids || []).filter(Number.isInteger))];
    if (!ids.length || ids.length > 500) return jsonError(new Error("请选择要批量维护的项目"), 400);
    const placeholders = ids.map(() => "?").join(",");
    if (body.action === "delete") {
      await getDatabase().prepare(`DELETE FROM resources WHERE owner_id=? AND id IN (${placeholders})`).bind(ownerId, ...ids).run();
    } else if (body.action === "category") {
      if (!body.category?.trim()) return jsonError(new Error("请输入新的分类"), 400);
      await getDatabase().prepare(`UPDATE resources SET category=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id IN (${placeholders})`).bind(body.category.trim(), ownerId, ...ids).run();
    } else if (body.action === "hide") {
      await getDatabase().prepare(`UPDATE resources SET status='hidden',updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND id IN (${placeholders})`).bind(ownerId, ...ids).run();
    } else {
      return jsonError(new Error("批量操作类型无效"), 400);
    }
    return Response.json({ ok: true, affected: ids.length });
  } catch (error) { return jsonError(error); }
}
