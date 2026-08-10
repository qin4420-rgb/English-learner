"use client";

import { useMemo, useState } from "react";
import type { ResourceItem } from "./types";

type Props = {
  resources: ResourceItem[];
  onRead: () => void;
  onMaintain: () => void;
  onToggleFavorite: (resource: ResourceItem) => Promise<void>;
};

const CATEGORY_ORDER = ["离线文章阅读", "收藏的网站文章", "视频链接", "学习心得记录", "课程资料", "其它"];

export default function ResourceLibrary({ resources, onRead, onMaintain, onToggleFavorite }: Props) {
  const library = useMemo(() => resources.filter((item) => item.collection === "library" && item.status !== "hidden"), [resources]);
  const categories = useMemo(() => Array.from(new Set(library.map((item) => item.category))).sort((a, b) => {
    const first = CATEGORY_ORDER.indexOf(a); const second = CATEGORY_ORDER.indexOf(b);
    return (first < 0 ? 999 : first) - (second < 0 ? 999 : second) || a.localeCompare(b, "zh-CN");
  }), [library]);
  const [expanded, setExpanded] = useState(categories[0] || "");
  const [search, setSearch] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const normalized = search.trim().toLowerCase();

  const matching = (item: ResourceItem) => {
    const haystack = `${item.title} ${item.description} ${item.category} ${item.skills}`.toLowerCase();
    return (!favoriteOnly || item.isFavorite) && haystack.includes(normalized);
  };

  function goToCategory(category: string) {
    setExpanded(category);
    document.getElementById(`library-${encodeURIComponent(category)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return <section><div className="page-heading"><div><p className="eyebrow">RESOURCE LIBRARY</p><h1>英语资源库</h1><p>这里只保存文章、视频、课程资料和学习记录；学习工具网站已经独立管理，不再重复出现。</p></div><button className="button primary" onClick={onMaintain}>＋ 统一导入资料</button></div><div className="library-search panel"><div className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索文章、主题、技能或来源…" aria-label="搜索资源库" /></div><label><input type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} /> 只看收藏</label><span>{library.filter(matching).length} 项资料</span></div><div className="directory-layout"><aside className="panel directory-sidebar"><div className="directory-title"><strong>资源目录</strong><small>展开一个，其它自动折叠</small></div>{categories.map((category) => { const items = library.filter((item) => item.category === category && matching(item)); const open = expanded === category; return <div className={`directory-group ${open ? "open" : ""}`} key={category}><button onClick={() => setExpanded(open ? "" : category)}><span>{open ? "▾" : "▸"}</span><strong>{category}</strong><em>{items.length}</em></button>{open && <nav>{items.map((item) => <button key={item.id} onClick={() => goToCategory(category)}>{item.title}</button>)}</nav>}</div>; })}</aside><div className="continuous-library">{categories.map((category) => { const items = library.filter((item) => item.category === category && matching(item)); if (!items.length) return null; return <section className="library-section" id={`library-${encodeURIComponent(category)}`} key={category}><div className="section-heading"><div><p className="eyebrow">COLLECTION</p><h2>{category}</h2></div><span>{items.length} 项</span></div><div className="library-row-list">{items.map((item) => <article className="panel library-row" key={item.id}><div className="library-row-icon">{item.resourceType.includes("视频") ? "▶" : item.markdownObjectKey ? "MD" : "↗"}</div><div className="library-row-copy"><div><span className="resource-type">{item.resourceType}</span>{item.processingStatus === "sync_pending" && <span className="sync-pill">待同步OneDrive</span>}</div><h3>{item.title}</h3><p>{item.description || "尚未补充内容介绍"}</p><small>{item.sourceName} · {item.issueDate || item.publishedAt || "私人资料"}</small></div><div className="library-row-actions"><button className={`favorite-button ${item.isFavorite ? "active" : ""}`} onClick={() => void onToggleFavorite(item)} aria-label={item.isFavorite ? "取消收藏" : "收藏"}>★</button>{item.markdownObjectKey ? <button className="button primary" onClick={onRead}>阅读Markdown</button> : /^https?:/.test(item.url) ? <a className="button secondary" href={item.url} target="_blank" rel="noreferrer">打开链接</a> : <button className="button secondary" disabled>等待整理</button>}</div></article>)}</div></section>; })}{!library.filter(matching).length && <div className="panel empty-state"><strong>资源库还没有匹配内容</strong><span>从维护中心上传PDF、Markdown或提交网页链接。</span></div>}</div></div></section>;
}
