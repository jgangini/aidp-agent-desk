import { record } from "../../shared/record";
import type { Reference } from "./publicManifest";

export interface ReportSectionDefinition {
  section_id: string;
  title: string;
  visibility: "always" | "when_present";
}
export interface ReportSection {
  section_id: string;
  markdown: string;
  evidence_ids: string[];
}
export interface TaskReport {
  schema_version: "1.0";
  report_id: string;
  task_id: string;
  task_run_id: string;
  source_request_id?: string;
  title: string;
  template: {
    template_id: string;
    version: number;
    sections: ReportSectionDefinition[];
  };
  sections: ReportSection[];
  limitations: string[];
  period?: {
    start: string;
    end: string;
    time_zone: string;
    bounds?: "[start,end)" | "[start,end]";
  };
}

function object(value: unknown, required: string[], optional: string[] = []) {
  if (
    !record(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => ![...required, ...optional].includes(key))
  )
    throw new TypeError("Estructura de informe no válida");
  return value;
}
function text(value: unknown, max = 128): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new TypeError("Texto de informe no válido");
  return value;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new TypeError("Colección de informe no válida");
  return value;
}
function distinct(ids: string[]) {
  if (new Set(ids).size !== ids.length)
    throw new TypeError("Identidad de informe repetida");
}
function definition(value: unknown): ReportSectionDefinition {
  const item = object(value, ["section_id", "title", "visibility"]);
  if (item.visibility !== "always" && item.visibility !== "when_present")
    throw new TypeError("Visibilidad de informe no válida");
  return {
    section_id: text(item.section_id),
    title: text(item.title, 500),
    visibility: item.visibility,
  };
}
function section(
  value: unknown,
  references: ReadonlyMap<string, Reference>,
): ReportSection {
  const item = object(value, ["section_id", "markdown", "evidence_ids"]);
  const ids = list(item.evidence_ids, 800).map((id) => text(id));
  distinct(ids);
  if (ids.some((id) => !references.has(id)))
    throw new TypeError("Evidencia de informe desconocida");
  return {
    section_id: text(item.section_id),
    markdown: text(item.markdown, 100000),
    evidence_ids: ids,
  };
}
function period(value: unknown): TaskReport["period"] {
  if (value === undefined) return undefined;
  const item = object(value, ["start", "end", "time_zone"], ["bounds"]);
  if (
    item.bounds !== undefined &&
    item.bounds !== "[start,end)" &&
    item.bounds !== "[start,end]"
  )
    throw new TypeError("Límites de periodo no válidos");
  const start = timestamp(item.start);
  const end = timestamp(item.end);
  const time_zone = text(item.time_zone, 100);
  if (!(Date.parse(start) < Date.parse(end)))
    throw new TypeError("Periodo de informe no válido");
  if (!/^[A-Za-z][A-Za-z0-9._+/-]*$/.test(time_zone))
    throw new TypeError("Zona horaria no válida");
  new Intl.DateTimeFormat("es", { timeZone: time_zone });
  return {
    start,
    end,
    time_zone,
    ...(item.bounds === undefined ? {} : { bounds: item.bounds }),
  };
}

function timestamp(value: unknown) {
  const raw = text(value, 64);
  const format =
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
  const day = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
  if (
    !format.test(raw) ||
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== raw.slice(0, 10)
  )
    throw new TypeError("Fecha de informe no válida");
  return raw;
}

function validateExtensions(value: unknown) {
  if (value === undefined) return;
  if (
    !record(value) ||
    Object.keys(value).length > 20 ||
    Object.keys(value).some((key) => !key.trim() || key.length > 128) ||
    Object.values(value).some((entry) => !record(entry))
  )
    throw new TypeError("Extensiones de informe no válidas");
}

function validateSectionOrder(
  sections: ReportSection[],
  definitions: ReportSectionDefinition[],
) {
  const positions = sections.map((entry) =>
    definitions.findIndex((def) => def.section_id === entry.section_id),
  );
  if (
    positions.some(
      (position, index) =>
        position < 0 || (index > 0 && position <= positions[index - 1]),
    ) ||
    definitions.some(
      (def) =>
        def.visibility === "always" &&
        !sections.some((entry) => entry.section_id === def.section_id),
    )
  )
    throw new TypeError("Secciones incompatibles con la plantilla");
}

/** Unknown versions use the response Markdown. Domain extensions are not projected. */
export function parseTaskReport(
  value: unknown,
  references: ReadonlyMap<string, Reference>,
): TaskReport | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) throw new TypeError("Informe no válido");
  if (value.schema_version !== "1.0") return undefined;
  const item = object(
    value,
    [
      "schema_version",
      "report_id",
      "task_id",
      "task_run_id",
      "title",
      "template",
      "sections",
      "limitations",
    ],
    ["period", "extensions", "source_request_id"],
  );
  const template = object(item.template, [
    "template_id",
    "version",
    "sections",
  ]);
  if (!Number.isSafeInteger(template.version) || Number(template.version) < 1)
    throw new TypeError("Versión de plantilla no válida");
  const definitions = list(template.sections, 40).map(definition);
  if (!definitions.length) throw new TypeError("Plantilla vacía");
  distinct(definitions.map((entry) => entry.section_id));
  const sections = list(item.sections, 40).map((entry) =>
    section(entry, references),
  );
  distinct(sections.map((entry) => entry.section_id));
  validateSectionOrder(sections, definitions);
  validateExtensions(item.extensions);
  return {
    schema_version: "1.0",
    report_id: text(item.report_id),
    task_id: text(item.task_id),
    task_run_id: text(item.task_run_id),
    ...(item.source_request_id === undefined
      ? {}
      : { source_request_id: text(item.source_request_id) }),
    title: text(item.title, 500),
    template: {
      template_id: text(template.template_id),
      version: Number(template.version),
      sections: definitions,
    },
    sections,
    limitations: list(item.limitations, 40).map((entry) => text(entry, 2000)),
    period: period(item.period),
  };
}

export function readTaskReport(
  value: unknown,
  references: ReadonlyMap<string, Reference>,
) {
  try {
    return {
      report: parseTaskReport(value, references),
      reportIssue: undefined,
    };
  } catch {
    return {
      report: undefined,
      reportIssue:
        "El informe estructurado no es válido; se conserva la respuesta Markdown.",
    };
  }
}
