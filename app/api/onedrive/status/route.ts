import {
  ensureDatabase,
  getDatabase,
  getOwnerId,
  jsonError,
} from "@/app/api/_lib/runtime";
import { oneDriveConfig } from "@/app/api/_lib/onedrive";

export async function GET(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const config = oneDriveConfig(new URL(request.url).origin);
    const connection = await getDatabase()
      .prepare("SELECT account_label,status,last_sync_at,created_at FROM onedrive_connections WHERE owner_id=?")
      .bind(ownerId)
      .first<Record<string, unknown>>();
    return Response.json({
      configured: Boolean(config.clientId && config.clientSecret && config.tokenKey && config.redirectUri),
      connected: connection?.status === "connected",
      accountLabel: String(connection?.account_label ?? "个人版 OneDrive"),
      lastSyncAt: String(connection?.last_sync_at ?? ""),
      redirectUri: config.redirectUri,
      appFolder: "OneDrive / Apps / Scott English Room",
      retentionDays: 30,
    });
  } catch (error) {
    return jsonError(error);
  }
}
