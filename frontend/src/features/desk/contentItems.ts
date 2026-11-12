/** Optional reviewed content, independent of any agent's business domain. */
export interface CommentsAnalysis {
  status: "not_collected" | "unavailable" | "partial" | "complete";
  parent_item_id: string;
  evidence_ids: string[];
  text: string | null;
  analyzed_count: number;
  limitations: string[];
}
export interface ContentItem {
  item_id: string;
  item_revision: number;
  source_key: string;
  kind:
    "video" | "post" | "article" | "page" | "document" | "record" | "unknown";
  primary_evidence_id: string;
  evidence_ids: string[];
  text: string;
  content_basis: string[];
  limitations: string[];
  comments_analysis?: CommentsAnalysis;
}
export interface ContentItems {
  schema_version: "1.0";
  revision: number;
  items: ContentItem[];
}
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Colección de contenidos no válida");
  return value as ObjectValue;
}
function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new TypeError("Texto de contenido no válido");
  return value;
}
function integer(
  value: unknown,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  )
    throw new TypeError("Revisión o cantidad de contenido no válida");
  return Number(value);
}
function strings(
  value: unknown,
  min: number,
  max: number,
  limit: number,
  unique = true,
): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new TypeError("Evidencias de contenido no válidas");
  const values = value.map((item) => text(item, limit));
  if (unique && new Set(values).size !== values.length)
    throw new TypeError("Valores de contenido repetidos");
  return values;
}
function comments(value: unknown, parent: string): CommentsAnalysis {
  const item = object(value);
  if (
    !["not_collected", "unavailable", "partial", "complete"].includes(
      String(item.status),
    ) ||
    item.parent_item_id !== parent
  )
    throw new TypeError("Comentarios sin publicación válida");
  const ids = strings(item.evidence_ids, 0, 50, 500);
  const count = integer(item.analyzed_count, 0, ids.length);
  const summary = item.text === null ? null : text(item.text, 3000);
  if (
    summary === null
      ? count !== 0 || ids.length !== 0
      : count === 0 || !ids.length
  )
    throw new TypeError("Muestra de comentarios no válida");
  return {
    status: item.status as CommentsAnalysis["status"],
    parent_item_id: parent,
    evidence_ids: ids,
    text: summary,
    analyzed_count: count,
    limitations: strings(item.limitations, 0, 12, 500, false),
  };
}
function contentItem(value: unknown): ContentItem {
  const item = object(value);
  const id = text(item.item_id, 128);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) ||
    ![
      "video",
      "post",
      "article",
      "page",
      "document",
      "record",
      "unknown",
    ].includes(String(item.kind))
  )
    throw new TypeError("Identidad o tipo de contenido no válido");
  const ids = strings(item.evidence_ids, 1, 50, 500);
  const primary = text(item.primary_evidence_id, 500);
  if (!ids.includes(primary))
    throw new TypeError("Falta la evidencia principal");
  return {
    item_id: id,
    item_revision: integer(item.item_revision),
    source_key: text(item.source_key, 128),
    kind: item.kind as ContentItem["kind"],
    primary_evidence_id: primary,
    evidence_ids: ids,
    text: text(item.text, 3000),
    content_basis: strings(item.content_basis, 1, 8, 128),
    limitations: strings(item.limitations, 0, 12, 500, false),
    ...(item.comments_analysis === undefined
      ? {}
      : { comments_analysis: comments(item.comments_analysis, id) }),
  };
}
/** Unknown versions are unsupported capabilities, never a failure of the answer. */
export function parseContentItems(value: unknown): ContentItems | undefined {
  const collection = object(value);
  if (collection.schema_version !== "1.0") return undefined;
  if (
    new TextEncoder().encode(JSON.stringify(value)).length > 1_048_576 ||
    !Array.isArray(collection.items) ||
    collection.items.length > 400
  )
    throw new TypeError("Colección de contenidos demasiado grande");
  const items = collection.items
    .map(contentItem)
    .sort((a, b) =>
      a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0,
    );
  if (new Set(items.map((item) => item.item_id)).size !== items.length)
    throw new TypeError("Contenidos repetidos");
  return {
    schema_version: "1.0",
    revision: integer(collection.revision),
    items,
  };
}
export function contentIdentity(value: unknown): string {
  return JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}
export function parseContentHistory(value: unknown): ContentItem[] {
  if (!Array.isArray(value) || value.length > 10000)
    throw new TypeError("Historial de contenido no válido");
  const items = value.map(contentItem);
  if (new Set(items.map((item) => item.item_id)).size !== items.length)
    throw new TypeError("Historial de contenido repetido");
  return items;
}
function validItemRevision(item: ContentItem, previous?: ContentItem) {
  return (
    !previous ||
    item.item_revision > previous.item_revision ||
    (item.item_revision === previous.item_revision &&
      contentIdentity(item) === contentIdentity(previous))
  );
}
function referencesMatch(
  item: ContentItem,
  references: Map<string, ObjectValue>,
) {
  if (
    item.evidence_ids.some((id) => {
      const ref = references.get(id);
      return !ref || ref.content_basis === "comment_text";
    })
  )
    return false;
  const parent = references.get(item.primary_evidence_id)!;
  const parentUrls = new Set([parent.url, parent.requested_url]);
  return !item.comments_analysis?.evidence_ids.some((id) => {
    const ref = references.get(id);
    return (
      !ref ||
      ref.content_basis !== "comment_text" ||
      typeof ref.requested_url !== "string" ||
      !parentUrls.has(ref.requested_url)
    );
  });
}
export interface ContentReview {
  collection: ContentItems | undefined;
  accepted: boolean;
}

/** Decide collection and manifest acceptance once, including an unchanged revision. */
export function acceptContentItems(
  prior: ContentItems | undefined,
  incoming: unknown,
  references: Map<string, ObjectValue>,
  history: Map<string, ContentItem>,
): ContentReview {
  const rejected = { collection: prior, accepted: false };
  if (incoming === undefined) return rejected;
  try {
    const next = parseContentItems(incoming);
    if (!next || (prior && next.revision < prior.revision)) return rejected;
    const unchanged = prior && next.revision === prior.revision;
    if (unchanged && contentIdentity(next) !== contentIdentity(prior))
      return rejected;
    const valid = next.items.every(
      (item) =>
        validItemRevision(item, history.get(item.item_id)) &&
        referencesMatch(item, references),
    );
    return valid
      ? { collection: unchanged ? prior : next, accepted: true }
      : rejected;
  } catch {
    // Invalid optional content cannot erase reviewed items or break text streaming.
    return rejected;
  }
}
