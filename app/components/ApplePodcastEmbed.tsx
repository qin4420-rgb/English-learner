"use client";

import { buildApplePodcastEmbedUrl } from "../apple-podcasts.mjs";

type Props = {
  appleUrl: string;
  kind: "episode" | "show";
  title?: string;
};

export default function ApplePodcastEmbed({ appleUrl, kind, title = "Apple Podcasts 官方播放器" }: Props) {
  let embedUrl = "";
  try { embedUrl = buildApplePodcastEmbedUrl(appleUrl); } catch { /* Invalid sources never reach an iframe. */ }
  if (!embedUrl) return <div className="podcast-embed-error"><strong>官方播放器无法载入</strong><a href={appleUrl} target="_blank" rel="noopener noreferrer"> 在 Apple Podcasts 打开</a></div>;
  return <iframe
    className={`apple-podcast-embed ${kind}`}
    src={embedUrl}
    title={title}
    allow="autoplay; encrypted-media; fullscreen"
    sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-top-navigation-by-user-activation"
    allowFullScreen
    loading="lazy"
  />;
}
