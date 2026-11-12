import type { Reference } from "./publicManifest";
import type { ReactNode } from "react";
import { MentionText } from "./MentionText";

export function SourceComments({
  references,
  label = "Comentarios",
  heading = label,
  children,
  query = "",
}: {
  references: Reference[];
  label?: string;
  heading?: string;
  children?: ReactNode;
  query?: string;
}) {
  const comments = references.flatMap((reference) => {
    const text = [
      reference.text,
      reference.content,
      reference.description,
    ].find(
      (value): value is string => typeof value === "string" && !!value.trim(),
    );
    return text ? [{ reference, text }] : [];
  });
  if (!comments.length && !children) return null;
  return (
    <section className="source-comments" aria-label={label}>
      <h3>{heading}</h3>
      {children}
      {!!comments.length && (
        <ul className="source-comment-entries">
          {comments.map(({ reference, text }) => {
            const author = [reference.author_name, reference.author].find(
              (value): value is string =>
                typeof value === "string" && !!value.trim(),
            );
            return (
              <li key={reference.evidence_id}>
                <a
                  href={reference.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-tooltip-disabled="true"
                >
                  {author ?? "Autor no disponible"}
                </a>
                {": "}
                <span>
                  <MentionText text={text} query={query} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
