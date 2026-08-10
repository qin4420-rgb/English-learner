"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProgressItem } from "./types";

type Unit = {
  index: number;
  key: string;
  title: string;
  filename: string;
  audioUrl: string;
  lrcUrl: string;
};

type SubtitleLine = { time: number; english: string; chinese: string };

function parseLrc(text: string): SubtitleLine[] {
  const lines: SubtitleLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const timestamp = rawLine.match(/\[(\d{1,2}):(\d{2}(?:\.\d+)?)\]/);
    if (!timestamp) continue;
    const content = rawLine.replace(/\[[^\]]+\]/g, "").trim();
    if (!content) continue;
    const [english, ...translation] = content.split("|");
    lines.push({
      time: Number(timestamp[1]) * 60 + Number(timestamp[2]),
      english: english.trim(),
      chinese: translation.join("|").trim(),
    });
  }
  return lines.sort((a, b) => a.time - b.time);
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "00:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export default function NcePlayer({
  progress,
  onSaved,
}: {
  progress: ProgressItem[];
  onSaved: () => Promise<void>;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeLineRef = useRef<HTMLButtonElement>(null);
  const [variant, setVariant] = useState("main");
  const [book, setBook] = useState("NCE1");
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [subtitles, setSubtitles] = useState<SubtitleLine[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [note, setNote] = useState("");
  const [showChinese, setShowChinese] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const selected = units.find((unit) => unit.key === selectedKey) ?? units[0];
  const savedProgress = progress.find((item) => item.lessonKey === selected?.key);
  const activeIndex = useMemo(() => {
    let index = -1;
    for (let i = 0; i < subtitles.length; i += 1) {
      if (subtitles[i].time <= currentTime + 0.15) index = i;
      else break;
    }
    return index;
  }, [currentTime, subtitles]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/nce?variant=${variant}&book=${book}`)
      .then(async (response) => {
        const data = await response.json() as { error?: string; units?: Unit[] };
        if (!response.ok) throw new Error(data.error || "课程目录读取失败");
        return data.units ?? [];
      })
      .then((nextUnits) => {
        if (cancelled) return;
        setUnits(nextUnits);
        const recent = progress.find(
          (item) => item.bookKey === `${variant}-${book}` && nextUnits.some((unit) => unit.key === item.lessonKey),
        );
        const nextKey = recent?.lessonKey ?? nextUnits[0]?.key ?? "";
        setSelectedKey(nextKey);
        setNote(progress.find((item) => item.lessonKey === nextKey)?.note ?? "");
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [book, progress, variant]);

  useEffect(() => {
    if (!selected) return;
    fetch(selected.lrcUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error("字幕读取失败");
        return response.text();
      })
      .then((text) => setSubtitles(parseLrc(text)))
      .catch(() => setSubtitles([]));
  }, [selected]);

  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeIndex]);

  const saveProgress = useCallback(
    async (completed = false, quiet = false) => {
      if (!selected) return;
      const audio = audioRef.current;
      const response = await fetch("/api/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lessonKey: selected.key,
          bookKey: `${variant}-${book}`,
          lessonTitle: selected.title,
          progressSeconds: audio?.currentTime ?? currentTime,
          durationSeconds: audio?.duration || duration,
          completed: completed || savedProgress?.completed || false,
          note,
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "保存失败");
      if (!quiet) setMessage(completed ? "本课已完成，进度已记录" : "学习记录已保存");
      await onSaved();
    },
    [book, currentTime, duration, note, onSaved, savedProgress?.completed, selected, variant],
  );

  function selectUnit(key: string) {
    if (selected && audioRef.current?.currentTime) void saveProgress(false, true);
    setSubtitles([]);
    setCurrentTime(0);
    setDuration(0);
    setNote(progress.find((item) => item.lessonKey === key)?.note ?? "");
    setSelectedKey(key);
  }

  return (
    <div className="course-layout">
      <aside className="lesson-browser panel">
        <div className="panel-heading compact-heading">
          <div>
            <p className="eyebrow">课程目录</p>
            <h2>新概念英语</h2>
          </div>
          <span className="count-badge">{units.length} 课</span>
        </div>
        <div className="course-switches">
          <label>
            <span>版本</span>
            <select value={variant} onChange={(event) => { setLoading(true); setVariant(event.target.value); }}>
              <option value="main">经典版</option>
              <option value="85">英音 85 版</option>
            </select>
          </label>
          <label>
            <span>册数</span>
            <select value={book} onChange={(event) => { setLoading(true); setBook(event.target.value); }}>
              <option value="NCE1">第一册</option>
              <option value="NCE2">第二册</option>
              <option value="NCE3">第三册</option>
              <option value="NCE4">第四册</option>
            </select>
          </label>
        </div>
        <div className="lesson-list" aria-label="课程列表">
          {loading && <div className="empty-state small">正在读取课程…</div>}
          {!loading && units.map((unit) => {
            const record = progress.find((item) => item.lessonKey === unit.key);
            return (
              <button
                className={`lesson-row ${selected?.key === unit.key ? "active" : ""}`}
                key={unit.key}
                onClick={() => selectUnit(unit.key)}
              >
                <span className="lesson-number">{String(unit.index).padStart(2, "0")}</span>
                <span className="lesson-name">{unit.title}</span>
                <span className={record?.completed ? "lesson-done done" : "lesson-done"}>{record?.completed ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="player-panel panel">
        {selected ? (
          <>
            <div className="player-title-row">
              <div>
                <p className="eyebrow">{variant === "85" ? "英音 85 版" : "经典版"} · {book.replace("NCE", "第 ")} 册</p>
                <h2>{selected.title}</h2>
              </div>
              {savedProgress?.completed && <span className="complete-pill">已完成</span>}
            </div>

            <div className="audio-card">
              {/* The synchronized transcript directly below provides the captions. */}
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio
                ref={audioRef}
                src={selected.audioUrl}
                controls
                preload="metadata"
                onLoadedMetadata={(event) => {
                  const audio = event.currentTarget;
                  setDuration(audio.duration);
                  if (savedProgress && savedProgress.progressSeconds < audio.duration - 5) {
                    audio.currentTime = savedProgress.progressSeconds;
                    setCurrentTime(savedProgress.progressSeconds);
                  }
                  audio.playbackRate = speed;
                }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPause={() => {
                  if (audioRef.current?.currentTime) void saveProgress(false, true);
                }}
                onEnded={() => void saveProgress(true)}
              />
              <div className="audio-tools">
                <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
                <label>
                  速度
                  <select value={speed} onChange={(event) => {
                    const next = Number(event.target.value);
                    setSpeed(next);
                    if (audioRef.current) audioRef.current.playbackRate = next;
                  }}>
                    {[0.75, 0.9, 1, 1.1, 1.25, 1.5].map((value) => <option key={value} value={value}>{value}×</option>)}
                  </select>
                </label>
                <button className="text-button" onClick={() => setShowChinese((value) => !value)}>{showChinese ? "隐藏中文" : "显示中文"}</button>
              </div>
            </div>

            <div className="transcript" aria-label="双语课文">
              {subtitles.length ? subtitles.map((line, index) => (
                <button
                  ref={index === activeIndex ? activeLineRef : undefined}
                  className={`subtitle-line ${index === activeIndex ? "active" : ""}`}
                  key={`${line.time}-${index}`}
                  onClick={() => {
                    if (audioRef.current) {
                      audioRef.current.currentTime = line.time;
                      void audioRef.current.play();
                    }
                  }}
                >
                  <span className="subtitle-time">{formatTime(line.time)}</span>
                  <span><strong>{line.english}</strong>{showChinese && line.chinese && <small>{line.chinese}</small>}</span>
                </button>
              )) : <div className="empty-state">这课暂时没有可显示的字幕，你仍可使用上方音频学习。</div>}
            </div>

            <div className="study-note">
              <label htmlFor="lesson-note">本课笔记</label>
              <textarea id="lesson-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录生词、句型或复习提醒…" />
              <div className="form-actions">
                <span className="form-message">{message}</span>
                <button className="button secondary" onClick={() => void saveProgress(false)}>保存记录</button>
                <button className="button primary" onClick={() => void saveProgress(true)}>标记完成</button>
              </div>
            </div>
          </>
        ) : <div className="empty-state">{message || "请选择课程"}</div>}
      </section>
    </div>
  );
}
