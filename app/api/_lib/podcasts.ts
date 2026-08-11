import { parseResourceMetadata } from "@/app/resource-model";
import { parseApplePodcastUrl } from "@/app/apple-podcasts.mjs";
import type { MediaSegment } from "@/app/types";

type LookupResult = {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  collectionId?: number;
  trackName?: string;
  collectionName?: string;
  feedUrl?: string;
  episodeUrl?: string;
  trackTimeMillis?: number;
};

export type PodcastMediaSource = {
  title: string;
  description: string;
  audioUrl: string;
  durationMs: number;
  segments: MediaSegment[];
  transcriptText: string;
  transcriptSource: string;
  restricted: boolean;
  podcast: Record<string, unknown>;
};

function decodeXml(value: string) {
  const named: Record<string, string> = { amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&([a-zA-Z]+);/g, (_, name: string) => named[name] ?? `&${name};`)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .trim();
}

function stripMarkup(value: string) {
  return decodeXml(value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function tag(xml: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeXml(xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"))?.[1] || "");
}

function attribute(value: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeXml(value.match(new RegExp(`${escaped}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1] || "");
}

function publicHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return "";
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "::1") return "";
    return url.href;
  } catch { return ""; }
}

function normalizedTitle(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function appleLookup(showId: string, episodeId: string) {
  const urls = [
    `https://itunes.apple.com/lookup?id=${encodeURIComponent(showId)}&media=podcast&entity=podcastEpisode&limit=200`,
    ...(episodeId ? [`https://itunes.apple.com/lookup?id=${encodeURIComponent(episodeId)}&entity=podcastEpisode`] : []),
  ];
  const responses = await Promise.all(urls.map(async (url) => {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return [] as LookupResult[];
    const data = await response.json() as { results?: LookupResult[] };
    return data.results || [];
  }));
  const results = responses.flat();
  const episode = results.find((item) => String(item.trackId || "") === episodeId && (item.kind === "podcast-episode" || item.episodeUrl));
  const show = results.find((item) => item.wrapperType === "track" && item.kind === "podcast" && !item.episodeUrl)
    || results.find((item) => item.feedUrl);
  return { episode, show };
}

function parseRssItem(xml: string, episodeTitle: string, episodeAudio: string) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  const targetTitle = normalizedTitle(episodeTitle);
  const matched = items.find((item) => {
    const title = normalizedTitle(stripMarkup(tag(item, "title")));
    const enclosure = publicHttpUrl(attribute(item.match(/<enclosure\b[^>]*>/i)?.[0] || "", "url"));
    return Boolean(targetTitle && title === targetTitle) || Boolean(episodeAudio && enclosure === episodeAudio);
  });
  if (!matched) return null;
  const enclosureTag = matched.match(/<enclosure\b[^>]*>/i)?.[0] || "";
  const transcriptTags = matched.match(/<podcast:transcript\b[^>]*>/gi) || [];
  const transcripts = transcriptTags.map((entry) => ({
    url: publicHttpUrl(attribute(entry, "url")),
    type: attribute(entry, "type").toLowerCase(),
    rel: attribute(entry, "rel").toLowerCase(),
  })).filter((entry) => entry.url);
  return {
    title: stripMarkup(tag(matched, "title")) || episodeTitle,
    audioUrl: publicHttpUrl(attribute(enclosureTag, "url")),
    description: stripMarkup(tag(matched, "description") || tag(matched, "content:encoded")),
    duration: tag(matched, "itunes:duration"),
    transcripts,
  };
}

function toMilliseconds(value: string) {
  const normalized = value.trim().replace(',', '.');
  const parts = normalized.split(':').map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return Number.NaN;
  const seconds = parts.pop() || 0;
  const minutes = parts.pop() || 0;
  const hours = parts.pop() || 0;
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function parseTimedText(value: string): MediaSegment[] {
  const blocks = value.replace(/^WEBVTT[^\n]*\n/i, "").replace(/\r/g, "").split(/\n{2,}/);
  const segments: MediaSegment[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timingIndex = lines.findIndex((line) => /\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+/.test(line));
    if (timingIndex < 0) continue;
    const [startValue, endValue] = lines[timingIndex].split("-->").map((entry) => entry.trim().split(/\s+/)[0]);
    const startMs = toMilliseconds(startValue);
    const endMs = toMilliseconds(endValue);
    const originalText = stripMarkup(lines.slice(timingIndex + 1).join(" "));
    if (!Number.isFinite(startMs) || !originalText) continue;
    segments.push({ id: `s${String(segments.length + 1).padStart(4, "0")}`, startMs, endMs: Number.isFinite(endMs) && endMs > startMs ? endMs : startMs + 5000, originalText });
  }
  return segments;
}

function parseJsonTranscript(value: string): MediaSegment[] {
  const parsed = JSON.parse(value) as { segments?: Record<string, unknown>[] } | Record<string, unknown>[];
  const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed.segments) ? parsed.segments : [];
  return source.flatMap((item, index) => {
    const start = Number(item.startMs ?? item.startTime ?? item.start ?? 0);
    const end = Number(item.endMs ?? item.endTime ?? item.end ?? Number.NaN);
    const startMs = start > 10000 ? start : start * 1000;
    const endMs = end > 10000 ? end : end * 1000;
    const originalText = String(item.body ?? item.text ?? item.originalText ?? "").trim();
    if (!Number.isFinite(startMs) || !originalText) return [];
    return [{ id: `s${String(index + 1).padStart(4, "0")}`, startMs, endMs: Number.isFinite(endMs) && endMs > startMs ? endMs : startMs + 5000, originalText }];
  });
}

async function fetchPublicTranscript(items: { url: string; type: string; rel: string }[]) {
  const ordered = [...items].sort((first, second) => {
    const rank = (item: { type: string }) => /vtt|srt/.test(item.type) ? 0 : /json/.test(item.type) ? 1 : 2;
    return rank(first) - rank(second);
  });
  for (const item of ordered) {
    try {
      const response = await fetch(item.url, { headers: { accept: "text/vtt,application/x-subrip,application/json,text/plain,text/html" } });
      if (!response.ok) continue;
      const value = await response.text();
      const contentType = (response.headers.get("content-type") || item.type).toLowerCase();
      const segments = /json/.test(contentType) ? parseJsonTranscript(value) : /vtt|srt|subrip/.test(contentType) || /-->/.test(value) ? parseTimedText(value) : [];
      if (segments.length) return { segments, transcriptText: "", source: item.url };
      const transcriptText = stripMarkup(value);
      if (transcriptText.length > 80) return { segments: [], transcriptText, source: item.url };
    } catch { /* Try the next public transcript advertised by RSS. */ }
  }
  return { segments: [] as MediaSegment[], transcriptText: "", source: "" };
}

export async function resolvePodcastMediaSource(resource: Record<string, unknown>): Promise<PodcastMediaSource> {
  const metadata = parseResourceMetadata(resource.metadata_json, "Podcast");
  const currentPodcast = metadata.podcast && typeof metadata.podcast === "object" ? metadata.podcast as Record<string, unknown> : {};
  const parsed = parseApplePodcastUrl(String(currentPodcast.appleUrl || resource.source_url || ""));
  const { episode, show } = await appleLookup(parsed.showId, parsed.episodeId);
  const showTitle = String(episode?.collectionName || show?.collectionName || "Apple Podcasts");
  const episodeTitle = String(episode?.trackName || resource.title || `Episode ${parsed.episodeId}`);
  const feedUrl = publicHttpUrl(String(show?.feedUrl || ""));
  let rssItem: ReturnType<typeof parseRssItem> = null;
  if (feedUrl) {
    try {
      const response = await fetch(feedUrl, { headers: { accept: "application/rss+xml,application/xml,text/xml" } });
      if (response.ok) rssItem = parseRssItem(await response.text(), episodeTitle, publicHttpUrl(String(episode?.episodeUrl || "")));
    } catch { /* A missing RSS feed leaves the official extensive-listening path intact. */ }
  }
  const audioUrl = rssItem?.audioUrl || publicHttpUrl(String(episode?.episodeUrl || ""));
  const durationMs = Number(episode?.trackTimeMillis || 0) || 0;
  const publicTranscript = await fetchPublicTranscript(rssItem?.transcripts || []);
  return {
    title: rssItem?.title || episodeTitle,
    description: rssItem?.description || `${showTitle} · Podcast精听资料`,
    audioUrl,
    durationMs,
    segments: publicTranscript.segments,
    transcriptText: publicTranscript.transcriptText,
    transcriptSource: publicTranscript.source ? "rss" : "",
    restricted: !audioUrl,
    podcast: {
      ...currentPodcast, provider: "apple_podcasts", appleUrl: parsed.appleUrl, embedUrl: parsed.embedUrl,
      showId: parsed.showId, episodeId: parsed.episodeId, showTitle, episodeTitle: rssItem?.title || episodeTitle,
      feedUrl, audioUrl, durationMs, studyMode: "intensive", audioSource: rssItem?.audioUrl ? "rss_enclosure" : audioUrl ? "itunes_public" : "unavailable",
    },
  };
}
