"use client";

import { useEffect, useRef, useState } from "react";
import type { MediaSegment } from "../types";

type SegmentAction = "play" | "loop" | "lookup" | "mark" | "shadow";

type Props = {
  segments: MediaSegment[];
  activeSegmentId?: string | number;
  loopSegmentId?: string | number | null;
  showTranslation: boolean;
  onSeek: (segment: MediaSegment, play: boolean) => void;
  onLoop: (segment: MediaSegment) => void;
  onAction?: (action: SegmentAction, segment: MediaSegment) => void;
};

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function TranscriptPanel({ segments, activeSegmentId, loopSegmentId, showTranslation, onSeek, onLoop, onAction }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLElement>(null);
  const programmaticScrollRef = useRef(false);
  const programmaticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);

  useEffect(() => {
    if (!autoFollow || !activeRef.current) return;
    programmaticScrollRef.current = true;
    activeRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    if (programmaticTimerRef.current) clearTimeout(programmaticTimerRef.current);
    programmaticTimerRef.current = setTimeout(() => { programmaticScrollRef.current = false; }, 500);
  }, [activeSegmentId, autoFollow]);

  useEffect(() => () => {
    if (programmaticTimerRef.current) clearTimeout(programmaticTimerRef.current);
  }, []);

  function restoreFollow() {
    setAutoFollow(true);
    programmaticScrollRef.current = true;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    if (programmaticTimerRef.current) clearTimeout(programmaticTimerRef.current);
    programmaticTimerRef.current = setTimeout(() => { programmaticScrollRef.current = false; }, 500);
  }

  if (!segments.length) {
    return <div className="transcript-empty"><strong>文字稿尚未生成</strong><span>音频或视频仍可正常播放；以后可由 VTT、SRT、Whisper 或 Resource Segment API 补充。</span></div>;
  }

  return <section className="transcript-panel" aria-label="同步文字稿">
    <div className="transcript-heading"><div><p className="eyebrow">TRANSCRIPT</p><h3>同步文字稿</h3></div><span>{segments.length} 句</span></div>
    <div
      className="transcript-scroll"
      ref={containerRef}
      onScroll={() => { if (!programmaticScrollRef.current) setAutoFollow(false); }}
    >
      {segments.map((segment) => {
        const active = segment.id === activeSegmentId;
        const looping = segment.id === loopSegmentId;
        return <article className={`transcript-segment ${active ? "active" : ""}`} ref={active ? activeRef : undefined} key={segment.id}>
          <button className="transcript-segment-main" onClick={() => onSeek(segment, false)}>
            <time>{formatTime(segment.startMs)}</time>
            <span><strong>{segment.originalText}</strong>{showTranslation && segment.translationText && <small>{segment.translationText}</small>}</span>
          </button>
          <div className="transcript-actions" aria-label="句子操作">
            <button onClick={() => onSeek(segment, true)} title="播放当前句" aria-label="播放当前句">▶</button>
            <button className={looping ? "active" : ""} onClick={() => onLoop(segment)} title={looping ? "取消循环" : "循环当前句"} aria-label={looping ? "取消循环当前句" : "循环当前句"}>↺</button>
            <button onClick={() => onAction?.("lookup", segment)} title="句子查词与解释" aria-label="句子查词与解释">Aa</button>
            <button disabled title="难句标记将在后续版本接入" aria-label="难句标记后续接入">★</button>
            <button disabled title="跟读录音将在语音 Provider 配置后接入" aria-label="跟读录音后续接入">🎙</button>
          </div>
        </article>;
      })}
    </div>
    {!autoFollow && <button className="return-current-segment" onClick={restoreFollow}>回到当前句</button>}
  </section>;
}
