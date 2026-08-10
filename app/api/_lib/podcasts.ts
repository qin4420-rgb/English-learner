import { translateBlocks } from "./distill";
import { runSTTUrl } from "./providers";
import { getDatabase, getRuntimeBindings } from "./runtime";
import { parseResourceMetadata, stringifyResourceMetadata } from "@/app/resource-model";
import { parseApplePodcastUrl } from "@/app/apple-podcasts.mjs";
import type { MediaSegment } from "@/app/types";

type ProcessPodcastInput = { ownerId: string; resourceId: number; jobId: number };
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
    segments.push({ id: `s${String(segments.length + 1).padStart(4, "0")}`, startMs, endMs: Number.isFinite(endMs) ? endMs : undefined, originalText });
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
    return [{ id: `s${String(index + 1).padStart(4, "0")}`, startMs, endMs: Number.isFinite(endMs) ? endMs : undefined, originalText }];
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

function normalizeProviderSegments(value: unknown[]): MediaSegment[] {
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const rawStart = Number(item.startMs ?? item.start ?? item.startTime ?? 0);
    const rawEnd = Number(item.endMs ?? item.end ?? item.endTime ?? Number.NaN);
    const originalText = String(item.originalText ?? item.text ?? "").trim();
    if (!Number.isFinite(rawStart) || !originalText) return [];
    return [{
      id: `s${String(index + 1).padStart(4, "0")}`,
      startMs: rawStart > 10000 ? rawStart : rawStart * 1000,
      endMs: Number.isFinite(rawEnd) ? rawEnd > 10000 ? rawEnd : rawEnd * 1000 : undefined,
      originalText,
    }];
  }).sort((first, second) => first.startMs - second.startMs);
}

