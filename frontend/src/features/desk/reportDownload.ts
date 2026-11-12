import { record } from "../../shared/record";
import { parseReference, type Reference } from "./publicManifest";
import { readTaskReport } from "./report";
import {
  readReportExtensions,
  type ReportExtensions,
} from "./reportExtensions";
import { runLabels, type TaskRun } from "./scheduledApi";

export function prepareSavedReport(run: TaskRun) {
  const result: {
    report: ReturnType<typeof readTaskReport>["report"];
    reportIssue: string | undefined;
    references: Reference[];
    markdown: string;
    extensions: ReturnType<typeof readReportExtensions>;
  } = {
    report: undefined,
    reportIssue: undefined,
    references: [],
    markdown: "",
    extensions: { warnings: [] },
  };
  if (!record(run.response) || !["completed", "partial"].includes(run.status))
    return result;
  const value = run.response;
  result.markdown = typeof value.markdown === "string" ? value.markdown : "";
  try {
    if (!Array.isArray(value.references) || value.references.length > 800)
      throw new Error();
    result.references = value.references.map(parseReference);
    const refs = new Map(
      result.references.map((ref) => [ref.evidence_id, ref]),
    );
    Object.assign(result, readTaskReport(value.report, refs));
    if (
      result.report &&
      (result.report.task_id !== run.taskId ||
        result.report.task_run_id !== run.id)
    )
      throw new Error();
    if (result.report && record(value.report))
      result.extensions = readReportExtensions(value.report.extensions, refs);
  } catch {
    result.report = undefined;
    result.reportIssue =
      "No se pudo validar el informe estructurado; se conserva Markdown.";
  }
  return result;
}
export function reportMarkdown(run: TaskRun) {
  const value = prepareSavedReport(run),
    report = value.report;
  if (!report && !value.markdown)
    throw new Error("Esta ejecución todavía no tiene un informe descargable.");
  const parts = [
    `# ${report?.title ?? "Informe"}`,
    `Estado: ${runLabels[run.status]} · Ejecución: ${run.id} · Versión de tarea: ${run.taskVersion}`,
  ];
  if (report?.source_request_id)
    parts.push(`Investigación de origen: ${report.source_request_id}`);
  if (report?.period)
    parts.push(
      `Periodo: ${report.period.start} — ${report.period.end} (${report.period.time_zone}; final ${report.period.bounds === "[start,end]" ? "inclusivo" : "exclusivo"})`,
    );
  if (report)
    for (const section of report.sections)
      parts.push(
        `## ${report.template.sections.find((definition) => definition.section_id === section.section_id)?.title}\n\n${section.markdown}`,
      );
  else parts.push(value.markdown);
  const metrics = value.extensions.metrics,
    sentiment = value.extensions.sentiment;
  if (metrics) parts.push(metricsMarkdown(metrics));
  if (sentiment) parts.push(sentimentMarkdown(sentiment));
  const limitations = [
    ...(report?.limitations ?? []),
    ...(value.reportIssue ? [value.reportIssue] : []),
    ...value.extensions.warnings,
    ...(metrics?.limitations ?? []),
    ...(metrics?.platforms.flatMap((p) => [
      ...p.limitations,
      ...p.observations.flatMap((o) => o.limitations),
    ]) ?? []),
    ...(sentiment?.limitations ?? []),
    ...(sentiment?.groups.flatMap((g) => [
      ...g.limitations,
      ...g.annotations.flatMap((a) => a.limitations),
    ]) ?? []),
  ];
  parts.push(
    `## Limitaciones\n\n${[...new Set(limitations)].map((limit) => `- ${limit}`).join("\n")}`,
    `## Fuentes\n\n${value.references.map((ref) => `- ${ref.evidence_id}: <${ref.url}>`).join("\n")}`,
  );
  return parts.join("\n\n");
}
export function downloadRunReport(run: TaskRun) {
  const url = URL.createObjectURL(
    new Blob([reportMarkdown(run)], { type: "text/markdown;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `informe-${run.id.replace(/[^a-zA-Z0-9_-]/g, "")}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function metricsMarkdown(metrics: NonNullable<ReportExtensions["metrics"]>) {
  return `## Cobertura\n\n${metrics.platforms.map((p) => `${p.source}: ${p.retrieval_status}; intentos de consulta/completados/fallidos (incluyen rechazos previos a crear una ejecución): ${p.query_operations.started ?? "no verificado"}/${p.query_operations.completed ?? "no verificado"}/${p.query_operations.failed ?? "no verificado"}. ${p.observations.map((o) => `${o.unit}: ${o.retained_count ?? "no verificado"} recuperados, ${o.analyzed_count ?? "no verificado"} analizados`).join("; ")}`).join("\n\n")}`;
}
function sentimentMarkdown(
  sentiment: NonNullable<ReportExtensions["sentiment"]>,
) {
  return `## Sentimiento\n\nSin calibración acreditada.\n\n${sentiment.groups.map((g) => `${g.target} / ${g.aspect ?? "general"} / ${g.source} / ${g.basis}: ${g.classified_count} clasificados de ${g.eligible_count}; positivo ${g.counts.positive}, negativo ${g.counts.negative}, neutral ${g.counts.neutral}, mixto ${g.counts.mixed}, sin clasificar ${g.unclassified_count}.\n\n${g.annotations.map((a) => `- ${a.evidence_id} (${a.label}): ${a.supporting_text ?? "Sin clasificación"}`).join("\n")}`).join("\n\n")}`;
}
