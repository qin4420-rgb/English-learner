"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { parseApplePodcastUrl } from "./apple-podcasts.mjs";
import ApplePodcastEmbed from "./components/ApplePodcastEmbed";
import MediaLearningPlayer from "./components/MediaLearningPlayer";
import { parseResourceMetadata } from "./resource-model";
import type { ProgressItem, ResourceItem } from "./types";

type Props = {
  resources: ResourceItem[];
  progress: ProgressItem[];
  onReloadResources: () => Promise<void>;
  onReloadProgress: () => Promise<void>;
  onNotice: (message: string) => void;
};

type RecentPodcast = {
  appleUrl: string;
  embedUrl: string;
  showId: string;
  episodeId: string;
  kind: "episode" | "show";
  label: string;
  playedAt: string;
};

const RECENT_KEY = "english-room-podcast-recents";

function podcastMetadata(resource: ResourceItem) {
  return parseResourceMetadata(resource.metadataJson, resource.resourceType).podcast || {};
}

function formatDuration(milliseconds: number) {
  if (!milliseconds) return "时长待解析";
  const totalSeconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function statusCopy(status: string) {
  return ({
    queued: "未处理",
    processing: "处理中",
    review_required: "待复核",
    ready: "可学习",
    complete: "可学习",
    failed: "失败",
    needs_provider: "等待STT Provider",
  } as Record<string, string>)[status] || status || "未处理";
}

export default function PodcastStudio({ resources, progress, onReloadResources, onReloadProgress, onNotice }: Props) {
  const [tab, setTab] = useState<"extensive" | "intensive">("extensive");
  const [urlInput, setUrlInput] = useState("");
  const [activePodcast, setActivePodcast] = useState<RecentPodcast | null>(null);
  const [recents, setRecents] = useState<RecentPodcast[]>([]);
  const [joining, setJoining] = useState(false);
  const [selectedId, setSelectedId] = useState(0);
  const [error, setError] = useState("");

  const intensiveResources = useMemo(() => resources.filter((resource) => {
    const podcast = podcastMetadata(resource);
    return resource.collection === "library" && resource.resourceType === "Podcast" && podcast.studyMode === "intensive" && !["hidden", "archived"].includes(resource.status);
  }), [resources]);
  const selected = intensiveResources.find((resource) => resource.id === selectedId) || intensiveResources[0];
  const selectedMetadata = selected ? parseResourceMetadata(selected.metadataJson, selected.resourceType) : null;
  const selectedPodcast = selectedMetadata?.podcast || {};
  const selectedProgress = selected ? progress.find((item) => item.lessonKey === `resource:${selected.id}`) : undefined;
  const playable = Boolean(selectedPodcast.audioUrl && selectedMetadata?.mediaSegments.length);

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as RecentPodcast[];
      if (Array.isArray(parsed)) queueMicrotask(() => { setRecents(parsed.slice(0, 12)); setActivePodcast(parsed[0] || null); });
    } catch { /* Ignore invalid device-local history. */ }
  }, []);

  useEffect(() => {
    const saved = Number(localStorage.getItem("english-room-media-resource") || 0);
    if (saved) queueMicrotask(() => setSelectedId(saved));
  }, []);

  function saveRecent(item: RecentPodcast) {
    const next = [item, ...recents.filter((recent) => recent.appleUrl !== item.appleUrl)].slice(0, 12);
    setRecents(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  }

  function play(event: FormEvent) {
    event.preventDefault();
    try {
      const parsed = parseApplePodcastUrl(urlInput);
      const item: RecentPodcast = { ...parsed, label: parsed.kind === "episode" ? `Episode ${parsed.episodeId}` : `Podcast ${parsed.showId}`, playedAt: new Date().toISOString() };
      setActivePodcast(item); saveRecent(item); setUrlInput(parsed.appleUrl); setError("");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "这不是有效的 Apple Podcasts 链接。";
      setError(message); onNotice(message);
    }
  }

  async function joinIntensive(appleUrl: string) {
    setJoining(true); setError("");
    try {
      const parsed = parseApplePodcastUrl(appleUrl);
      if (parsed.kind !== "episode") throw new Error("请粘贴具体单集链接再加入精听。");
      const response = await fetch("/api/podcasts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ appleUrl: parsed.appleUrl }) });
      const data = await response.json() as { error?: string; resourceId?: number; jobId?: number };
      if (!response.ok || !data.resourceId || !data.jobId) throw new Error(data.error || "加入精听失败");
      setSelectedId(data.resourceId); setTab("intensive");
      await onReloadResources();
      onNotice("已加入精听处理；可以离开本页，后续状态会保留在处理中心。 ");
      void fetch("/api/podcasts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ resourceId: data.resourceId, jobId: data.jobId }) })
        .then(async (result) => {
          const processed = await result.json() as { error?: string; status?: string };
          await onReloadResources();
          if (!result.ok) onNotice(processed.error || "Podcast精听处理失败，原始Apple入口仍可使用。");
          else if (processed.status === "needs_provider") onNotice("音频已找到，等待STT Provider配置。");
          else if (processed.status === "failed") onNotice("泛听正常；当前Episode暂不能生成English Room精听版本。");
          else onNotice("Podcast精听资料已生成，等待复核。");
        })
        .catch(() => onNotice("精听处理已排队，可在维护中心稍后重试。"));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "加入精听失败";
      setError(message); onNotice(message);
    } finally { setJoining(false); }
  }

  async function saveProgress(snapshot: { currentTimeMs: number; durationMs: number; completed: boolean }) {
    if (!selected) return;
    try {
      await fetch("/api/progress", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lessonKey: `resource:${selected.id}`, bookKey: "podcast", lessonTitle: selected.title, progressSeconds: snapshot.currentTimeMs / 1000, durationSeconds: snapshot.durationMs / 1000, completed: snapshot.completed }) });
      await onReloadProgress();
    } catch { onNotice("Podcast学习进度暂未保存，请稍后重试。"); }
  }

  return <section className="podcast-studio">
    <div className="podcast-heading"><div><p className="eyebrow">PODCAST STUDIO</p><h2>Podcast</h2><p>泛听直接使用Apple官方播放器；值得学习的单集再加入English Room精听。</p></div><a className="button secondary" href="https://podcasts.apple.com/us/new" target="_blank" rel="noopener noreferrer"> 打开 Apple Podcasts</a></div>
    <div className="studio-section-tabs podcast-mode-tabs"><button className={tab === "extensive" ? "active" : ""} onClick={() => setTab("extensive")}>泛听</button><button className={tab === "intensive" ? "active" : ""} onClick={() => setTab("intensive")}>精听资料 <span>{intensiveResources.length}</span></button></div>

    {tab === "extensive" ? <>
      <section className="panel podcast-extensive-card">
        <div><p className="eyebrow">EXTENSIVE LISTENING</p><h3>Podcast 泛听</h3><p>随便听、多听，不做STT、翻译或AI预处理。</p></div>
        <form className="podcast-url-form" onSubmit={play}>
          <input value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="粘贴 Apple Podcasts 节目或单集链接……" aria-label="Apple Podcasts节目或单集链接" />
          <button className="button primary">▶ 播放</button>
          <a className="button secondary" href={activePodcast?.appleUrl || "https://podcasts.apple.com/us/new"} target="_blank" rel="noopener noreferrer"> Apple Podcasts</a>
        </form>
        {error && <p className="podcast-error" role="alert">{error}</p>}
        {activePodcast && <div className="podcast-official-player">
          <ApplePodcastEmbed appleUrl={activePodcast.appleUrl} kind={activePodcast.kind} title={activePodcast.label} />
          <div className="podcast-actions"><a className="button secondary" href={activePodcast.appleUrl} target="_blank" rel="noopener noreferrer"> 在 Apple Podcasts 打开</a><button className="button primary" disabled={joining || activePodcast.kind !== "episode"} onClick={() => void joinIntensive(activePodcast.appleUrl)}>＋ {joining ? "正在加入…" : "加入精听"}</button>{activePodcast.kind !== "episode" && <small>节目主页可泛听；加入精听请粘贴具体单集链接。</small>}</div>
        </div>}
      </section>
      <section className="podcast-recents"><div className="panel-heading"><div><h3>最近泛听</h3><p>仅保存在当前设备，不创建正式资源。</p></div></div>{recents.length ? <div className="podcast-recent-grid">{recents.map((recent) => <article className="panel" key={recent.appleUrl}><span>{recent.kind === "episode" ? "EPISODE" : "SHOW"}</span><strong>{recent.label}</strong><small>{new Date(recent.playedAt).toLocaleString()}</small><div><button onClick={() => { setActivePodcast(recent); setUrlInput(recent.appleUrl); }}>▶ 官方播放器</button><a href={recent.appleUrl} target="_blank" rel="noopener noreferrer"> Apple Podcasts</a>{recent.kind === "episode" && <button onClick={() => void joinIntensive(recent.appleUrl)}>＋ 加入精听</button>}</div></article>)}</div> : <div className="panel empty-state small"><span>粘贴Apple Podcasts链接播放后，会出现在这里。</span></div>}</section>
    </> : <section className="podcast-intensive-layout">
      <aside className="panel podcast-intensive-list"><div className="panel-heading"><div><h3>精听资料</h3><p>处理状态沿用维护中心。</p></div></div>{intensiveResources.length ? intensiveResources.map((resource) => {
        const podcast = podcastMetadata(resource);
        const itemProgress = progress.find((item) => item.lessonKey === `resource:${resource.id}`);
        const ratio = itemProgress?.durationSeconds ? Math.min(100, Math.round(itemProgress.progressSeconds / itemProgress.durationSeconds * 100)) : 0;
        return <button className={resource.id === selected?.id ? "active" : ""} key={resource.id} onClick={() => { setSelectedId(resource.id); localStorage.setItem("english-room-media-resource", String(resource.id)); }}><div><strong>{resource.title}</strong><small>{podcast.showTitle || "Apple Podcasts"} · {formatDuration(Number(podcast.durationMs || 0))}</small></div><span className={`processing-pill ${resource.processingStatus}`}>{statusCopy(resource.processingStatus)}</span><i><em style={{ width: `${ratio}%` }} /></i><small>{ratio ? `已学习 ${ratio}%` : "尚未开始"}</small></button>;
      }) : <div className="empty-state small"><span>还没有精听单集；先在泛听中选择一个Episode。</span></div>}</aside>
      <div className="podcast-intensive-main">
        {selected ? <>
          <header className="panel podcast-episode-summary"><div><p className="eyebrow">INTENSIVE PODCAST</p><h2>{selected.title}</h2><p>{selectedPodcast.showTitle || "Apple Podcasts"} · {formatDuration(Number(selectedPodcast.durationMs || 0))}</p></div><a className="button secondary" href={String(selectedPodcast.appleUrl || selected.sourceUrl)} target="_blank" rel="noopener noreferrer"> Apple Podcasts</a></header>
          {playable ? <MediaLearningPlayer key={selected.id} kind="audio" src={String(selectedPodcast.audioUrl)} title={selected.title} segments={selectedMetadata?.mediaSegments || []} initialTime={(selectedProgress?.progressSeconds || 0) * 1000} onProgressSave={saveProgress} onSegmentAction={(action) => onNotice(action === "lookup" ? "可从当前句选择单词加入单词本。" : action === "shadow" ? "可切换到口语训练逐句跟读。" : "句子已标记。")}/>
            : <div className="panel podcast-processing-state"><strong>{statusCopy(selected.processingStatus)}</strong><p>{selected.processingStatus === "needs_provider" ? "音频已找到。STT Provider尚未配置。" : selected.processingStatus === "failed" ? "泛听正常。当前Episode暂不能生成English Room精听版本。" : "正在解析Podcast、公开RSS、音频和Transcript。完成后将使用English Room播放器。"}</p><a href={String(selectedPodcast.appleUrl || selected.sourceUrl)} target="_blank" rel="noopener noreferrer"> 先在 Apple Podcasts 泛听</a></div>}
        </> : <div className="panel empty-state"><strong>选择一个精听Episode</strong><span>处理完成后会使用MediaLearningPlayer与同步Transcript，而不是Apple Embed。</span></div>}
      </div>
    </section>}
  </section>;
}
