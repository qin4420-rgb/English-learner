const APPLE_HOST = "podcasts.apple.com";
const APPLE_EMBED_HOST = "embed.podcasts.apple.com";

/**
 * Parse a public Apple Podcasts HTTPS URL without accepting arbitrary iframe sources.
 * @param {string} value
 * @returns {{appleUrl: string, embedUrl: string, showId: string, episodeId: string, kind: "episode" | "show"}}
 */
export function parseApplePodcastUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("这不是有效的 Apple Podcasts 链接。");
  }
  if (url.protocol !== "https:" || url.hostname !== APPLE_HOST) {
    throw new Error("这不是有效的 Apple Podcasts 链接。");
  }
  const showId = url.pathname.match(/\/id(\d+)(?:\/|$)/)?.[1] || "";
  if (!showId) throw new Error("这不是有效的 Apple Podcasts 链接。");
  const episodeId = url.searchParams.get("i")?.trim() || "";
  if (episodeId && !/^\d+$/.test(episodeId)) throw new Error("这不是有效的 Apple Podcasts 链接。");
  const embed = new URL(url.href);
  embed.hostname = APPLE_EMBED_HOST;
  return {
    appleUrl: url.href,
    embedUrl: embed.href,
    showId,
    episodeId,
    kind: episodeId ? "episode" : "show",
  };
}

/** @param {string} value */
export function isApplePodcastUrl(value) {
  try {
    parseApplePodcastUrl(value);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} value */
export function buildApplePodcastEmbedUrl(value) {
  return parseApplePodcastUrl(value).embedUrl;
}

/** @param {{showId: string, episodeId: string}} podcast */
export function applePodcastResourceKey(podcast) {
  return `urn:english-room:podcast:apple:${podcast.episodeId ? `episode-${podcast.episodeId}` : `show-${podcast.showId}`}`;
}
