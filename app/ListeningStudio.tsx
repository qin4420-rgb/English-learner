"use client";

import { useEffect, useMemo, useState } from "react";
import { DEVELOPMENT_VIDEO_FIXTURE } from "./_fixtures/media";
import MediaLearningPlayer from "./components/MediaLearningPlayer";
import NcePlayer from "./NcePlayer";
import PodcastStudio from "./PodcastStudio";
import type { MediaKind, MediaSegment, ProgressItem, ResourceItem } from "./types";
import { parseResourceMetadata } from "./resource-model";

type Props = {
  resources: ResourceItem[];
  progress: ProgressItem[];
  onReloadProgress: () => Promise<void>;
  onReloadResources: () => Promise<void>;
  onNotice: (message: string) => void;
};

function mediaKind(resource: ResourceItem): MediaKind | null {
  if (resource.resourceType === "Video") return "video";
  if (resource.resourceType === "Audio") return "audio";
  return null;
}

function mediaSegments(resource: ResourceItem): MediaSegment[] {
  return parseResourceMetadata(resource.metadataJson, resource.resourceType).mediaSegments;
}

export default function ListeningStudio({ resources, progress, onReloadProgress, onReloadResources, onNotice }: Props) {
  const [section, setSection] = useState<"mine" | "nce" | "podcast">("mine");
  const mediaResources = useMemo(() => resources.filter((resource) => resource.collection === "library" && !["hidden", "archived"].includes(resource.status) && mediaKind(resource)), [resources]);
  const [selectedId, setSelectedId] = useState(0);
  useEffect(() => {
    const saved = localStorage.getItem("english-room-listening-section");
    if (saved === "mine" || saved === "nce" || saved === "podcast") queueMicrotask(() => setSection(saved));
  }, []);
  useEffect(() => { queueMicrotask(() => setSelectedId((current) => current || Number(localStorage.getItem("english-room-media-resource") || 0))); }, []);
  const selected = mediaResources.find((resource) => resource.id === selectedId) || mediaResources[0];
  const selectedKind = selected ? mediaKind(selected) : null;
  const segments = selected ? mediaSegments(selected) : [];
  const showDevelopmentDemo = process.env.NODE_ENV !== "production";
  const selectedProgress = selected ? progress.find((item) => item.lessonKey === `resource:${selected.id}`) : undefined;

  async function saveProgress(snapshot: { currentTimeMs: number; durationMs: number; completed: boolean }) {
    if (!selected) return;
    try {
      await fetch("/api/progress", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lessonKey: `resource:${selected.id}`, bookKey: "resource-media", lessonTitle: selected.title, progressSeconds: snapshot.currentTimeMs / 1000, durationSeconds: snapshot.durationMs / 1000, completed: snapshot.completed }) });
      await onReloadProgress();
    } catch { onNotice("媒体进度暂未保存，请稍后重试"); }
  }

  return <section className="listening-studio-page">
    <div className="page-heading"><div><p className="eyebrow">LISTENING STUDIO</p><h1>听力训练</h1><p>音频和视频共用播放器、文字稿、高亮、Seek 与句子循环；没有文字稿时不会生成假字幕。</p></div></div>
    <div className="studio-section-tabs"><button className={section === "mine" ? "active" : ""} onClick={() => { setSection("mine"); localStorage.setItem("english-room-listening-section", "mine"); }}>我的听力资料 <span>{mediaResources.length}</span></button><button className={section === "nce" ? "active" : ""} onClick={() => { setSection("nce"); localStorage.setItem("english-room-listening-section", "nce"); }}>新概念英语</button><button className={section === "podcast" ? "active" : ""} onClick={() => { setSection("podcast"); localStorage.setItem("english-room-listening-section", "podcast"); }}>Podcast</button></div>
    {section === "nce" ? <NcePlayer progress={progress} onSaved={onReloadProgress} onNotice={onNotice} /> : section === "podcast" ? <PodcastStudio resources={resources} progress={progress} onReloadResources={onReloadResources} onReloadProgress={onReloadProgress} onNotice={onNotice} /> : <>
      {selected && selectedKind ? <div className="listening-resource-layout">
        <aside className="panel media-resource-list"><div className="panel-heading"><div><p className="eyebrow">MY MEDIA</p><h2>我的资料</h2></div></div>{mediaResources.map((resource) => <button className={resource.id === selected.id ? "active" : ""} key={resource.id} onClick={() => { setSelectedId(resource.id); localStorage.setItem("english-room-media-resource", String(resource.id)); }}><span>{mediaKind(resource) === "video" ? "VIDEO" : "AUDIO"}</span><div><strong>{resource.title}</strong><small>{mediaSegments(resource).length ? `${mediaSegments(resource).length} 句文字稿` : "文字稿尚未生成"}</small></div></button>)}</aside>
        <MediaLearningPlayer key={selected.id} kind={selectedKind} src={selected.sourceUrl || selected.url} title={selected.title} segments={segments} initialTime={(selectedProgress?.progressSeconds || 0) * 1000} onProgressSave={saveProgress} onSegmentAction={(action) => onNotice(action === "lookup" ? "句子查词入口已保留；可在阅读器与词汇详情中查看上下文。" : action === "shadow" ? "可切换到口语训练按句跟读。" : "句子已标记。")}/>
      </div> : <div className="panel empty-state"><strong>还没有音频或视频学习资料</strong><span>在资源库添加 Audio / Video 类型资源后，会自动出现在这里。</span></div>}
      {showDevelopmentDemo && <details className="panel media-development-demo"><summary>播放器开发验收 Demo</summary><p>仅在本地开发环境显示，不会写入正式资源库。</p><MediaLearningPlayer kind="video" src={DEVELOPMENT_VIDEO_FIXTURE.src} title={DEVELOPMENT_VIDEO_FIXTURE.title} segments={DEVELOPMENT_VIDEO_FIXTURE.segments} /></details>}
    </>}
  </section>;
}
