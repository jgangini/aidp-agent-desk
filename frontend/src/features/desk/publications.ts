import { isPublicMediaUrl, parseReference, type Reference } from "./publicManifest";
import type { ContentItem } from "./contentItems";

export function isPublicationParent(parent: Reference, comment: Reference) {
  return (
    parent.content_basis !== "comment_text" &&
    comment.content_basis === "comment_text" &&
    typeof comment.requested_url === "string" &&
    (comment.requested_url === parent.url ||
      comment.requested_url === parent.requested_url)
  );
}

function withCapturedMedia(reference: Reference, captures: Reference[]) {
  const media = new Map<string, NonNullable<Reference["media"]>[number]>();
  for (const capture of [reference, ...captures]) {
    for (const asset of capture.media ?? []) {
      if (!media.has(asset.url)) media.set(asset.url, asset);
    }
  }
  return { ...reference, media: [...media.values()].slice(0, 8) };
}

export function groupPublications(
  references: Reference[],
  items: ContentItem[],
) {
  const entries = new Map<string, Reference>();
  for (const value of references) {
    try {
      const reference = parseReference(value);
      const destination = new URL(reference.url);
      destination.hash = "";
      if (isPublicMediaUrl(destination.href))
        entries.set(reference.evidence_id, reference);
    } catch {
      // Invalid references cannot become links or publication previews.
    }
  }
  const primaryIds = new Set(items.map((item) => item.primary_evidence_id));
  const posts = new Map<string, Reference>();
  const captures = new Map<string, Reference[]>();
  for (const reference of entries.values()) {
    if (reference.content_basis === "comment_text") continue;
    captures.set(reference.url, [
      ...(captures.get(reference.url) ?? []),
      reference,
    ]);
    const previous = posts.get(reference.url);
    if (
      !previous ||
      (!primaryIds.has(previous.evidence_id) &&
        primaryIds.has(reference.evidence_id))
    )
      posts.set(reference.url, reference);
  }
  const groups = [...posts.values()].map((reference) => ({
    reference: withCapturedMedia(reference, captures.get(reference.url)!),
    captures: captures.get(reference.url)!,
    comments: [] as Reference[],
  }));
  const orphanComments: Reference[] = [];
  for (const reference of entries.values()) {
    if (reference.content_basis !== "comment_text") continue;
    const parents = groups.filter((group) =>
      group.captures.some((capture) => isPublicationParent(capture, reference)),
    );
    if (parents.length === 1) parents[0].comments.push(reference);
    else orphanComments.push(reference);
  }
  return { groups, orphanComments };
}
