import type { TaskReport } from "./report";
import type { Reference } from "./publicManifest";
import type { ReportExtensions } from "./reportExtensions";
import { ReportSurface, unboundAnalysisIds } from "./ReportSurface";
import {
  readPresentation,
  type ReportPresentation,
} from "./reportPresentation";
import "./ReportLayoutSurface.css";

export function ReportLayoutSurface({
  report,
  references,
  extensions,
  presentation,
}: {
  report: TaskReport;
  references: Reference[];
  extensions: ReportExtensions;
  presentation?: ReportPresentation | null;
}) {
  const layout = readPresentation(presentation, report.template.sections);
  const fallbackAnalyses = unboundAnalysisIds(report, extensions);
  if (!layout)
    return (
      <ReportSurface
        report={report}
        references={references}
        extensions={extensions}
      />
    );
  return (
    <div className="report-layout">
      {layout.rows
        .map((row) => ({
          section_ids: row.section_ids.filter(
            (id) =>
              report.sections.some((section) => section.section_id === id) ||
              (id === "metrics" && !!extensions.metrics) ||
              (id === "sentiment" && !!extensions.sentiment),
          ),
        }))
        .filter((row) => row.section_ids.length)
        .map((row) => (
          <div
            className="report-layout-row"
            data-columns={row.section_ids.length}
            key={row.section_ids.join("/")}
          >
            {row.section_ids.map((id) => (
              <ReportSurface
                key={id}
                report={report}
                references={references}
                extensions={extensions}
                sectionIds={[id]}
              />
            ))}
          </div>
        ))}
      {fallbackAnalyses.length > 0 && (
        <ReportSurface
          report={report}
          references={references}
          extensions={extensions}
          sectionIds={fallbackAnalyses}
        />
      )}
    </div>
  );
}
