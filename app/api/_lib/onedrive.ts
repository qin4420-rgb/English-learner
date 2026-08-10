import {
  getDatabase,
  getRuntimeBindings,
} from "@/app/api/_lib/runtime";

const TOKEN_ENDPOINT = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
export const ONEDRIVE_SCOPES = "offline_access User.Read Files.ReadWrite.AppFolder";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function encryptionKey(): Promise<CryptoKey> {
  const secret = getRuntimeBindings().ONEDRIVE_TOKEN_KEY;
  if (!secret) throw new Error("OneDrive 令牌加密密钥尚未配置");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(value),
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptToken(value: string): Promise<string> {
  const [ivValue, cipherValue] = value.split(".");
  if (!ivValue || !cipherValue) throw new Error("OneDrive 授权令牌格式无效");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivValue) },
    await encryptionKey(),
    base64ToBytes(cipherValue),
  );
  return new TextDecoder().decode(decrypted);
}

export function oneDriveConfig(origin?: string) {
  const bindings = getRuntimeBindings();
  const redirectUri = bindings.ONEDRIVE_REDIRECT_URI
    || (origin ? `${origin}/api/onedrive/callback` : "");
  return {
    clientId: bindings.ONEDRIVE_CLIENT_ID || "",
    clientSecret: bindings.ONEDRIVE_CLIENT_SECRET || "",
    tokenKey: bindings.ONEDRIVE_TOKEN_KEY || "",
    redirectUri,
  };
}

export function assertOneDriveConfigured(origin?: string) {
  const config = oneDriveConfig(origin);
  if (!config.clientId || !config.clientSecret || !config.tokenKey || !config.redirectUri) {
    throw new Error("OneDrive 应用尚未完成配置，请先在维护中心查看连接说明");
  }
  return config;
}

async function exchangeRefreshToken(ownerId: string, encryptedRefreshToken: string): Promise<string> {
  const config = assertOneDriveConfigured();
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: await decryptToken(encryptedRefreshToken),
    scope: ONEDRIVE_SCOPES,
  });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = await response.json() as TokenResponse;
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || "OneDrive 授权已失效，请重新连接");
  }
  const nextRefreshToken = result.refresh_token
    ? await encryptToken(result.refresh_token)
    : encryptedRefreshToken;
  const expiresAt = new Date(Date.now() + Math.max(60, result.expires_in ?? 3600) * 1000).toISOString();
  await getDatabase()
    .prepare("UPDATE onedrive_connections SET encrypted_refresh_token=?, access_token_expires_at=?, status='connected', updated_at=CURRENT_TIMESTAMP WHERE owner_id=?")
    .bind(nextRefreshToken, expiresAt, ownerId)
    .run();
  return result.access_token;
}

export async function getOneDriveAccessToken(ownerId: string): Promise<string> {
  const connection = await getDatabase()
    .prepare("SELECT encrypted_refresh_token,status FROM onedrive_connections WHERE owner_id=?")
    .bind(ownerId)
    .first<{ encrypted_refresh_token: string; status: string }>();
  if (!connection?.encrypted_refresh_token || connection.status !== "connected") {
    throw new Error("请先连接个人版 OneDrive");
  }
  return exchangeRefreshToken(ownerId, connection.encrypted_refresh_token);
}

async function graphRequest<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${GRAPH_ROOT}${path}`, { ...init, headers });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(result.error?.message || `OneDrive 操作失败（${response.status}）`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function safeSegment(value: string): string {
  return value
    .replace(/[\\/:*?"<>|#%]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "untitled";
}

async function ensureFolder(accessToken: string, segments: string[]): Promise<void> {
  let parentPath = "";
  for (const segment of segments) {
    const nextPath = [...(parentPath ? parentPath.split("/") : []), safeSegment(segment)];
    const encodedPath = nextPath.map(encodeURIComponent).join("/");
    const exists = await fetch(`${GRAPH_ROOT}/me/drive/special/approot:/${encodedPath}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (exists.status === 404) {
      const parentEndpoint = parentPath
        ? `/me/drive/special/approot:/${parentPath.split("/").map(encodeURIComponent).join("/")}:/children`
        : "/me/drive/special/approot/children";
      await graphRequest(accessToken, parentEndpoint, {
        method: "POST",
        body: JSON.stringify({
          name: safeSegment(segment),
          folder: {},
          "@microsoft.graph.conflictBehavior": "fail",
        }),
      });
    } else if (!exists.ok) {
      throw new Error(`OneDrive 目录检查失败（${exists.status}）`);
    }
    parentPath = nextPath.join("/");
  }
}

export async function saveMarkdownToOneDrive(
  ownerId: string,
  path: string,
  markdown: string,
): Promise<void> {
  const accessToken = await getOneDriveAccessToken(ownerId);
  const rawSegments = path.split("/").filter(Boolean);
  const filename = safeSegment(rawSegments.pop() || "article.md");
  await ensureFolder(accessToken, rawSegments);
  const fullPath = [...rawSegments.map(safeSegment), filename].map(encodeURIComponent).join("/");
  await graphRequest(accessToken, `/me/drive/special/approot:/${fullPath}:/content`, {
    method: "PUT",
    headers: { "content-type": "text/markdown; charset=utf-8" },
    body: markdown,
  });
  await getDatabase()
    .prepare("UPDATE onedrive_connections SET last_sync_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE owner_id=?")
    .bind(ownerId)
    .run();
}

export async function saveOriginalToOneDrive(
  ownerId: string,
  filename: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<{ itemId: string; path: string }> {
  const accessToken = await getOneDriveAccessToken(ownerId);
  const folder = "00_Inbox";
  await ensureFolder(accessToken, [folder]);
  const safeFilename = safeSegment(filename);
  const item = await graphRequest<{ id?: string }>(
    accessToken,
    `/me/drive/special/approot:/${encodeURIComponent(folder)}/${encodeURIComponent(safeFilename)}:/content`,
    {
      method: "PUT",
      headers: { "content-type": contentType || "application/octet-stream" },
      body,
    },
  );
  if (!item.id) throw new Error("OneDrive 未返回文件编号");
  return { itemId: item.id, path: `${folder}/${safeFilename}` };
}

export async function moveOneDriveItemToRecycleBin(ownerId: string, itemId: string): Promise<void> {
  if (!itemId) return;
  const accessToken = await getOneDriveAccessToken(ownerId);
  await graphRequest(accessToken, `/me/drive/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
}
