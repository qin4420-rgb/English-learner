"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import type { MediaKind, MediaProgressSnapshot, MediaSegment } from "../types";
import TranscriptPanel from "./TranscriptPanel";

const ReactPlayer = lazy(() => import("react-player"));

type Props = {
  kind: MediaKind;
  src: string;
  title: string;
  segments: MediaSegment[];
  initialTime?: number;
  showTranslation?: boolean;
  playbackRate?: number;
  onTimeChange?: (timeMs: number) => void;
  onDurationChange?: (durationMs: number) => void;
  onSeek?: (timeMs: number) => void;
  onProgressSave?: (snapshot: MediaProgressSnapshot) => void | Promise<void>;
  onSegmentChange?: (segment?: MediaSegment) => void;
  onSegmentAction?: (action: "lookup" | "mark" | "shadow", segment: MediaSegment) => void;
  showTranscript?: boolean;
  seekRequest?: { segmentId: string; nonce: number } | null;
};

function validSource(src: string) {
  try {
    const url = new URL(src, "https://english-room.local");
    return ["http:", "https:", "blob:", "data:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export default function MediaLearningPlayer({
  kind,
  src,
  title,
  segments,
  initialTime = 0,
  showTranslation: initialShowTranslation = true,
  playbackRate: initialPlaybackRate = 1,
  onTimeChange,
  onDurationChange,
  onSeek,
  onProgressSave,
  onSegmentChange,
  onSegmentAction,
  showTranscript = true,
  seekRequest,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const restoredRef = useRef(false);
  const previousSegmentRef = useRef<string | number | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [showTranslation, setShowTranslation] = useState(initialShowTranslation);
  const [playbackRate, setPlaybackRate] = useState(initialPlaybackRate);
  const [loopSegmentId, setLoopSegmentId] = useState<string | number | null>(null);
  const [playerFailed, setPlayerFailed] = useState(false);
  const [studyMode, setStudyMode] = useState<"normal" | "intensive">("normal");

  const activeSegment = useMemo(() => {
    let current: MediaSegment | undefined;
    for (const segment of segments) {
      if (segment.startMs <= currentTimeMs + 150) current = segment;
      else break;
    }
    return current;
  }, [currentTimeMs, segments]);

  const loopSegment = loopSegmentId == null ? undefined : segments.find((segment) => segment.id === loopSegmentId);

  const mediaElement = useCallback(() => kind === "audio" ? audioRef.current : videoRef.current, [kind]);

  function restoreInitialTime(element: HTMLMediaElement) {
    element.playbackRate = playbackRate;
    if (!restoredRef.current && initialTime > 0 && Number.isFinite(element.duration)) {
      element.currentTime = Math.min(initialTime / 1000, Math.max(0, element.duration - 0.2));
      setCurrentTimeMs(element.currentTime * 1000);
      restoredRef.current = true;
    }
  }

  function updateTime(element: HTMLMediaElement) {
    const nextMs = Math.max(0, element.currentTime * 1000);
    let nextSegment: MediaSegment | undefined;
    for (const segment of segments) {
      if (segment.startMs <= nextMs + 150) nextSegment = segment;
      else break;
    }
    setCurrentTimeMs(nextMs);
    onTimeChange?.(nextMs);
    if (nextSegment?.id !== previousSegmentRef.current) {
      previousSegmentRef.current = nextSegment?.id ?? null;
      onSegmentChange?.(nextSegment);
    }
    if (loopSegment) {
      const fallbackEnd = segments[segments.findIndex((segment) => segment.id === loopSegment.id) + 1]?.startMs || loopSegment.startMs + 5000;
      const endMs = loopSegment.endMs || fallbackEnd;
      if (nextMs >= endMs - 35) {
        element.currentTime = loopSegment.startMs / 1000;
        void Promise.resolve(element.play()).catch(() => undefined);
      }
    }
  }

  function seek(segment: MediaSegment, play: boolean) {
    const element = mediaElement();
    if (!element) return;
    element.currentTime = segment.startMs / 1000;
    setCurrentTimeMs(segment.startMs);
    onSeek?.(segment.startMs);
    if (play) void Promise.resolve(element.play()).catch(() => undefined);
  }

  useEffect(() => {
    if (!seekRequest) return;
    const segment = segments.find((item) => item.id === seekRequest.segmentId);
    const element = mediaElement();
    if (segment && element) {
      element.currentTime = segment.startMs / 1000;
      setCurrentTimeMs(segment.startMs);
      onSeek?.(segment.startMs);
    }
    // nonce intentionally makes repeated clicks on the same segment seek again.
  }, [mediaElement, onSeek, seekRequest, segments]);

  function toggleLoop(segment: MediaSegment) {
    const next = loopSegmentId === segment.id ? null : segment.id;
    setLoopSegmentId(next);
    if (next != null) seek(segment, true);
  }

  function saveProgress(completed = false) {
    return onProgressSave?.({ currentTimeMs, durationMs, completed });
  }

  function handleLoaded(event: SyntheticEvent<HTMLMediaElement>) {
    const element = event.currentTarget;
    const nextDurationMs = Number.isFinite(element.duration) ? element.duration * 1000 : 0;
    setDurationMs(nextDurationMs);
    onDurationChange?.(nextDurationMs);
    restoreInitialTime(element);
  }

  function handleRate(next: number) {
    setPlaybackRate(next);
    const element = mediaElement();
    if (element) element.playbackRate = next;
  }

  async function enterFullscreen() {
    try {
      await containerRef.current?.requestFullscreen();
    } catch { /* Fullscreen may require a different browser gesture; playback remains available. */ }
  }

  const sourceReady = validSource(src);

  return <div className="media-learning-studio">
    <section className="media-player-card panel" ref={containerRef}>
      <div className="media-player-heading"><div><p className="eyebrow">{kind === "video" ? "VIDEO" : "AUDIO"} LEARNING</p><h2>{title}</h2></div><div><button className="text-button" onClick={() => setShowTranslation((value) => !value)}>{showTranslation ? "隐藏译文" : "显示译文"}</button>{kind === "video" && <button className="button secondary" onClick={() => void enterFullscreen()}>全屏</button>}</div></div>
      <div className={`media-stage media-${kind}`}>
        {kind === "audio" && sourceReady && !playerFailed && <>
          {/* The synchronized transcript below provides the captions. */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio ref={audioRef} src={src} controls preload="metadata" onLoadedMetadata={handleLoaded} onTimeUpdate={(event) => updateTime(event.currentTarget)} onPause={() => void saveProgress(false)} onEnded={() => void saveProgress(true)} onError={() => setPlayerFailed(true)} />
        </>}
        {kind === "video" && sourceReady && !playerFailed && <Suspense fallback={<div className="media-fallback"><strong>正在加载视频播放器…</strong></div>}><ReactPlayer
            ref={videoRef}
            src={src}
            controls
            playsInline
            preload="metadata"
            playbackRate={playbackRate}
            width="100%"
            height="100%"
            onReady={() => { const element = videoRef.current; if (element) restoreInitialTime(element); }}
            onDurationChange={(event) => handleLoaded(event)}
            onTimeUpdate={(event) => updateTime(event.currentTarget)}
            onPause={() => void saveProgress(false)}
            onEnded={() => void saveProgress(true)}
            onError={() => setPlayerFailed(true)}
          /></Suspense>}
        {(!sourceReady || playerFailed) && <div className="media-fallback"><strong>当前{kind === "video" ? "视频" : "音频"}来源暂不能在 English Room 内播放。</strong>{sourceReady && <a className="button secondary" href={src} target="_blank" rel="noopener noreferrer">打开原{kind === "video" ? "视频" : "音频"}</a>}<small>已有文字稿仍可在下方继续学习。</small></div>}
      </div>
      <div className="media-control-row"><div className="media-study-modes"><button className={studyMode === "normal" ? "active" : ""} onClick={() => setStudyMode("normal")}>普通听</button><button className={studyMode === "intensive" ? "active" : ""} onClick={() => setStudyMode("intensive")}>精听</button><button disabled title="听写流程将在后续版本接入">听写</button><button disabled title="跟读与口语评估将在语音 Provider 配置后接入">跟读</button></div><label>速度<select value={playbackRate} onChange={(event) => handleRate(Number(event.target.value))}>{[0.75, 0.9, 1, 1.1, 1.25, 1.5, 2].map((value) => <option value={value} key={value}>{value}×</option>)}</select></label></div>
    </section>
    {showTranscript && <TranscriptPanel segments={segments} activeSegmentId={activeSegment?.id} loopSegmentId={loopSegmentId} showTranslation={showTranslation} onSeek={seek} onLoop={toggleLoop} onAction={(action, segment) => onSegmentAction?.(action, segment)} />}
  </div>;
}
