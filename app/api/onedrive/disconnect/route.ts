import {
  ensureDatabase,
  getDatabase,
  getOwnerId,
  jsonError,
} from "@/app/api/_lib/runtime";

export async function POST() {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    await getDatabase().prepare("DELETE FROM onedrive_connections WHERE owner_id=?").bind(ownerId).run();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
