import { createContext, useContext, useEffect, useMemo } from "react";
import {
  A2uiSurface,
  createComponentImplementation,
  type ReactCatalogComponent,
} from "@a2ui/react/v0_9";
import { Catalog, CommonSchemas, MessageProcessor } from "@a2ui/web_core/v0_9";
import { z } from "zod";
import type { TaskReport } from "./report";
import type { Reference } from "./publicManifest";
import type { ReportExtensions } from "./reportExtensions";
import { MarkdownText } from "./MarkdownText";
import { ReportCitations } from "./ReportSources";
import { ReportSentimentSummary } from "./ReportSentimentSummary";

export const REPORT_CATALOG_ID =
  "https://agent-desk.local/catalogs/report/1.0.json";
const ReportContext = createContext<{
  report: TaskReport;
  references: Reference[];
  extensions: ReportExtensions;
} | null>(null);
const Column = createComponentImplementation(
  {
    name: "ReportColumn",
    schema: z.object({ children: CommonSchemas.ChildList }),
  },
  ({ props, buildChild }) => (
    <div className="report-sections">
      {props.children?.map((child) => {
        const id = typeof child === "string" ? child : child.id;
        return <div key={id}>{buildChild(id)}</div>;
      })}
    </div>
  ),
);
const Section = createComponentImplementation(
  {
    name: "ReportSection",
    schema: z.object({ sectionId: z.string().max(128) }),
  },
  ({ props }) => {
    const value = useContext(ReportContext);
    const section = value?.report.sections.find(
      (item) => item.section_id === props.sectionId,
    );
    const definition = value?.report.template.sections.find(
      (item) => item.section_id === props.sectionId,
    );
    if (!value || !section || !definition) return null;
    return (
      <section className="report-section">
        <h2>{definition.title}</h2>
        <MarkdownText text={section.markdown} live={false} />
        <ReportCitations
          evidenceIds={section.evidence_ids}
          title={definition.title}
          references={value.references}
        />
      </section>
    );
  },
);
const Analysis = createComponentImplementation(
  {
    name: "ReportAnalysis",
    schema: z.object({
      kind: z.enum(["metrics", "sentiment"]),
      sectionId: z.string().max(128).optional(),
    }),
  },
  ({ props }) => {
    const value = useContext(ReportContext);
    if (!value) return null;
    const { metrics, sentiment } = value.extensions;
    const section = value.report.sections.find(
      (item) => item.section_id === props.sectionId,
    );
    const definition = value.report.template.sections.find(
      (item) => item.section_id === props.sectionId,
    );
    const introduction = section && (
      <>
        <ReportCitations
          evidenceIds={section.evidence_ids}
          title={definition?.title ?? "Análisis"}
          references={value.references}
        />
      </>
    );
    if (props.kind === "metrics" && metrics)
      return (
        <section className="report-section">
          <h2>{definition?.title ?? "Cobertura de la investigación"}</h2>
          <CoverageCharts metrics={metrics} />
          <Limitations
            items={[
              ...metrics.limitations,
              ...metrics.platforms.flatMap((p) => [
                ...p.limitations,
                ...p.observations.flatMap((o) => o.limitations),
              ]),
            ]}
          />
          {introduction}
        </section>
      );
    if (props.kind === "sentiment" && sentiment)
      return (
        <section className="report-section">
          <h2>{definition?.title ?? "Sentimiento de la muestra"}</h2>
          <p className="report-note">
            Describe los textos analizados; no representa a toda la población.
          </p>
          {sentiment.status !== "analyzed" && (
            <p>
              {sentiment.status === "insufficient"
                ? "Evidencia insuficiente para clasificar sentimiento."
                : "El sentimiento no aplica a esta consulta."}
            </p>
          )}
          <ReportSentimentSummary sentiment={sentiment} />
          {sentiment.groups.length > 0 && (
            <details className="report-sentiment-detail">
              <summary>Desglose por fuente y evidencia</summary>
              <p className="report-note">
                Clasificación automática sin calibración acreditada.
              </p>
              {sentiment.groups.map((g) => (
                <div
                  className="report-sentiment"
                  key={JSON.stringify([g.source, g.basis, g.target, g.aspect])}
                >
                  <h3>
                    {g.target}
                    {g.aspect ? ` · ${g.aspect}` : ""}
                  </h3>
                  <p>
                    {g.source} ·{" "}
                    {g.basis === "comment_text"
                      ? "Comentarios"
                      : "Publicaciones"}{" "}
                    · {g.classified_count} clasificados de {g.eligible_count}{" "}
                    elegibles · {g.unclassified_count} sin clasificar
                  </p>
                  {g.classified_count > 0 && (
                    <dl className="report-distribution">
                      {(
                        ["positive", "negative", "neutral", "mixed"] as const
                      ).map((label) => (
                        <div key={label}>
                          <dt>{sentimentLabels[label]}</dt>
                          <dd>
                            {g.counts[label]}
                            {g.classified_count
                              ? ` (${Math.round((100 * g.counts[label]) / g.classified_count)}%)`
                              : ""}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <details>
                    <summary>Revisar evidencia de la muestra</summary>
                    <ul>
                      {g.annotations.map((a) => (
                        <li key={a.evidence_id}>
                          <strong>
                            {a.label === "unclassified"
                              ? "Sin clasificar"
                              : sentimentLabels[a.label]}
                          </strong>
                          {a.supporting_text && (
                            <blockquote>{a.supporting_text}</blockquote>
                          )}
                          <a
                            href={
                              value.references.find(
                                (r) => r.evidence_id === a.evidence_id,
                              )?.url
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Ver fuente
                          </a>
                          <Limitations items={a.limitations} />
                        </li>
                      ))}
                    </ul>
                  </details>
                  <Limitations items={g.limitations} />
                </div>
              ))}
            </details>
          )}
          <Limitations items={sentiment.limitations} />
          {introduction}
        </section>
      );
    return null;
  },
);
const catalog = new Catalog<ReactCatalogComponent>(REPORT_CATALOG_ID, "0.9", [
  Column,
  Section,
  Analysis,
]);
export function unboundAnalysisIds(
  report: TaskReport,
  extensions: ReportExtensions,
) {
  return ["metrics", "sentiment"].filter(
    (id) =>
      !!extensions[id as "metrics" | "sentiment"] &&
      !report.template.sections.some((section) => section.section_id === id),
  );
}
export function ReportSurface({
  report,
  references,
  extensions,
  sectionIds,
}: {
  report: TaskReport;
  references: Reference[];
  extensions: ReportExtensions;
  sectionIds?: string[];
}) {
  const structure = JSON.stringify([
    report.template.sections
      .filter(
        (definition) =>
          (!sectionIds || sectionIds.includes(definition.section_id)) &&
          (report.sections.some(
            (section) => section.section_id === definition.section_id,
          ) ||
            (definition.section_id === "metrics" && !!extensions.metrics) ||
            (definition.section_id === "sentiment" && !!extensions.sentiment)),
      )
      .map((definition) => definition.section_id),
    !!extensions.metrics && (!sectionIds || sectionIds.includes("metrics")),
    !!extensions.sentiment && (!sectionIds || sectionIds.includes("sentiment")),
  ]);
  const processor = useMemo(() => {
    const [sectionIds, metrics, sentiment] = JSON.parse(structure) as [
      string[],
      boolean,
      boolean,
    ];
    const p = new MessageProcessor<ReactCatalogComponent>([catalog]);
    const sectionNodes = sectionIds.map((sectionId, index) => {
      const kind =
        sectionId === "metrics" && metrics
          ? "metrics"
          : sectionId === "sentiment" && sentiment
            ? "sentiment"
            : undefined;
      return {
        id: `section-${index}`,
        component: kind ? "ReportAnalysis" : "ReportSection",
        sectionId,
        ...(kind ? { kind } : {}),
      };
    });
    const analyses = [
      ...(metrics && !sectionIds.includes("metrics")
        ? [{ id: "metrics", component: "ReportAnalysis", kind: "metrics" }]
        : []),
      ...(sentiment && !sectionIds.includes("sentiment")
        ? [{ id: "sentiment", component: "ReportAnalysis", kind: "sentiment" }]
        : []),
    ];
    p.processMessages([
      {
        version: "v0.9",
        createSurface: { surfaceId: "report", catalogId: REPORT_CATALOG_ID },
      },
      {
        version: "v0.9",
        updateComponents: {
          surfaceId: "report",
          components: [
            {
              id: "root",
              component: "ReportColumn",
              children: [...sectionNodes, ...analyses].map((item) => item.id),
            },
            ...sectionNodes,
            ...analyses,
          ],
        },
      },
    ]);
    return p;
  }, [structure]);
  useEffect(() => () => processor.dispose(), [processor]);
  const surface = processor.getSurfaces().get("report");
  return (
    <ReportContext.Provider value={{ report, references, extensions }}>
      {surface && <A2uiSurface surface={surface} />}
    </ReportContext.Provider>
  );
}
export function Limitations({ items }: { items: string[] }) {
  return items.length > 0 ? (
    <ul className="report-limitations">
      {[...new Set(items)].map((text) => (
        <li key={text}>{text}</li>
      ))}
    </ul>
  ) : null;
}
export function additionalReportLimitations(
  report: TaskReport | undefined,
  warnings: string[],
) {
  const represented = new Set(
    report?.sections.flatMap((section) =>
      section.markdown
        .split("\n")
        .map((line) => line.replace(/^\s*[-*]\s+/, "").trim()),
    ) ?? [],
  );
  return [
    ...(report?.limitations ?? []).filter(
      (item) => !represented.has(item.trim()),
    ),
    ...warnings,
  ];
}
function CoverageCharts({
  metrics,
}: {
  metrics: NonNullable<ReportExtensions["metrics"]>;
}) {
  return (
    <div className="report-coverage-charts">
      {(["post", "comment", "page"] as const).map((unit) => {
        const rows = metrics.platforms.flatMap((platform) =>
          platform.observations
            .filter(
              (observation) =>
                observation.unit === unit &&
                observation.retained_count !== null,
            )
            .map((observation) => ({
              source: platform.source,
              count: observation.retained_count!,
            })),
        );
        const maximum = Math.max(0, ...rows.map((row) => row.count));
        if (!maximum) return null;
        return (
          <figure className="report-coverage-chart" key={unit}>
            <figcaption>
              Recuento conservado: {unitLabel(unit).toLowerCase()}
            </figcaption>
            <ul>
              {rows.map((row) => (
                <li key={row.source}>
                  <span>{row.source}</span>
                  <strong>{row.count}</strong>
                  <span className="report-chart-track" aria-hidden="true">
                    <span
                      style={{ width: `${(100 * row.count) / maximum}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </figure>
        );
      })}
    </div>
  );
}
const sentimentLabels = {
  positive: "Positivo",
  negative: "Negativo",
  neutral: "Neutral",
  mixed: "Mixto",
};
function unitLabel(unit: string) {
  return (
    (
      {
        post: "Publicaciones",
        comment: "Comentarios",
        page: "Páginas",
      } as Record<string, string>
    )[unit] ?? unit
  );
}
