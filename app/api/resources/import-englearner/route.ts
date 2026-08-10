import { fetchEngLearnerResources } from "@/app/api/_lib/englearner";
import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";

export async function POST() {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const resources = await fetchEngLearnerResources();
    const database = getDatabase();
    const orderState = await database
      .prepare(
        "SELECT COUNT(*) AS item_count, COUNT(DISTINCT sort_order) AS distinct_orders FROM resources WHERE owner_id=? AND source_name='EngLearner 资源目录'",
      )
      .bind(ownerId)
      .first<{ item_count: number; distinct_orders: number }>();
    const initializeExistingOrder = Number(orderState?.item_count ?? 0) > 1
      && Number(orderState?.distinct_orders ?? 0) <= 1;
    const conflictUpdate = initializeExistingOrder
      ? "source_url=excluded.source_url, icon_url=CASE WHEN resources.icon_url='' THEN excluded.icon_url ELSE resources.icon_url END, description=CASE WHEN resources.description LIKE '%收录于%' THEN excluded.description ELSE resources.description END, collection='tool', sort_order=excluded.sort_order, last_checked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP"
      : "source_url=excluded.source_url, icon_url=CASE WHEN resources.icon_url='' THEN excluded.icon_url ELSE resources.icon_url END, description=CASE WHEN resources.description LIKE '%收录于%' THEN excluded.description ELSE resources.description END, collection='tool', last_checked_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP";
    const statements = resources.map((item, index) =>
      database
        .prepare(`INSERT INTO resources (owner_id,title,description,category,level,skills,resource_type,url,source_name,source_url,collection,icon_url,sort_order,last_checked_at)
          VALUES (?,?,?,?,?,?,?,?,?,?, 'tool',?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(owner_id,url) DO UPDATE SET ${conflictUpdate}`)
        .bind(ownerId, item.title, item.description, item.category, item.level, item.skills, item.resourceType, item.url, item.sourceName, item.sourceUrl, item.iconUrl, index),
    );
    for (let index = 0; index < statements.length; index += 75) {
      await database.batch(statements.slice(index, index + 75));
    }
    return Response.json({ ok: true, imported: resources.length });
  } catch (error) {
    return jsonError(error);
  }
}
