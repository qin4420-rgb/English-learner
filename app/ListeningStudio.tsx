"use client";

import { useMemo, useState } from "react";
import { DEVELOPMENT_VIDEO_FIXTURE } from "./_fixtures/media";
import MediaLearningPlayer from "./components/MediaLearningPlayer";
import NcePlayer from "./NcePlayer";
import type { MediaKind, MediaSegment, ProgressItem, ResourceItem } from "./types";

type Props = {
  resources: ResourceItem[];
  progress: ProgressItem[];
  onReloadProgress: () => Promise<void>;
  onNotice: (message: string) => void;
};

function safeMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function mediaKind(resource: ResourceItem): MediaKind | null {
  const descriptor = `${resource.resourceType} ${resource.skills}`.toLowerCase();
  if (/video|视频/.test(descriptor)) return "video";
  if (/audio|音频|听力|播客|podcast/.test(descriptor)) return "audio";
  return null;
}

function mediaSegments(resource: ResourceItem): MediaSegment[] {
  const metadata = safeMetadata(resource.metadataJson);
  const source = Array.isArray(metadata.segments) ? metadata.segments : Array.isArray(metadata.transcript) ? metadata.transcript : [];
  return source.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const startMs = Number(item.startMs);
    const originalText = String(item.originalText || "").trim();
    if (!Number.isFinite(startMs) || !originalText) return [];
    const endMs = Number(item.endMs);
    return [{
      id: typeof item.id === "string" || typeof item.id === "number" ? item.id : `${resource.id}-${index}`,
      startMs,
      endMs: Number.isFinite(endMs) ? endMs : undefined,
      originalText,
      translationText: String(item.translationText || "").trim() || undefined,
    }];
  }).sort((first, second) => first.startMs - second.startMs);
}

export default function ListeningStudio({ resources, progress, onReloadProgress, onNotice }: Props) {
  const [section, setSection] = useState<"mine" | "nce">("mine");
  const mediaResources = useMemo(() => resources.filter((resource) => resource.collection === "library" && resource.status !== "hidden" && mediaKind(resource)), [resources]);
  const [selectedId, setSelectedId] = useState(0);
  const selected = mediaResources.find((resource) => resource.id === selectedId) || mediaResources[0];
  const selectedKind = selected ? mediaKind(selected) : null;
  const segments = selected ? mediaSegments(selected) : [];
  const showDevelopmentDemo = process.env.NODE_ENV !== "production";

  return <section className="listening-studio-page">
    <div className="page-heading"><div><p className="eyebrow">LISTENING STUDIO</p><h1>听力训练</h1><p>音频和视频共用播放器、文字稿、高亮、Seek 与句子循环；没有文字稿时不会生成假字幕。</p></div></div>
    <div className="studio-section-tabs"><button className={section === "mine" ? "active" : ""} onClick={() => setSection("mine")}>我的听力资料 <span>{mediaResources.length}</span></button><button className={section === "nce" ? "active" : ""} onClick={() => setSection("nce")}>新概念英语</button></div>
    {section === "nce" ? <NcePlayer progress={progress} onSaved={onReloadProgress} onNotice={onNotice} /> : <>
      {selected && selectedKind ? <div className="listening-resource-layout">
        <aside className="panel media-resource-list"><div className="panel-heading"><div><p className="eyebrow">MY MEDIA</p><h2>我的资料</h2></div></div>{mediaResources.map((resource) => <button className={resource.id === selected.id ? "active" : ""} key={resource.id} onClick={() => setSelectedId(resource.id)}><span>{mediaKind(resource) === "video" ? "VIDEO" : "AUDIO"}</span><div><strong>{resource.title}</strong><small>{mediaSegments(resource).length ? `${mediaSegments(resource).length} 句文字稿` : "文字稿尚未生成"}</small></div></button>)}</aside>
        <MediaLearningPlayer kind={selectedKind} src={selected.url || selected.sourceUrl} title={selected.title} segments={segments} onSegmentAction={(action) => onNotice(action === "lookup" ? "句子查词入口已保留；下一阶段将与随读词典共用。" : "该句子操作将在后续版本接入。")}/>
      </div> : <div className="panel empty-state"><strong>还没有音频或视频学习资料</strong><span>在资源库添加 Audio / Video 类型资源后，会自动出现在这里。</span></div>}
      {showDevelopmentDemo && <details className="panel media-development-demo"><summary>播放器开发验收 Demo</summary><p>仅在本地开发环境显示，不会写入正式资源库。</p><MediaLearningPlayer kind="video" src={DEVELOPMENT_VIDEO_FIXTURE.src} title={DEVELOPMENT_VIDEO_FIXTURE.title} segments={DEVELOPMENT_VIDEO_FIXTURE.segments} /></details>}
    </>}
  </section>;
}
