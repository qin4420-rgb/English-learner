import { ensureDatabase, getDatabase, getOwnerId, jsonError } from "@/app/api/_lib/runtime";
import {
  normalizeResourceType,
  parseResourceMetadata,
  stringifyResourceMetadata,
} from "@/app/resource-model";

type ResourceInput = {
  id?: number;
  title?: string;
  description?: string;
  category?: string;
  level?: string;
  skills?: string;
  resourceType?: string;
  url?: string;
  sourceName?: string;
  sourceUrl?: string;
  collection?: string;
  iconUrl?: string;
  markdownObjectKey?: string;
  markdownPath?: string;
  processingStatus?: string;
  translationStatus?: string;
  publishedAt?: string;
  issueDate?: string;
  articleOrder?: number;
  parentId?: number | null;
  metadataJson?: string;
  status?: string;
  sortOrder?: number;
  isFavorite?: boolean;
  readingFolderId?: number | null;
  tags?: string[];
  learningUses?: string[];
};

function mapResource(row: Record<string, unknown>) {
  const metadata = parseResourceMetadata(row.metadata_json, row.resource_type);
  return {
    id: Number(row.id),
    title: String(row.title),
    description: String(row.description ?? ""),
    category: String(row.category ?? "未分类"),
    level: String(row.level ?? "未分级"),
    skills: String(row.skills ?? "综合"),
    resourceType: normalizeResourceType(row.resource_type),
    learningUses: metadata.learningUses,
    tags: metadata.tags,
    url: String(row.url),
    sourceName: String(row.source_name ?? "手工添加"),
    sourceUrl: String(row.source_url ?? ""),
    collection: String(row.collection ?? (row.source_name === "EngLearner 资源目录" ? "tool" : "library")),
    iconUrl: String(row.icon_url ?? ""),
    markdownObjectKey: String(row.markdown_object_key ?? ""),
    markdownPath: String(row.markdown_path ?? ""),
    processingStatus: String(row.processing_status ?? "ready"),
    translationStatus: String(row.translation_status ?? "none"),
    publishedAt: String(row.published_at ?? ""),
    issueDate: String(row.issue_date ?? ""),
    articleOrder: Number(row.article_order ?? 0),
    parentId: row.parent_id ? Number(row.parent_id) : null,
    readingFolderId: row.reading_folder_id ? Number(row.reading_folder_id) : null,
    metadataJson: String(row.metadata_json ?? "{}"),
    status: String(row.status ?? "active"),
    sortOrder: Number(row.sort_order ?? 0),
    isFavorite: Boolean(row.is_favorite),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function mergeMetadata(body: ResourceInput, current: unknown, typeValue: unknown) {
  const metadata = parseResourceMetadata(body.metadataJson ?? current, typeValue);
  return stringifyResourceMetadata({
    ...metadata,
    tags: body.tags ?? metadata.tags,
    learningUses: body.learningUses ?? metadata.learningUses,
  }, typeValue);
}

export async function GET(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const collection = new URL(request.url).searchParams.get("collection");
    const result = collection
      ? await getDatabase().prepare("SELECT * FROM resources WHERE owner_id=? AND collection=? ORDER BY is_favorite DESC, sort_order, category, article_order, title").bind(ownerId, collection).all()
      : await getDatabase().prepare("SELECT * FROM resources WHERE owner_id=? ORDER BY collection, is_favorite DESC, sort_order, category, article_order, title").bind(ownerId).all();
    return Response.json({ resources: (result.results as Record<string, unknown>[]).map(mapResource) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = (await request.json()) as ResourceInput;
    const title = body.title?.trim();
    const url = body.url?.trim();
    if (!title || !url) return jsonError(new Error("标题和链接不能为空"), 400);
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("unsupported protocol");
    } catch {
      return jsonError(new Error("请输入完整的 http 或 https 链接"), 400);
    }

    const resourceType = normalizeResourceType(body.resourceType);
    const values = [
      title,
      body.description?.trim() ?? "",
      body.category?.trim() || "未分类",
      body.level?.trim() || "未分级",
      body.skills?.trim() || "综合",
      resourceType,
      url,
      body.sourceName?.trim() || "手工添加",
      body.sourceUrl?.trim() || "",
      body.collection?.trim() || "library",
      body.iconUrl?.trim() || "",
      mergeMetadata(body, undefined, resourceType),
      body.status || "active",
      Number.isFinite(body.sortOrder) ? Number(body.sortOrder) : 0,
      body.isFavorite ? 1 : 0,
    ];

    if (body.id) {
      await getDatabase()
        .prepare(`UPDATE resources SET title=?, description=?, category=?, level=?, skills=?, resource_type=?, url=?, source_name=?, source_url=?, collection=?, icon_url=?, metadata_json=?, status=?, sort_order=?, is_favorite=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`)
        .bind(...values, body.id, ownerId)
        .run();
    } else {
      await getDatabase()
        .prepare(`INSERT INTO resources (owner_id,title,description,category,level,skills,resource_type,url,source_name,source_url,collection,icon_url,metadata_json,status,sort_order,is_favorite) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(owner_id,url) DO UPDATE SET title=excluded.title, description=excluded.description, category=excluded.category, level=excluded.level, skills=excluded.skills, resource_type=excluded.resource_type, source_name=excluded.source_name, source_url=excluded.source_url, metadata_json=excluded.metadata_json, status=excluded.status, sort_order=excluded.sort_order, updated_at=CURRENT_TIMESTAMP`)
        .bind(ownerId, ...values)
        .run();
    }
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const body = (await request.json()) as ResourceInput;
    if (!body.id) return jsonError(new Error("缺少资源编号"), 400);
    const current = await getDatabase().prepare("SELECT * FROM resources WHERE id=? AND owner_id=?").bind(body.id, ownerId).first<Record<string, unknown>>();
    if (!current) return jsonError(new Error("资源不存在"), 404);
    const next = {
      title: body.title?.trim() || String(current.title),
      description: body.description === undefined ? String(current.description ?? "") : body.description.trim(),
      category: body.category?.trim() || String(current.category ?? "未分类"),
      resourceType: body.resourceType ? normalizeResourceType(body.resourceType) : normalizeResourceType(current.resource_type),
      sourceName: body.sourceName === undefined ? String(current.source_name ?? "") : body.sourceName.trim(),
      sourceUrl: body.sourceUrl === undefined ? String(current.source_url ?? "") : body.sourceUrl.trim(),
      folderId: body.readingFolderId === undefined ? current.reading_folder_id : body.readingFolderId,
      metadata: mergeMetadata(body, current.metadata_json, body.resourceType || current.resource_type),
      processingStatus: body.processingStatus || String(current.processing_status ?? "ready"),
      translationStatus: body.translationStatus || String(current.translation_status ?? "none"),
      status: body.status || String(current.status ?? "active"),
      favorite: typeof body.isFavorite === "boolean" ? body.isFavorite ? 1 : 0 : Number(current.is_favorite ?? 0),
    };
    await getDatabase().prepare(`UPDATE resources SET title=?,description=?,category=?,resource_type=?,source_name=?,source_url=?,reading_folder_id=?,metadata_json=?,processing_status=?,translation_status=?,status=?,is_favorite=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`)
      .bind(next.title, next.description, next.category, next.resourceType, next.sourceName, next.sourceUrl, next.folderId || null, next.metadata, next.processingStatus, next.translationStatus, next.status, next.favorite, body.id, ownerId).run();
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureDatabase();
    const ownerId = await getOwnerId();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id) return jsonError(new Error("缺少资源编号"), 400);
    const permanent = new URL(request.url).searchParams.get("permanent") === "true";
    if (permanent) {
      await getDatabase().prepare("DELETE FROM resources WHERE id=? AND owner_id=?").bind(id, ownerId).run();
      return Response.json({ ok: true, archived: false });
    }
    await getDatabase().prepare("UPDATE resources SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(id, ownerId).run();
    return Response.json({ ok: true, archived: true });
  } catch (error) {
    return jsonError(error);
  }
}
