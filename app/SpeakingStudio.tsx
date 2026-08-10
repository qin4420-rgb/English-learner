"use client";

/* User microphone recordings have no separate caption track; the reference sentence stays visible. */
/* eslint-disable jsx-a11y/media-has-caption */

import { useMemo, useRef, useState } from "react";
import { parseResourceMetadata } from "./resource-model";
import type { ProviderStatus, ResourceItem } from "./types";

type Props = { resources: ResourceItem[]; providers: ProviderStatus[]; onNotice: (message: string) => void };

function speak(text: string, onNotice: (message: string) => void) {
  if (!("speechSynthesis" in window)) { onNotice("当前浏览器不支持系统朗读"); return; }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text); utterance.lang = "en-US"; speechSynthesis.speak(utterance);
}

export default function SpeakingStudio({ resources, providers, onNotice }: Props) {
  const speakingResources = useMemo(() => resources.filter((resource) => resource.collection === "library" && resource.learningUses.includes("Speaking") && resource.status !== "archived"), [resources]);
  const remembered = typeof window === "undefined" ? 0 : Number(localStorage.getItem("english-room-speaking-resource") || 0);
  const [resourceId, setResourceId] = useState(remembered);
  const resource = speakingResources.find((item) => item.id === resourceId) || speakingResources[0];
  const segments = resource ? parseResourceMetadata(resource.metadataJson, resource.resourceType).mediaSegments : [];
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const current = segments[segmentIndex];
  const pronunciation = providers.find((provider) => provider.id === "pronunciation");

  async function toggleRecording() {
    if (recording) { recorderRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (recordingUrl) URL.revokeObjectURL(recordingUrl);
        setRecordingUrl(URL.createObjectURL(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })));
        setRecording(false);
      };
      recorder.start(); recorderRef.current = recorder; setRecording(true);
    } catch { onNotice("无法使用麦克风，请检查浏览器权限"); }
  }

  return <section><div className="page-heading"><div><p className="eyebrow">SPEAKING STUDIO 1.0</p><h1>口语训练</h1><p>按句跟读、录音和回放；未配置发音评估 Provider 时只展示练习记录，不生成虚假分数。</p></div></div>
    {!resource || !segments.length ? <div className="panel empty-state"><strong>还没有可跟读的句子</strong><span>把含文字稿的音频或视频资源设为 Speaking 用途后，会在这里按句训练。</span></div> : <div className="speaking-layout"><aside className="panel speaking-resource-list"><h2>跟读资料</h2><select value={resource.id} onChange={(event) => { const id = Number(event.target.value); setResourceId(id); setSegmentIndex(0); localStorage.setItem("english-room-speaking-resource", String(id)); }}>{speakingResources.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select><nav>{segments.map((segment, index) => <button className={index === segmentIndex ? "active" : ""} key={segment.id} onClick={() => setSegmentIndex(index)}><span>{index + 1}</span><strong>{segment.originalText}</strong></button>)}</nav></aside>
      <section className="panel shadowing-card"><p className="eyebrow">SENTENCE SHADOWING</p><h2>{current.originalText}</h2>{current.translationText && <p>{current.translationText}</p>}<div className="shadowing-controls"><button className="button secondary" onClick={() => speak(current.originalText, onNotice)}>▶ 系统朗读</button>{resource && /^https?:/.test(resource.sourceUrl || resource.url) && <a className="button secondary" href={resource.sourceUrl || resource.url} target="_blank" rel="noreferrer">播放原始资料 ↗</a>}<button className={`button primary ${recording ? "recording" : ""}`} onClick={() => void toggleRecording()}>{recording ? "■ 停止录音" : "● 开始跟读"}</button></div>{recordingUrl && <div className="recording-review"><strong>我的录音</strong><audio controls src={recordingUrl} /><button onClick={() => setRecordingUrl("")}>清除</button></div>}<div className="provider-note"><span className={pronunciation?.configured ? "status-dot" : "status-dot warning"} /><div><strong>{pronunciation?.configured ? `${pronunciation.provider} 发音评估已配置` : "发音评估未配置"}</strong><small>{pronunciation?.configured ? "评估接口已就绪，当前版本仍不伪造本地评分。" : "你仍可完成逐句录音与自我对比；维护中心配置后再接评分。"}</small></div></div></section></div>}
  </section>;
}
