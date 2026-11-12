import { useEffect, useMemo, useState } from "react";
import type { Reference } from "./publicManifest";
import "./SourcePosts.css";
import type { ContentItem } from "./contentItems";
import { groupPublications } from "./publications";
import { SourceComments } from "./SourceComments";
import { SourcePostCarousel } from "./SourcePostCarousel";
import { SourcePostPreview } from "./SourcePostPreview";
import { SourcePostAnalysis } from "./SourcePostAnalysis";

export function SourcePosts({
  references,
  contentItems = [],
  query = "",
}: {
  references: Reference[];
  contentItems?: ContentItem[];
  query?: string;
}) {
  const [activeId, setActiveId] = useState<string>();
  const { groups, orphanComments } = useMemo(
    () => groupPublications(references, contentItems),
    [references, contentItems],
  );
  const posts = groups.map((group) => group.reference);
  const identity = (post: Reference) =>
    contentItems.find((item) => item.primary_evidence_id === post.evidence_id)
      ?.item_id ?? post.evidence_id;
  const activeIndex = Math.max(
    0,
    posts.findIndex((post) => identity(post) === activeId),
  );
  const active = posts[activeIndex];
  const item =
    active &&
    contentItems.find(
      (item) => item.primary_evidence_id === active.evidence_id,
    );
  const select = (next: number) => {
    if (next === activeIndex) return;
    setActiveId(identity(posts[next]));
  };
  useEffect(() => {
    const nextId = active && identity(active);
    if (activeId !== nextId) setActiveId(nextId);
  });
  return (
    <SourcePostCarousel
      postIds={posts.map(identity)}
      activeIndex={activeIndex}
      onSelect={select}
      afterNavigation={
        <SourceComments
          references={orphanComments}
          label="Comentarios sin publicación asociada"
          query={query}
        />
      }
    >
      <SourcePostPreview reference={active} index={activeIndex} />
      <SourcePostAnalysis
        reference={active}
        item={item}
        comments={groups[activeIndex]?.comments ?? []}
        query={query}
      />
    </SourcePostCarousel>
  );
}
