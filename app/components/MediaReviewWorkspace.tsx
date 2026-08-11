"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMediaTime, mergeMediaSegments, parseMediaTime, splitMediaSegment } from "../media-processing.mjs";
import type { MediaReviewPayload, MediaSegment } from "../types";
import MediaLearningPlayer from "./MediaLearningPlayer";

type Props = { resourceId: number; onClose: () => void; onPublished: () => Promise<void>; onNotice: (message: string) => void };

async function requestMediaReview(resourceId: number, options?: RequestInit) {
  const response = await fetch(`/api/resources/${resourceId}/media-review`, options);
  const data = await response.json() as MediaReviewPayload & { error?: string };
  if (!response.ok) {
    const error = new Error(data.error || "媒体复核操作失败") as Error & { status?: number };
    error.status = response.status; throw error;
  }
  return data;
}

function cloneSegments(segments: MediaSegment[]) { return segments.map((segment) => ({ ...segment })); }

export default function MediaReviewWorkspace({ resourceId, onClose, onPublished, onNotice }: Props) {
  const [payload, setPayload] = useState<MediaReviewPayload | null>(null);
  const [segments, setSegments] = useState<MediaSegment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [seekRequest, setSeekRequest] = useState<{ segmentId: string; nonce: number } | null>(null);
  const [busy, setBusy] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let active = true;
    requestMediaReview(resourceId).then((data) => {
      if (!active) return;
      setPayload(data); setSegments(cloneSegments(data.segments)); setSelectedId(data.segments[0]?.id || "");
    }).catch((error: Error) => onNotice(error.message));
    return () => { active = false; };
  }, [onNotice, resourceId]);

  const selectedIndex = Math.max(0, segments.findIndex((segment) => segment.id === selectedId));
  const selected = segments[selectedIndex];
  const visibleSegments = useMemo(() => {
    const start = Math.max(0, Math.min(segments.length - 80, selectedIndex - 30));
    return { start, items: segments.slice(start, start + 80) };
  }, [segments, selectedIndex]);
  const issueMap = useMemo(() => new Map((payload?.review.issues || []).map((issue) => [issue.blockId, true])), [payload]);

  function selectSegment(segment: MediaSegment) {
    setSelectedId(segment.id); setSeekRequest({ segmentId: segment.id, nonce: Date.now() });
  }

  function updateSegment(change: Partial<MediaSegment>) {
    if (!selected) return;
    setSegments((current) => current.map((segment) => segment.id === selected.id ? { ...segment, ...change, manualEdited: true } : segment));
  }

  async function action(name: "save" | "validate" | "translate" | "aiReview" | "publish", extra: Record<string, unknown> = {}) {
    setBusy(name);
    try {
      const data = await requestMediaReview(resourceId, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: name, segments, ...extra }) });
      setPayload(data); setSegments(cloneSegments(data.segments));
      if (name === "publish") { onNotice("精听资料已发布，Listening Studio现在读取新的Published Segments"); await onPublished(); }
      else onNotice(name === "translate" ? "当前Segment已重新翻译并保存" : name === "aiReview" ? "媒体QA已重新检查；不会自动改写文字稿" : name === "validate" ? "媒体QA已更新" : "媒体复核草稿已保存");
    } catch (caught) {
      const error = caught as Error & { status?: number };
      if (name === "publish" && error.status === 409 && window.confirm(`${error.message}。仍要强制发布吗？`)) return action("publish", { force: true });
      onNotice(error.message);
    } finally { setBusy(""); }
  }

  function merge(offset: -1 | 1) {
    if (!selected) return;
    const next = mergeMediaSegments(segments, selectedIndex, offset);
    setSegments(next); setSelectedId(next[Math.max(0, Math.min(selectedIndex, selectedIndex + offset))]?.id || next[0]?.id || "");
  }

  function split() {
    if (!selected) return;
    const suggested = Math.max(1, Math.floor(selected.originalText.length / 2));
    const value = window.prompt(`在第几个字符后拆分？拆分后请校准时间。`, String(suggested));
    if (!value) return;
    const next = splitMediaSegment(segments, selectedIndex, Number(value));
    setSegments(next); setSelectedId(next[selectedIndex]?.id || "");
  }

  if (!payload) return <section className="panel review-loading">正在打开媒体复核草稿…</section>;
  const errors = payload.review.issues.filter((issue) => issue.severity === "error");
  const warnings = payload.review.issues.filter((issue) => issue.severity === "warning");

  return <section className="media-review-workspace">
    <header className="review-workspace-header"><button className="button secondary" onClick={onClose}>← 返回维护中心</button><div><p className="eyebrow">MEDIA REVIEW WORKSPACE</p><h1>{payload.resource.title}</h1><p>{payload.kind.toUpperCase()} · {segments.length} Segments · {payload.hasPublished ? "旧Published版本继续可学" : "首次精听发布"}</p></div><div className="review-header-actions"><button onClick={() => void action("validate")} disabled={Boolean(busy)}>Media QA</button><button onClick={() => setPreviewOpen(true)}>精听预览</button><button onClick={() => void action("save")} disabled={Boolean(busy)}>保存草稿</button><button className="button primary" onClick={() => void action("publish")} disabled={Boolean(busy)}>发布精听</button></div></header>
    <div className="review-status-strip"><strong className={errors.length ? "has-errors" : "ok"}>{errors.length} 个错误</strong><span>{warnings.length} 个警告</span><span>{payload.review.translatedSegments}/{payload.review.totalSegments} 已翻译</span><span>来源：{payload.media.transcriptSource || "待确认"}</span></div>
    <div className="media-review-player"><MediaLearningPlayer kind={payload.kind} src={payload.sourceUrl} title={payload.resource.title} segments={segments} showTranscript={false} seekRequest={seekRequest} onSegmentChange={(segment) => segment && setSelectedId(segment.id)} /></div>
    <div className="media-review-editor">
      <aside className="media-segment-list"><header><strong>Segment List</strong><small>当前仅渲染附近最多80条</small></header>{visibleSegments.start > 0 && <small>前面还有 {visibleSegments.start} 条</small>}{visibleSegments.items.map((segment) => <button className={`${segment.id === selectedId ? "active" : ""} ${issueMap.has(segment.id) ? "has-issue" : ""}`} key={segment.id} onClick={() => selectSegment(segment)}><time>{formatMediaTime(segment.startMs)}</time><span><b>{segment.id}</b>{segment.originalText}</span></button>)}{visibleSegments.start + visibleSegments.items.length < segments.length && <small>后面还有 {segments.length - visibleSegments.start - visibleSegments.items.length} 条</small>}</aside>
      {selected ? <main className="media-segment-editor"><header><div><p className="eyebrow">SEGMENT EDITOR</p><h2>{selected.id}</h2></div><button onClick={() => setSeekRequest({ segmentId: selected.id, nonce: Date.now() })}>▶ 定位播放</button></header><div className="media-time-fields"><label>开始时间<input value={formatMediaTime(selected.startMs)} onChange={(event) => { const value = parseMediaTime(event.target.value); if (Number.isFinite(value)) updateSegment({ startMs: value }); }} /></label><label>结束时间<input value={formatMediaTime(selected.endMs)} onChange={(event) => { const value = parseMediaTime(event.target.value); if (Number.isFinite(value)) updateSegment({ endMs: value }); }} /></label></div><label>English<textarea rows={8} value={selected.originalText} onChange={(event) => updateSegment({ originalText: event.target.value })} /></label><label>中文<textarea rows={8} value={selected.translationText || ""} onChange={(event) => updateSegment({ translationText: event.target.value })} /></label>{selected.needsReview && <p className="media-review-warning">此Segment由自动拆分产生，请人工校准时间。</p>}<div className="media-segment-actions"><button onClick={() => void action("translate", { segmentIds: [selected.id] })} disabled={Boolean(busy)}>重新翻译</button><button onClick={() => void action("aiReview", { segmentIds: [selected.id] })} disabled={Boolean(busy)}>AI检查</button><button onClick={() => merge(-1)}>合并上一句</button><button onClick={() => merge(1)}>合并下一句</button><button onClick={split}>拆分</button><button className="danger" onClick={() => { const next = segments.filter((segment) => segment.id !== selected.id); setSegments(next); setSelectedId(next[Math.min(selectedIndex, next.length - 1)]?.id || ""); }}>删除垃圾Segment</button></div><div className="media-segment-issues">{payload.review.issues.filter((issue) => issue.blockId === selected.id).map((issue) => <span className={issue.severity} key={issue.id}>{issue.message}</span>)}</div></main> : <main className="empty-state">选择一个Segment开始复核。</main>}
    </div>
    {previewOpen && <div className="review-preview-backdrop"><section className="media-review-preview" role="dialog" aria-modal="true"><header><div><p className="eyebrow">INTENSIVE PREVIEW</p><h2>{payload.resource.title}</h2></div><button onClick={() => setPreviewOpen(false)}>×</button></header><MediaLearningPlayer kind={payload.kind} src={payload.sourceUrl} title={payload.resource.title} segments={segments} /></section></div>}
  </section>;
}
