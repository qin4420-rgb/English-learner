"use client";

import { FormEvent, useState } from "react";
import ArticleReader from "./ArticleReader";
import ListeningStudio from "./ListeningStudio";
import SpeakingStudio from "./SpeakingStudio";
import ProgressCenter from "./ProgressCenter";
import VocabularyCenter from "./VocabularyCenter";
import type { ActivityItem, CourseItem, NoteItem, PlanItem, ProgressItem, ProviderStatus, ResourceItem, VocabularyItem } from "./types";

export type DeskTab = "overview" | "courses" | "reading" | "listening" | "speaking" | "vocabulary" | "grammar" | "notes" | "progress";

type Props = {
  activeTab: DeskTab;
  onTabChange: (tab: DeskTab) => void;
  courses: CourseItem[];
  resources: ResourceItem[];
  notes: NoteItem[];
  vocabulary: VocabularyItem[];
  progress: ProgressItem[];
  activities: ActivityItem[];
  plans: PlanItem[];
  providers: ProviderStatus[];
  onReloadResources: () => Promise<void>;
  onReloadCourses: () => Promise<void>;
  onReloadNotes: () => Promise<void>;
  onReloadVocabulary: () => Promise<void>;
  onReloadProgress: () => Promise<void>;
  onReloadActivities: () => Promise<void>;
  onReloadPlans: () => Promise<void>;
  onNotice: (message: string) => void;
};

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

const COURSE_ICONS: Record<string, string> = {
  nce: "🎧", reading: "📰", vocabulary: "Aa", listening: "◉", news: "⌁", custom: "▤",
};

