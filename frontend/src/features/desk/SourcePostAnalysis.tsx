import { useState } from "react";
import type { Reference } from "./publicManifest";
import type { ContentItem } from "./contentItems";
import { MarkdownText } from "./MarkdownText";
import { SourceComments } from "./SourceComments";
import { postSummary } from "./sourcePostMetadata";

export function SourcePostAnalysis({
  reference,
  item,
  comments,
  query,
}: {
  reference: Reference | undefined;
  item: ContentItem | undefined;
  comments: Reference[];
  query: string;
}) {
  const [expandedId, setExpandedId] = useState<string>();
  const commentsAnalysis = item?.comments_analysis;
  const reviewedComments =
    commentsAnalysis?.text && commentsAnalysis.analyzed_count > 0
      ? commentsAnalysis
      : undefined;
  const expanded = !!item && (expandedId === item.item_id || !!query.trim());
  const toggle = (id: string) =>
    setExpandedId(expandedId === id ? undefined : id);

  return reference ? (
    <>
      {item && (
        <section
          className="source-post-analysis"
          aria-label="Análisis de la publicación"
        >
          <h3>Descripción</h3>
          <div
            className="source-post-summary"
            role="button"
            tabIndex={0}
            aria-label="Resumen de la publicación"
            aria-expanded={expanded}
            data-tooltip-disabled="true"
            onClick={() => toggle(item.item_id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggle(item.item_id);
              }
            }}
          >
            <MarkdownText
              text={postSummary(item.text, reference)}
              live={false}
              compact
              query={query}
              links={false}
            />
          </div>
        </section>
      )}
      <SourceComments
        references={comments}
        query={query}
        label="Comentarios de la publicación"
        heading="Comentarios"
      >
        {reviewedComments && (
          <>
            <p className="source-post-sample">
              {reviewedComments.analyzed_count}{" "}
              {reviewedComments.analyzed_count === 1
                ? "comentario analizado"
                : "comentarios analizados"}
              {reviewedComments.status === "partial"
                ? " · muestra parcial"
                : " · muestra recuperada"}
            </p>
            <MarkdownText
              text={reviewedComments.text!}
              live={false}
              compact
              query={query}
            />
            {!!reviewedComments.limitations.length && (
              <ul>
                {reviewedComments.limitations.map((limitation, index) => (
                  <li key={index}>{limitation}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </SourceComments>
    </>
  ) : null;
}
