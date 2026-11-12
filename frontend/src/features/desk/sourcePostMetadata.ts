import type { Reference } from "./publicManifest";

export function postTitle(reference: Reference, index: number) {
  for (const candidate of [reference.source_title, reference.title])
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  return `Publicación ${index + 1}`;
}

export function postAuthor(reference: Reference) {
  for (const candidate of [reference.author_name, reference.author])
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  for (const candidate of [reference.author_url, reference.url]) {
    if (typeof candidate !== "string") continue;
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:") continue;
      if (
        ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(
          url.hostname,
        )
      ) {
        const match = /^\/([a-zA-Z0-9_]{1,15})(?:\/status\/\d+)?\/?$/.exec(
          url.pathname,
        );
        if (
          match &&
          !["i", "intent", "share", "home", "search", "explore"].includes(
            match[1].toLowerCase(),
          )
        )
          return `@${match[1]}`;
      }
    } catch {
      /* A missing author must not prevent opening the post. */
    }
  }
  return undefined;
}

export function postContent(reference: Reference) {
  for (const candidate of [
    reference.text,
    reference.content,
    reference.description,
    reference.source_title,
    reference.title,
  ])
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  return undefined;
}

export function postPublished(reference: Reference) {
  const value = reference.published_at;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return undefined;
  return {
    value,
    label: new Intl.DateTimeFormat("es", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(value)),
  };
}

export function postSummary(text: string, reference: Reference) {
  const name = postAuthor(reference);
  const date = postPublished(reference);
  if (!name || !date) return text;
  const prefix = `${name} · ${new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(date.value))}:`;
  const matched = [prefix, `**${prefix}**`, `**${prefix.slice(0, -1)}**:`].find(
    (candidate) => text.startsWith(candidate),
  );
  return matched ? text.slice(matched.length).trimStart() : text;
}