export default function LearningDesk(props: Props) {
  const {
    activeTab, onTabChange, courses, resources, notes, vocabulary, progress, activities, plans, providers,
    onReloadResources, onReloadCourses, onReloadNotes, onReloadVocabulary, onReloadProgress, onReloadActivities, onReloadPlans, onNotice,
  } = props;
  const visibleCourses = courses.filter((course) => course.status !== "hidden");
  const pinnedCourses = visibleCourses.filter((course) => course.pinned);
  const [courseTitle, setCourseTitle] = useState("");
  const [courseType, setCourseType] = useState("reading");
  const [courseDescription, setCourseDescription] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState(0);
  const [selectedResourceId, setSelectedResourceId] = useState(0);
  const [noteDraft, setNoteDraft] = useState({ title: "", content: "", referenceId: "" });
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);

  const readingCourses = visibleCourses.filter((course) => course.courseType === "reading");

  async function createCourse(event: FormEvent) {
    event.preventDefault();
    try {
      await jsonRequest("/api/courses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: courseTitle, courseType, description: courseDescription, icon: courseType }) });
      setCourseTitle(""); setCourseDescription(""); await onReloadCourses(); onNotice("新课程已建立，可以从资源库加入学习材料");
    } catch (error) { onNotice((error as Error).message); }
  }

  async function updateCourse(course: CourseItem, change: Partial<CourseItem>) {
    try {
      await jsonRequest("/api/courses", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: course.id, ...change }) });
      await onReloadCourses();
    } catch (error) { onNotice((error as Error).message); }
  }

  async function attachResource() {
    if (!selectedCourseId || !selectedResourceId) return;
    try {
      await jsonRequest("/api/courses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId: selectedCourseId, resourceId: selectedResourceId }) });
      await onReloadCourses(); onNotice("文章已加入课程");
    } catch (error) { onNotice((error as Error).message); }
  }

  async function saveNote(event: FormEvent) {
    event.preventDefault();
    try {
      await jsonRequest("/api/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editingNoteId || undefined, title: noteDraft.title, content: noteDraft.content, referenceType: noteDraft.referenceId ? "resource" : "general", referenceId: noteDraft.referenceId }) });
      setNoteDraft({ title: "", content: "", referenceId: "" }); setEditingNoteId(null); await onReloadNotes(); onNotice("学习笔记已保存，并进入OneDrive同步队列");
    } catch (error) { onNotice((error as Error).message); }
  }

  if (activeTab === "listening") {
    return <ListeningStudio resources={resources} progress={progress} onReloadResources={onReloadResources} onReloadProgress={onReloadProgress} onNotice={onNotice} />;
  }

  if (activeTab === "speaking") {
    return <SpeakingStudio resources={resources} providers={providers} onNotice={onNotice} />;
  }

  if (activeTab === "courses") {
    return <section><div className="page-heading"><div><p className="eyebrow">COURSE MANAGER</p><h1>在学课程管理</h1><p>课程可以固定到学习台、隐藏或加入资源库文章；后续听力、新闻和词汇课程都在这里扩展。</p></div></div><div className="course-manager-grid"><section className="panel course-manager-list"><div className="panel-heading"><div><h2>当前课程</h2><p>{courses.length} 个课程，隐藏课程仍可在这里恢复。</p></div></div>{courses.map((course) => <article className={`managed-course ${course.status === "hidden" ? "is-hidden" : ""}`} key={course.id}><span className="course-glyph">{COURSE_ICONS[course.courseType] || COURSE_ICONS.custom}</span><div><strong>{course.title}</strong><small>{course.description || "尚未填写课程说明"} · {course.resourceCount} 篇资料</small></div><button onClick={() => void updateCourse(course, { pinned: !course.pinned })}>{course.pinned ? "取消固定" : "固定"}</button><button onClick={() => void updateCourse(course, { status: course.status === "hidden" ? "active" : "hidden" })}>{course.status === "hidden" ? "显示" : "隐藏"}</button></article>)}</section><section className="panel admin-section"><div className="panel-heading"><div><h2>新建课程</h2><p>例如“经济学人精读”“每日BBC新闻”。</p></div></div><form className="stack-form" onSubmit={createCourse}><label><span>课程名称</span><input required value={courseTitle} onChange={(event) => setCourseTitle(event.target.value)} placeholder="经济学人精读" /></label><label><span>课程类型</span><select value={courseType} onChange={(event) => setCourseType(event.target.value)}><option value="reading">文章阅读</option><option value="listening">听力/播客</option><option value="news">新闻</option><option value="vocabulary">背单词</option><option value="custom">自定义</option></select></label><label><span>课程说明</span><textarea value={courseDescription} onChange={(event) => setCourseDescription(event.target.value)} /></label><button className="button primary">建立课程</button></form><div className="attach-resource"><h3>从资源库加入文章</h3><select value={selectedCourseId} onChange={(event) => setSelectedCourseId(Number(event.target.value))}><option value="0">选择阅读课程</option>{readingCourses.map((course) => <option value={course.id} key={course.id}>{course.title}</option>)}</select><select value={selectedResourceId} onChange={(event) => setSelectedResourceId(Number(event.target.value))}><option value="0">选择文章</option>{resources.filter((resource) => resource.collection === "library" && resource.markdownObjectKey).map((resource) => <option value={resource.id} key={resource.id}>{resource.title}</option>)}</select><button className="button secondary" type="button" onClick={() => void attachResource()}>加入课程</button></div></section></div></section>;
  }

  if (activeTab === "reading") {
    return <section className="reading-studio-page"><ArticleReader courses={courses} resources={resources} vocabulary={vocabulary} onReloadResources={onReloadResources} onReloadVocabulary={onReloadVocabulary} onReloadNotes={onReloadNotes} onNotice={onNotice} /></section>;
  }

  if (activeTab === "notes") {
    return <section><div className="page-heading"><div><p className="eyebrow">STUDY NOTES</p><h1>学习笔记</h1><p>可以是普通备忘录，也可以定位到具体课程、文章或链接。</p></div></div><div className="notes-layout"><aside className="panel notes-list"><button className="button primary" onClick={() => { setEditingNoteId(null); setNoteDraft({ title: "", content: "", referenceId: "" }); }}>＋ 新建笔记</button>{notes.map((note) => <button key={note.id} className={editingNoteId === note.id ? "active" : ""} onClick={() => { setEditingNoteId(note.id); setNoteDraft({ title: note.title, content: note.content, referenceId: note.referenceId }); }}><strong>{note.title}</strong><small>{note.referenceId ? `关联资源 #${note.referenceId}` : "普通笔记"} · {note.syncStatus === "synced" ? "已同步" : "待同步"}</small></button>)}</aside><form className="panel note-editor" onSubmit={saveNote}><label><span>笔记标题</span><input required value={noteDraft.title} onChange={(event) => setNoteDraft({ ...noteDraft, title: event.target.value })} /></label><label><span>关联文章</span><select value={noteDraft.referenceId} onChange={(event) => setNoteDraft({ ...noteDraft, referenceId: event.target.value })}><option value="">不关联具体文章</option>{resources.filter((resource) => resource.collection === "library").map((resource) => <option value={resource.id} key={resource.id}>{resource.title}</option>)}</select></label><label><span>笔记内容（支持Markdown）</span><textarea className="large-textarea" value={noteDraft.content} onChange={(event) => setNoteDraft({ ...noteDraft, content: event.target.value })} placeholder="记录句型、生词、理解和复习提醒…" /></label><div className="form-actions"><button className="button primary">保存笔记</button></div></form></div></section>;
  }

  if (activeTab === "vocabulary") {
    return <VocabularyCenter vocabulary={vocabulary} onReload={onReloadVocabulary} onNotice={onNotice} />;
  }

  if (activeTab === "progress") {
    return <ProgressCenter activities={activities} progress={progress} plans={plans} onReloadActivities={onReloadActivities} onReloadPlans={onReloadPlans} onNotice={onNotice} />;
  }

  if (activeTab === "grammar") {
    return <section><div className="page-heading"><div><p className="eyebrow">GRAMMAR STUDIO</p><h1>语法学习</h1><p>语法课程、错题与专项练习将在后续版本接入。</p></div></div><div className="panel coming-soon-panel"><span>Aa</span><div><strong>即将接入</strong><p>当前只建立学习入口，不生成虚假的课程或练习数据。</p></div></div></section>;
  }

  return <section><div className="welcome-block"><div><p className="eyebrow">MY LEARNING DESK</p><h1>今天从哪一门开始？</h1><p>固定课程会显示在这里；听说读写、笔记、词汇与学习进度从同一个学习台进入。</p></div><button className="button primary" onClick={() => onTabChange(progress.length ? "listening" : "courses")}>{progress.length ? "继续上次学习" : "安排学习课程"} <span>→</span></button></div><div className="desk-course-grid">{pinnedCourses.map((course) => <button className="panel desk-course-card" key={course.id} onClick={() => onTabChange(course.courseType === "nce" || course.courseType === "listening" ? "listening" : course.courseType === "reading" ? "reading" : course.courseType === "vocabulary" ? "vocabulary" : "courses")}><span>{COURSE_ICONS[course.courseType] || COURSE_ICONS.custom}</span><div><small>{course.courseType === "nce" || course.courseType === "listening" ? "听力课程" : course.courseType === "reading" ? "阅读课程" : "自定义课程"}</small><strong>{course.title}</strong><p>{course.description}</p></div><em>{course.resourceCount ? `${course.resourceCount} 篇` : "打开"} →</em></button>)}<button className="panel desk-course-card add-course" onClick={() => onTabChange("courses")}><span>＋</span><div><strong>管理在学课程</strong><p>固定、隐藏或添加新课程</p></div></button></div><div className="desk-quick-grid"><button className="panel" onClick={() => onTabChange("reading")}><span>▤</span><strong>文章阅读</strong><small>{resources.filter((item) => item.collection === "library" && item.markdownObjectKey).length} 篇 Markdown 文章</small></button><button className="panel" onClick={() => onTabChange("listening")}><span>◉</span><strong>听力训练</strong><small>新概念、音频与视频统一学习</small></button><button className="panel" onClick={() => onTabChange("notes")}><span>✎</span><strong>学习笔记</strong><small>{notes.length} 条已保存笔记</small></button><button className="panel" onClick={() => onTabChange("vocabulary")}><span>Aa</span><strong>单词学习</strong><small>{vocabulary.filter((item) => !item.mastered).length} 个待复习单词</small></button></div></section>;
}
