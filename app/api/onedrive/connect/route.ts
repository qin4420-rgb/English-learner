import {
  ensureDatabase,
  getDatabase,
  getOwnerId,
  jsonError,
} from "@/app/api/_lib/runtime";
import {
  ONEDRIVE_SCOPES,
  assertOneDriveConfigured,
} from "@/app/api/_lib/onedrive";

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const origin = new URL(request.url).origin;
    const config = assertOneDriveConfigured(origin);
    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await getDatabase().batch([
      getDatabase().prepare("DELETE FROM oauth_states WHERE expires_at < CURRENT_TIMESTAMP"),
      getDatabase()
        .prepare("INSERT INTO oauth_states (state,owner_id,provider,expires_at) VALUES (?,?,?,?)")
        .bind(state, ownerId, "onedrive", expiresAt),
    ]);
    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      redirect_uri: config.redirectUri,
      response_mode: "query",
      scope: ONEDRIVE_SCOPES,
      state,
      prompt: "select_account",
    });
    return Response.json({
      authorizationUrl: `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${params.toString()}`,
    });
  } catch (error) {
    return jsonError(error);
  }
}
