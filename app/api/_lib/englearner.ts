export type ImportedResource = {
  title: string;
  description: string;
  category: string;
  level: string;
  skills: string;
  resourceType: string;
  url: string;
  sourceName: string;
  sourceUrl: string;
  iconUrl: string;
};

const SOURCE_URL = "https://www.englearner.site/cn/index.html";

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .trim();
}

function inferType(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase();
  if (/pan\.|drive\.google|yun\.baidu|aliyundrive|quark/.test(hostname)) {
    return "网盘资料";
  }
  if (/youtube|bilibili|ted\.com|vimeo/.test(hostname)) return "视频";
  if (/podcast|spotify|ximalaya|tingfm/.test(hostname)) return "音频";
  if (/dictionary|dict|vocabulary|word/.test(hostname)) return "词典/词汇";
  return "网站";
}

function inferSkills(title: string, category: string): string {
  const value = `${title} ${category}`.toLowerCase();
  const skills: string[] = [];
  if (/听|listen|podcast|音频/.test(value)) skills.push("听力");
  if (/说|口语|speak|发音|pronunciation/.test(value)) skills.push("口语");
  if (/读|阅读|read|新闻|news/.test(value)) skills.push("阅读");
  if (/写|write|writing|语法|grammar/.test(value)) skills.push("写作");
  if (/词|word|vocab|dictionary|词典/.test(value)) skills.push("词汇");
  return skills.length ? [...new Set(skills)].join("、") : "综合";
}

function inferLevel(title: string, category: string): string {
  const value = `${title} ${category}`.toLowerCase();
  if (/初级|入门|beginner|基础|少儿/.test(value)) return "入门/初级";
  if (/高级|advanced|雅思|托福|gre|考研/.test(value)) return "中高级";
  return "不限";
}

export async function fetchEngLearnerResources(): Promise<ImportedResource[]> {
  const response = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "EnglishHub/1.0 resource-directory-import" },
  });
  if (!response.ok) throw new Error(`资源目录读取失败（${response.status}）`);

  const html = await response.text();
  const cardPattern =
    /<div[^>]*class=["'][^"']*track-resource-click[^"']*["'][^>]*data-name=["']([^"']+)["'][^>]*data-category=["']([^"']+)["'][^>]*>[\s\S]{0,1800}?window\.open\(["']([^"']+)["'][\s\S]{0,1200}?<img[^>]*(?:data-src|src)=["']([^"']+)["'][^>]*>[\s\S]{0,1200}?<p[^>]*>([\s\S]{0,500}?)<\/p>/gi;
  const resources: ImportedResource[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = cardPattern.exec(html))) {
    const title = decodeHtml(match[1]);
    const category = decodeHtml(match[2]);
    const url = decodeHtml(match[3]);
    const iconUrl = decodeHtml(match[4]);
    const description = decodeHtml(match[5].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    resources.push({
      title,
      category,
      url,
      description: description || `${title}｜收录于“${category}”分类的外部学习资源。`,
      level: inferLevel(title, category),
      skills: inferSkills(title, category),
      resourceType: inferType(url),
      sourceName: "EngLearner 资源目录",
      sourceUrl: SOURCE_URL,
      iconUrl,
    });
  }

  if (!resources.length) throw new Error("资源目录格式已变化，暂时无法导入");
  return resources;
}
