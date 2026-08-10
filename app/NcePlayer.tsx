"use client";

import { useEffect, useState } from "react";
import MediaLearningPlayer from "./components/MediaLearningPlayer";
import type { MediaProgressSnapshot, MediaSegment, ProgressItem } from "./types";

type Unit = {
  index: number;
  key: string;
  title: string;
  filename: string;
  audioUrl: string;
  lrcUrl: string;
};

export function parseNceLrc(text: string): MediaSegment[] {
  const rawSegments = text.split(/\r?\n/).flatMap((rawLine, index) => {
    const timestamp = rawLine.match(/\[(\d{1,2}):(\d{2}(?:\.\d+)?)\]/);
    if (!timestamp) return [];
    const content = rawLine.replace(/\[[^\]]+\]/g, "").trim();
    if (!content) return [];
    const [originalText, ...translation] = content.split("|");
    return [{
      id: `nce-${index}`,
      startMs: Math.round((Number(timestamp[1]) * 60 + Number(timestamp[2])) * 1000),
      originalText: originalText.trim(),
      translationText: translation.join("|").trim() || undefined,
    } satisfies MediaSegment];
  }).sort((first, second) => first.startMs - second.startMs);
  return rawSegments.map((segment, index) => ({ ...segment, endMs: rawSegments[index + 1]?.startMs }));
}

export default function NcePlayer({ progress, onSaved, onNotice }: { progress: ProgressItem[]; onSaved: () => Promise<void>; onNotice?: (message: string) => void }) {
  const [variant, setVariant] = useState("main");
  const [book, setBook] = useState("NCE1");
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [segments, setSegments] = useState<MediaSegment[]>([]);
  const [note, setNote] = useState("");
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const selected = units.find((unit) => unit.key === selectedKey) ?? units[0];
  const savedProgress = progress.find((item) => item.lessonKey === selected?.key);

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
        const recent = progress.find((item) => item.bookKey === `${variant}-${book}` && nextUnits.some((unit) => unit.key === item.lessonKey));
        const nextKey = recent?.lessonKey ?? nextUnits[0]?.key ?? "";
        setSelectedKey(nextKey);
        setNote(progress.find((item) => item.lessonKey === nextKey)?.note ?? "");
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setLoading(false));
    return () => { cancelled = true; };
  }, [book, progress, variant]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    fetch(selected.lrcUrl)
      .then(async (response) => { if (!response.ok) throw new Error("字幕读取失败"); return response.text(); })
      .then((text) => { if (active) setSegments(parseNceLrc(text)); })
      .catch(() => { if (active) setSegments([]); });
    return () => { active = false; };
  }, [selected]);

  async function saveProgress(snapshot?: MediaProgressSnapshot, completed = false, quiet = false) {
    if (!selected) return;
    const current = snapshot?.currentTimeMs ?? currentTimeMs;
    const duration = snapshot?.durationMs ?? durationMs;
    const response = await fetch("/api/progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lessonKey: selected.key,
        bookKey: `${variant}-${book}`,
        lessonTitle: selected.title,
        progressSeconds: Math.round(current / 1000),
        durationSeconds: Math.round(duration / 1000),
        completed: completed || snapshot?.completed || savedProgress?.completed || false,
        note,
      }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error || "保存失败");
    if (!quiet) setMessage(completed ? "本课已完成，进度已记录" : "学习记录已保存");
    await onSaved();
  }

  function selectUnit(key: string) {
    setSegments([]);
    setCurrentTimeMs(0);
    setDurationMs(0);
    setNote(progress.find((item) => item.lessonKey === key)?.note ?? "");
    setSelectedKey(key);
  }

  return <div className="course-layout">
    <aside className="lesson-browser panel">
      <div className="panel-heading compact-heading"><div><p className="eyebrow">课程目录</p><h2>新概念英语</h2></div><span className="count-badge">{units.length} 课</span></div>
      <div className="course-switches"><label><span>版本</span><select value={variant} onChange={(event) => { setLoading(true); setVariant(event.target.value); }}><option value="main">经典版</option><option value="85">英音 85 版</option></select></label><label><span>册数</span><select value={book} onChange={(event) => { setLoading(true); setBook(event.target.value); }}><option value="NCE1">第一册</option><option value="NCE2">第二册</option><option value="NCE3">第三册</option><option value="NCE4">第四册</option></select></label></div>
      <div className="lesson-list" aria-label="课程列表">{loading && <div className="empty-state small">正在读取课程…</div>}{!loading && units.map((unit) => { const record = progress.find((item) => item.lessonKey === unit.key); return <button className={`lesson-row ${selected?.key === unit.key ? "active" : ""}`} key={unit.key} onClick={() => selectUnit(unit.key)}><span className="lesson-number">{String(unit.index).padStart(2, "0")}</span><span className="lesson-name">{unit.title}</span><span className={record?.completed ? "lesson-done done" : "lesson-done"}>{record?.completed ? "✓" : ""}</span></button>; })}</div>
    </aside>
    <section className="nce-learning-column">
      {selected ? <>
        <MediaLearningPlayer
          key={selected.key}
          kind="audio"
          src={selected.audioUrl}
          title={selected.title}
          segments={segments}
          initialTime={(savedProgress?.progressSeconds || 0) * 1000}
          onTimeChange={setCurrentTimeMs}
          onDurationChange={setDurationMs}
          onProgressSave={(snapshot) => { setDurationMs(snapshot.durationMs); return saveProgress(snapshot, snapshot.completed, true); }}
          onSegmentAction={(action) => onNotice?.(action === "lookup" ? "句子查词入口已预留；精读词典将在下一阶段与播放器共用。" : "该操作将在后续版本接入。")}
        />
        <div className="study-note panel"><label htmlFor="lesson-note">本课笔记</label><textarea id="lesson-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录生词、句型或复习提醒…" /><div className="form-actions"><span className="form-message">{message}</span><button className="button secondary" onClick={() => void saveProgress()}>保存记录</button><button className="button primary" onClick={() => void saveProgress(undefined, true)}>标记完成</button></div></div>
      </> : <div className="panel empty-state">{message || "请选择课程"}</div>}
    </section>
  </div>;
}
