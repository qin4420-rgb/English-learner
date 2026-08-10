import {
  ensureDatabase,
  getDatabase,
  getOwnerId,
  jsonError,
} from "@/app/api/_lib/runtime";

type ReorderInput = {
  category?: string;
  orderedIds?: number[];
};

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = (await request.json()) as ReorderInput;
    const category = body.category?.trim();
    const orderedIds = body.orderedIds?.filter(Number.isInteger) ?? [];

    if (!category || !orderedIds.length) {
      return jsonError(new Error("缺少分类或排序数据"), 400);
    }

    const uniqueIds = [...new Set(orderedIds)];
    if (uniqueIds.length !== orderedIds.length || orderedIds.length > 500) {
      return jsonError(new Error("排序数据无效"), 400);
    }

    const owned = await getDatabase()
      .prepare(
        `SELECT id, sort_order FROM resources WHERE owner_id=? AND category=? AND source_name='EngLearner 资源目录' ORDER BY sort_order, title`,
      )
      .bind(ownerId, category)
      .all();

    const categoryRows = owned.results as { id: number; sort_order: number }[];
    const allowedIds = new Set(categoryRows.map((row) => Number(row.id)));
    const includesEveryId = orderedIds.every((id) => allowedIds.has(id));
    if (categoryRows.length !== orderedIds.length || !includesEveryId) {
      return jsonError(new Error("部分资源不存在或不属于当前分类"), 400);
    }

    const baseOrder = Math.min(
      ...categoryRows.map((row) => Number(row.sort_order ?? 0)),
    );
    const statements = orderedIds.map((id, index) =>
      getDatabase()
        .prepare(
          "UPDATE resources SET sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=? AND category=? AND source_name='EngLearner 资源目录'",
        )
        .bind(baseOrder + index, id, ownerId, category),
    );
    await getDatabase().batch(statements);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
