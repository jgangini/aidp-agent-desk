type ObjectValue = Record<string, unknown>;

export interface Artifact extends ObjectValue {
  artifact_id: string;
  evidence_ids: string[];
}

export interface Reference extends ObjectValue {
  evidence_id: string;
  url: string;
  media?: ReferenceMedia[];
}

export interface ReferenceMedia extends ObjectValue {
  url: string;
  kind: "image" | "video";
  delivery: "direct" | "page";
  role: "attachment" | "thumbnail" | "preview";
}

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Objeto público no válido");
  return value as ObjectValue;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 800)
    throw new TypeError("Manifest no válido");
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 100000)
    throw new TypeError("Texto no válido");
  return value;
}

function https(value: unknown, media = false) {
  const raw = text(value);
  if (raw.length > 4096 || /[\s\\\u0000-\u001f\u007f]/u.test(raw))
    throw new TypeError("URL no válida");
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    (media &&
      (url.hash ||
        !host.includes(".") ||
        /(?:^|\.)(?:localhost|local|localdomain|internal|onion|test|invalid)$/.test(
          host,
        ) ||
        host === "home.arpa" ||
        host.endsWith(".home.arpa") ||
        /^[\d.]+$/.test(host) ||
        host.includes(":")))
  )
    throw new TypeError("URL insegura");
}

export function isPublicMediaUrl(value: unknown): value is string {
  try {
    https(value, true);
    return true;
  } catch {
    return false;
  }
}

export function parseReference(value: unknown): Reference {
  const item = object(value);
  text(item.evidence_id);
  https(item.url);
  if (item.media !== undefined) {
    const assets = list(item.media);
    if (assets.length > 8) throw new TypeError("Demasiados medios");
    assets.forEach((value) => {
      const asset = object(value);
      https(asset.url, true);
      if (
        !["image", "video"].includes(String(asset.kind)) ||
        !["direct", "page"].includes(String(asset.delivery)) ||
        !["attachment", "thumbnail", "preview"].includes(String(asset.role))
      )
        throw new TypeError("Medio no válido");
    });
  }
  return item as Reference;
}