async function updateJob(ownerId: string, jobId: number, stage: string, progress: number) {
  await getDatabase().prepare("UPDATE processing_jobs SET status='processing',stage=?,progress=?,error='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(stage, progress, jobId, ownerId).run();
}

async function needsProvider(input: ProcessPodcastInput, metadata: Record<string, unknown>, message: string) {
  await getDatabase().batch([
    getDatabase().prepare("UPDATE resources SET metadata_json=?,processing_status='needs_provider',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(JSON.stringify(metadata), input.resourceId, input.ownerId),
    getDatabase().prepare("UPDATE processing_jobs SET status='needs_provider',stage='等待STT Provider',progress=45,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(message, input.jobId, input.ownerId),
  ]);
  return { status: "needs_provider" as const };
}

export async function processPodcastResource(input: ProcessPodcastInput) {
  const database = getDatabase();
  const resource = await database.prepare("SELECT * FROM resources WHERE id=? AND owner_id=?").bind(input.resourceId, input.ownerId).first<Record<string, unknown>>();
  if (!resource) throw new Error("Podcast Resource不存在");
  const metadata = parseResourceMetadata(resource.metadata_json, "Podcast");
  const currentPodcast = metadata.podcast && typeof metadata.podcast === "object" ? metadata.podcast as Record<string, unknown> : {};
  const parsed = parseApplePodcastUrl(String(currentPodcast.appleUrl || resource.source_url || ""));

  try {
    await updateJob(input.ownerId, input.jobId, "解析Podcast", 10);
    const { episode, show } = await appleLookup(parsed.showId, parsed.episodeId);
    const showTitle = String(episode?.collectionName || show?.collectionName || "Apple Podcasts");
    const episodeTitle = String(episode?.trackName || resource.title || `Episode ${parsed.episodeId}`);
    const feedUrl = publicHttpUrl(String(show?.feedUrl || ""));

    await updateJob(input.ownerId, input.jobId, "寻找公开RSS与音频", 25);
    let rssItem: ReturnType<typeof parseRssItem> = null;
    if (feedUrl) {
      try {
        const response = await fetch(feedUrl, { headers: { accept: "application/rss+xml,application/xml,text/xml" } });
        if (response.ok) rssItem = parseRssItem(await response.text(), episodeTitle, publicHttpUrl(String(episode?.episodeUrl || "")));
      } catch { /* iTunes public episode URL remains an allowed fallback. */ }
    }
    const audioUrl = rssItem?.audioUrl || publicHttpUrl(String(episode?.episodeUrl || ""));
    const durationMs = Number(episode?.trackTimeMillis || 0) || 0;
    const podcastMetadata = {
      ...currentPodcast,
      provider: "apple_podcasts",
      appleUrl: parsed.appleUrl,
      embedUrl: parsed.embedUrl,
      showId: parsed.showId,
      episodeId: parsed.episodeId,
      showTitle,
      episodeTitle: rssItem?.title || episodeTitle,
      feedUrl,
      audioUrl,
      durationMs,
      studyMode: "intensive",
      intensiveStatus: audioUrl ? "processing" : "failed",
      audioSource: rssItem?.audioUrl ? "rss_enclosure" : audioUrl ? "itunes_public" : "unavailable",
    };
    const discoveredMetadata = { ...metadata, podcast: podcastMetadata };
    await database.prepare("UPDATE resources SET title=?,description=?,metadata_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
      .bind(podcastMetadata.episodeTitle, rssItem?.description || `${showTitle} · Podcast精听资料`, stringifyResourceMetadata(discoveredMetadata, "Podcast"), input.resourceId, input.ownerId).run();
    if (!audioUrl) {
      const message = "此Episode目前只能通过Apple Podcasts播放。泛听可用，精听音频源不可用。";
      await database.batch([
        database.prepare("UPDATE resources SET processing_status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(input.resourceId, input.ownerId),
        database.prepare("UPDATE processing_jobs SET status='failed',stage='公开音频不可用',progress=30,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(message, input.jobId, input.ownerId),
      ]);
      return { status: "failed" as const, reason: "audio_unavailable" };
    }

    await updateJob(input.ownerId, input.jobId, "获取公开Transcript", 38);
    const publicTranscript = await fetchPublicTranscript(rssItem?.transcripts || []);
    let segments = publicTranscript.segments;
    let transcriptSource = publicTranscript.source ? "rss_transcript" : "";
    if (!segments.length) {
      if (!getRuntimeBindings().STT_ENDPOINT || !getRuntimeBindings().STT_PROVIDER) {
        return needsProvider(input, {
          ...discoveredMetadata,
          podcast: { ...podcastMetadata, intensiveStatus: "needs_provider", transcriptSource: publicTranscript.source || "", transcriptText: publicTranscript.transcriptText },
        }, publicTranscript.transcriptText ? "公开Transcript已找到，但缺少可同步时间轴；STT Provider尚未配置。" : "音频已找到。STT Provider尚未配置。");
      }
      await updateJob(input.ownerId, input.jobId, "STT文字稿", 55);
      const transcribed = await runSTTUrl(audioUrl);
      segments = normalizeProviderSegments(transcribed.segments);
      transcriptSource = "stt_provider";
      if (!segments.length && transcribed.text) {
        segments = [{ id: "s0001", startMs: 0, endMs: durationMs || undefined, originalText: transcribed.text }];
      }
    }

    await updateJob(input.ownerId, input.jobId, "中文分段翻译", 78);
    let translations = new Map<string, string>();
    try {
      translations = await translateBlocks(segments.map((segment) => ({ id: String(segment.id), text: segment.originalText })));
    } catch { /* English transcript remains reviewable when AI translation is unavailable. */ }
    const translatedSegments = segments.map((segment) => ({ ...segment, translationText: translations.get(String(segment.id)) || segment.translationText }));
    const finalMetadata = stringifyResourceMetadata({
      ...discoveredMetadata,
      podcast: { ...podcastMetadata, intensiveStatus: "review_required", transcriptSource, transcriptText: publicTranscript.transcriptText },
      mediaSegments: translatedSegments,
      learningUses: ["Listening", "Speaking", "Vocabulary"],
    }, "Podcast");
    await database.batch([
      database.prepare("UPDATE resources SET metadata_json=?,processing_status='review_required',translation_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
        .bind(finalMetadata, translations.size ? "complete" : "pending", input.resourceId, input.ownerId),
      database.prepare("UPDATE processing_jobs SET status='review_required',stage='精听资料待复核',progress=100,result_resource_id=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?")
        .bind(input.resourceId, input.jobId, input.ownerId),
    ]);
    return { status: "review_required" as const, segmentCount: translatedSegments.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Podcast处理失败";
    const failedMetadata = stringifyResourceMetadata({ ...metadata, podcast: { ...currentPodcast, intensiveStatus: "failed" } }, "Podcast");
    await database.batch([
      database.prepare("UPDATE resources SET metadata_json=?,processing_status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(failedMetadata, input.resourceId, input.ownerId),
      database.prepare("UPDATE processing_jobs SET status='failed',stage='Podcast处理失败',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(message, input.jobId, input.ownerId),
    ]);
    throw error;
  }
}
