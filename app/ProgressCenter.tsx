"use client";

import { FormEvent, useMemo, useState } from "react";
import type { ActivityItem, PlanItem, ProgressItem } from "./types";

const skills = ["听", "说", "读", "写"];

type Props = {
  activities: ActivityItem[];
  progress: ProgressItem[];
  plans: PlanItem[];
  onReloadActivities: () => Promise<void>;
  onReloadPlans: () => Promise<void>;
  onNotice: (message: string) => void;
};

async function request(url: string, options?: RequestInit) { const response = await fetch(url, options); const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error || "操作失败"); }
function dateText(value: string) { if (!value) return "未设日期"; return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value.replace(" ", "T"))); }

export default function ProgressCenter({ activities, progress, plans, onReloadActivities, onReloadPlans, onNotice }: Props) {
  const [activeSkill, setActiveSkill] = useState("听");
  const [activity, setActivity] = useState({ title: "", skill: "听", domain: "日常", durationMinutes: "20" });
  const [plan, setPlan] = useState({ title: "", dueDate: "", planType: "综合" });
  const totals = useMemo(() => {
    const values = Object.fromEntries(skills.map((skill) => [skill, activities.filter((item) => item.skill === skill).reduce((sum, item) => sum + item.durationMinutes, 0)]));
    values["听"] += Math.round(progress.reduce((sum, item) => sum + item.progressSeconds, 0) / 60);
    return values;
  }, [activities, progress]);
  const visibleActivities = activities.filter((item) => item.skill === activeSkill);

  async function addActivity(event: FormEvent) { event.preventDefault(); try { await request("/api/activities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...activity, durationMinutes: Number(activity.durationMinutes) }) }); setActivity({ ...activity, title: "" }); await onReloadActivities(); onNotice("学习记录已添加"); } catch (error) { onNotice((error as Error).message); } }
  async function addPlan(event: FormEvent) { event.preventDefault(); try { await request("/api/plans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(plan) }); setPlan({ title: "", dueDate: "", planType: "综合" }); await onReloadPlans(); } catch (error) { onNotice((error as Error).message); } }
  async function setPlanStatus(item: PlanItem, status: string) { await request("/api/plans", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: item.id, status }) }); await onReloadPlans(); }

  return <section><div className="page-heading"><div><p className="eyebrow">LEARNING PROGRESS</p><h1>学习进度</h1><p>按听、说、读、写查看投入，再用语法、词汇、日常等主题继续细分。</p></div></div><div className="skill-summary-grid">{skills.map((skill) => <button className={`panel ${activeSkill === skill ? "active" : ""}`} key={skill} onClick={() => { setActiveSkill(skill); setActivity({ ...activity, skill }); }}><span>{skill}</span><div><strong>{totals[skill]}</strong><small>累计分钟</small></div></button>)}</div><div className="progress-main-grid"><section className="panel progress-section"><div className="panel-heading"><div><h2>{activeSkill}力记录</h2><p>语法、词汇、日常、课程等内容均可归入四项基本能力。</p></div></div><form className="activity-form" onSubmit={addActivity}><input required value={activity.title} onChange={(event) => setActivity({ ...activity, title: event.target.value })} placeholder="例如：跟读 BBC 新闻" /><select value={activity.domain} onChange={(event) => setActivity({ ...activity, domain: event.target.value })}><option>日常</option><option>语法</option><option>词汇</option><option>课程</option><option>新闻</option><option>播客</option></select><input type="number" min="1" max="600" value={activity.durationMinutes} onChange={(event) => setActivity({ ...activity, durationMinutes: event.target.value })} aria-label="学习分钟" /><button className="button primary">记录</button></form><div className="activity-list">{visibleActivities.map((item) => <article key={item.id}><span>{item.domain}</span><div><strong>{item.title}</strong><small>{dateText(item.studiedAt)}</small></div><em>{item.durationMinutes} 分钟</em></article>)}{activeSkill === "听" && progress.slice(0, 8).map((item) => <article key={`nce-${item.id}`}><span>NCE</span><div><strong>{item.lessonTitle}</strong><small>{dateText(item.lastStudiedAt)}</small></div><em>{Math.round(item.progressSeconds / 60)} 分钟</em></article>)}{!visibleActivities.length && !(activeSkill === "听" && progress.length) && <div className="empty-state small">还没有这一项的学习记录。</div>}</div></section><section className="panel progress-section"><div className="panel-heading"><div><h2>计划与复习</h2><p>计划可以跨课程、文章、词汇和日常练习。</p></div></div><form className="plan-create" onSubmit={addPlan}><input required value={plan.title} onChange={(event) => setPlan({ ...plan, title: event.target.value })} placeholder="本周完成的目标" /><div><select value={plan.planType} onChange={(event) => setPlan({ ...plan, planType: event.target.value })}><option>综合</option><option>听力</option><option>口语</option><option>阅读</option><option>写作</option><option>词汇</option><option>语法</option></select><input type="date" value={plan.dueDate} onChange={(event) => setPlan({ ...plan, dueDate: event.target.value })} /></div><button className="button primary">添加计划</button></form><div className="plan-list">{plans.map((item) => <article className={`plan-row ${item.status === "done" ? "done" : ""}`} key={item.id}><button className="round-check" onClick={() => void setPlanStatus(item, item.status === "done" ? "todo" : "done")}>{item.status === "done" ? "✓" : ""}</button><div><strong>{item.title}</strong><small>{item.planType} · {dateText(item.dueDate)}</small></div></article>)}</div></section></div></section>;
}
