import { ensureDatabase, getDatabase } from "@/app/api/_lib/runtime";
import {
  ONEDRIVE_SCOPES,
  assertOneDriveConfigured,
  encryptToken,
} from "@/app/api/_lib/onedrive";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error_description?: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnUrl = new URL("/#admin", url.origin);
  try {
    await ensureDatabase();
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const remoteError = url.searchParams.get("error_description");
    if (remoteError) throw new Error(remoteError);
    if (!code || !state) throw new Error("OneDrive 返回的授权信息不完整");
    const stateRow = await getDatabase()
      .prepare("SELECT owner_id,expires_at FROM oauth_states WHERE state=? AND provider='onedrive'")
      .bind(state)
      .first<{ owner_id: string; expires_at: string }>();
    if (!stateRow || new Date(stateRow.expires_at).getTime() < Date.now()) {
      throw new Error("OneDrive 授权请求已过期，请重新连接");
    }
    await getDatabase().prepare("DELETE FROM oauth_states WHERE state=?").bind(state).run();
    const config = assertOneDriveConfigured(url.origin);
    const tokenResponse = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: config.redirectUri,
        scope: ONEDRIVE_SCOPES,
      }),
    });
    const tokens = await tokenResponse.json() as TokenResponse;
    if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) {
      throw new Error(tokens.error_description || "OneDrive 授权令牌获取失败");
    }
    const authHeaders = { authorization: `Bearer ${tokens.access_token}` };
    const [profileResponse, folderResponse] = await Promise.all([
      fetch("https://graph.microsoft.com/v1.0/me", { headers: authHeaders }),
      fetch("https://graph.microsoft.com/v1.0/me/drive/special/approot", { headers: authHeaders }),
    ]);
    if (!profileResponse.ok || !folderResponse.ok) throw new Error("OneDrive 专用资料夹创建失败");
    const profile = await profileResponse.json() as { displayName?: string; mail?: string; userPrincipalName?: string };
    const folder = await folderResponse.json() as { id?: string; parentReference?: { driveId?: string } };
    const expiresAt = new Date(Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000).toISOString();
    await getDatabase()
      .prepare(`INSERT INTO onedrive_connections (owner_id,account_label,drive_id,app_folder_id,encrypted_refresh_token,access_token_expires_at,status,last_sync_at)
        VALUES (?,?,?,?,?,?, 'connected',CURRENT_TIMESTAMP)
        ON CONFLICT(owner_id) DO UPDATE SET account_label=excluded.account_label, drive_id=excluded.drive_id, app_folder_id=excluded.app_folder_id, encrypted_refresh_token=excluded.encrypted_refresh_token, access_token_expires_at=excluded.access_token_expires_at, status='connected', last_sync_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP`)
      .bind(
        stateRow.owner_id,
        profile.displayName || profile.mail || profile.userPrincipalName || "个人版 OneDrive",
        folder.parentReference?.driveId || "",
        folder.id || "",
        await encryptToken(tokens.refresh_token),
        expiresAt,
      )
      .run();
    returnUrl.searchParams.set("onedrive", "connected");
  } catch (error) {
    returnUrl.searchParams.set("onedrive", "error");
    returnUrl.searchParams.set("message", error instanceof Error ? error.message : "连接失败");
  }
  return Response.redirect(returnUrl.toString(), 302);
}
