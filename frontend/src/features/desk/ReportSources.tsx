import { ChevronDown, ExternalLink, FileText } from "lucide-react";
import type { Reference } from "./publicManifest";
import { reportReferenceLabel } from "./reportReferenceLabel";
import "./ReportSources.css";

export function ReportCitations({
  evidenceIds,
  title,
  references,
}: {
  evidenceIds: string[];
  title: string;
  references: Reference[];
}) {
  const rows = evidenceIds.flatMap((id) => {
    const index = references.findIndex(
      (reference) => reference.evidence_id === id,
    );
    return index < 0
      ? []
      : [{ reference: references[index], number: index + 1 }];
  });
  if (!rows.length) return null;
  return (
    <details className="report-sources" data-tooltip-disabled="true">
      <summary>
        <FileText size={16} aria-hidden="true" />
        <span>Fuentes</span>
        <span className="report-source-count">({rows.length})</span>
        <ChevronDown
          className="report-sources-chevron"
          size={16}
          aria-hidden="true"
        />
      </summary>
      <ol className="report-citations" aria-label={`Fuentes: ${title}`}>
        {rows.map(({ reference, number }) => {
          const label = reportReferenceLabel(reference);
          const domain = new URL(reference.url).hostname.replace(/^www\./, "");
          return (
            <li key={reference.evidence_id}>
              <a
                href={reference.url}
                target="_blank"
                rel="noopener noreferrer"
                data-tooltip-disabled="true"
              >
                <span className="report-source-copy">
                  <span className="report-source-title">
                    [{number}] {label}
                  </span>
                  {label !== domain && (
                    <span className="report-source-domain">{domain}</span>
                  )}
                </span>
                <ExternalLink size={15} aria-hidden="true" />
                <span className="sr-only"> (abre en otra pestaña)</span>
              </a>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
