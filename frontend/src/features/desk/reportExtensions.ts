import { z } from "zod";
import { record } from "../../shared/record";
import type { Reference } from "./publicManifest";

const text = z.string().trim().min(1).max(500);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const limits = z.array(text).max(20);
const ids = z
  .array(text)
  .max(800)
  .refine((values) => new Set(values).size === values.length);
const source = z.enum([
  "web",
  "x",
  "facebook",
  "instagram",
  "youtube",
  "financial_document",
  "market_data",
  "world_bank",
]);
const observation = z
  .object({
    unit: z.enum(["post", "comment", "page"]),
    status: z.enum([
      "available",
      "empty",
      "not_collected",
      "unavailable",
      "partial",
      "pending",
    ]),
    population: z.literal("retained_evidence"),
    retained_count: count.nullable(),
    analyzed_count: count.nullable(),
    evidence_ids: ids,
    analyzed_evidence_ids: ids,
    limitations: limits,
  })
  .strict();
const platformMetrics = z
  .object({
    schema_version: z.literal("1.0"),
    method: z
      .object({
        method_id: z.literal("retained-evidence-counts"),
        version: z.literal("1.0"),
      })
      .strict(),
    platforms: z
      .array(
        z
          .object({
            source,
            retrieval_status: z.enum([
              "available",
              "empty",
              "not_queried",
              "partial",
              "pending",
              "provider_failed",
            ]),
            query_operations: z
              .object({
                started: count.nullable(),
                completed: count.nullable(),
                failed: count.nullable(),
              })
              .strict(),
            observations: z.array(observation).max(3),
            limitations: limits,
          })
          .strict(),
      )
      .max(8),
    limitations: limits,
  })
  .strict();
const annotation = z
  .object({
    evidence_id: text,
    label: z.enum(["positive", "negative", "neutral", "mixed", "unclassified"]),
    supporting_text: z.string().trim().min(1).max(1000).nullable(),
    limitations: limits,
  })
  .strict();
const sentiment = z
  .object({
    schema_version: z.literal("1.0"),
    method: z
      .object({
        method_id: z.literal("target-aspect-polarity"),
        version: z.literal("1.0"),
        calibration_status: z.literal("not_calibrated"),
      })
      .strict(),
    status: z.enum(["analyzed", "insufficient", "not_applicable"]),
    groups: z
      .array(
        z
          .object({
            source: z.enum(["web", "x", "facebook", "instagram", "youtube"]),
            basis: z.enum(["post_text", "comment_text"]),
            target: text,
            aspect: text.nullable(),
            population: z.literal("retained_evidence"),
            eligible_count: count,
            classified_count: count,
            unclassified_count: count,
            counts: z
              .object({
                positive: count,
                negative: count,
                neutral: count,
                mixed: count,
              })
              .strict(),
            annotations: z.array(annotation).max(800),
            limitations: limits,
          })
          .strict(),
      )
      .max(32),
    limitations: limits,
  })
  .strict();
export type PlatformMetrics = z.infer<typeof platformMetrics>;
export type Sentiment = z.infer<typeof sentiment>;
export interface ReportExtensions {
  metrics?: PlatformMetrics;
  sentiment?: Sentiment;
  warnings: string[];
}

type Observation = z.infer<typeof observation>;
type Platform = PlatformMetrics["platforms"][number];
type SentimentGroup = Sentiment["groups"][number];

function requireEvidence(
  evidenceIds: string[],
  source: string,
  references: ReadonlyMap<string, Reference>,
) {
  for (const id of evidenceIds) {
    const ref = references.get(id);
    if (!ref || ref.source !== source)
      throw new Error("Evidencia sin fuente correspondiente");
  }
}
function requireCount(value: number | null, evidenceIds: string[]) {
  if (value !== null && value !== evidenceIds.length)
    throw new Error("Cantidad de muestra incoherente");
}
function validateObservationState(unit: Observation) {
  if (
    unit.status === "empty" &&
    (unit.retained_count !== 0 ||
      unit.analyzed_count !== 0 ||
      unit.evidence_ids.length)
  )
    throw new Error("Muestra vacía incoherente");
  if (
    unit.status === "not_collected" &&
    (unit.retained_count !== null ||
      unit.analyzed_count !== null ||
      unit.evidence_ids.length ||
      unit.analyzed_evidence_ids.length)
  )
    throw new Error("Muestra no recogida incoherente");
}
function validateObservation(
  unit: Observation,
  source: string,
  references: ReadonlyMap<string, Reference>,
) {
  requireEvidence(unit.evidence_ids, source, references);
  if (
    unit.unit !== "page" &&
    unit.evidence_ids.some((id) => {
      const basis = references.get(id)?.content_basis;
      return typeof basis === "string" && basis !== `${unit.unit}_text`;
    })
  )
    throw new Error("Unidad incompatible con la evidencia");
  const retained = new Set(unit.evidence_ids);
  if (unit.analyzed_evidence_ids.some((id) => !retained.has(id)))
    throw new Error("Análisis fuera de muestra");
  requireCount(unit.retained_count, unit.evidence_ids);
  requireCount(unit.analyzed_count, unit.analyzed_evidence_ids);
  validateObservationState(unit);
}
function validatePlatform(
  platform: Platform,
  references: ReadonlyMap<string, Reference>,
) {
  const op = platform.query_operations;
  if (
    op.started !== null &&
    op.completed !== null &&
    op.failed !== null &&
    op.completed + op.failed > op.started
  )
    throw new Error("Operaciones incoherentes");
  const units = new Set<string>();
  for (const unit of platform.observations) {
    if (units.has(unit.unit)) throw new Error("Unidad repetida");
    units.add(unit.unit);
    validateObservation(unit, platform.source, references);
  }
}
function validateMetrics(
  value: unknown,
  references: ReadonlyMap<string, Reference>,
) {
  const result = platformMetrics.parse(value);
  const seen = new Set<string>();
  for (const platform of result.platforms) {
    if (seen.has(platform.source)) throw new Error("Fuente repetida");
    seen.add(platform.source);
    validatePlatform(platform, references);
  }
  return result;
}
function validateSentimentSample(
  group: SentimentGroup,
  references: ReadonlyMap<string, Reference>,
  metrics?: PlatformMetrics,
) {
  const evidenceIds = group.annotations.map((a) => a.evidence_id);
  if (
    new Set(evidenceIds).size !== evidenceIds.length ||
    evidenceIds.length !== group.eligible_count
  )
    throw new Error("Denominador incoherente");
  requireEvidence(evidenceIds, group.source, references);
  const unit = metrics?.platforms
    .find((platform) => platform.source === group.source)
    ?.observations.find(
      (observation) =>
        observation.unit ===
        (group.basis === "comment_text" ? "comment" : "post"),
    );
  if (!unit) throw new Error("Base de sentimiento no verificada");
  const retained = new Set(unit.evidence_ids);
  if (evidenceIds.some((id) => !retained.has(id)))
    throw new Error("Base de sentimiento no verificada");
}
function validateSentimentCounts(group: SentimentGroup) {
  const labels = {
    positive: 0,
    negative: 0,
    neutral: 0,
    mixed: 0,
    unclassified: 0,
  };
  for (const annotation of group.annotations) {
    labels[annotation.label]++;
    if (
      annotation.label === "unclassified"
        ? !annotation.limitations.length
        : !annotation.supporting_text
    )
      throw new Error("Clasificación sin soporte");
  }
  for (const label of ["positive", "negative", "neutral", "mixed"] as const)
    if (labels[label] !== group.counts[label])
      throw new Error("Distribución incoherente");
  if (
    labels.unclassified !== group.unclassified_count ||
    group.classified_count !== group.annotations.length - labels.unclassified
  )
    throw new Error("Clasificaciones incoherentes");
}
function validateSentimentStatus(result: Sentiment) {
  if (result.status === "not_applicable" && result.groups.length)
    throw new Error("Sentimiento no aplicable");
  if (result.status !== "analyzed" && !result.limitations.length)
    throw new Error("Faltan límites de muestra");
  if (
    result.status === "analyzed" &&
    !result.groups.some((group) => group.classified_count > 0)
  )
    throw new Error("No hay clasificaciones");
}
function validateSentiment(
  value: unknown,
  references: ReadonlyMap<string, Reference>,
  metrics?: PlatformMetrics,
) {
  const result = sentiment.parse(value);
  validateSentimentStatus(result);
  const groups = new Set<string>();
  for (const group of result.groups) {
    const key = JSON.stringify([
      group.source,
      group.basis,
      group.target,
      group.aspect,
    ]);
    if (groups.has(key)) throw new Error("Grupo repetido");
    groups.add(key);
    validateSentimentSample(group, references, metrics);
    validateSentimentCounts(group);
    if (result.status === "insufficient" && group.classified_count)
      throw new Error("Muestra insuficiente clasificada");
  }
  return result;
}

function treeChildren(value: object): unknown[] {
  if (Array.isArray(value)) {
    if (value.length > 800) throw new Error("Colección demasiado grande");
    return value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("Objeto no JSON");
  const children: unknown[] = [];
  let keys = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (++keys > 64) throw new Error("Demasiadas propiedades");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value"))
      throw new Error("Propiedad no JSON");
    children.push(key, descriptor.value);
  }
  return children;
}

/** Constrain JSON shape before Zod v3 allocates an issue for every invalid item. */
function requireBoundedTree(value: unknown) {
  const pending = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  let textSize = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++nodes > 20000 || current.depth > 12)
      throw new Error("Estructura demasiado grande");
    if (typeof current.value === "string") {
      textSize += current.value.length;
      if (textSize > 500000) throw new Error("Texto demasiado grande");
      continue;
    }
    if (current.value === null) continue;
    if (typeof current.value === "number" || typeof current.value === "boolean")
      continue;
    if (typeof current.value !== "object") throw new Error("Valor no JSON");
    if (seen.has(current.value))
      throw new Error("Estructura circular o compartida");
    seen.add(current.value);
    for (const child of treeChildren(current.value))
      pending.push({ value: child, depth: current.depth + 1 });
  }
}

function supportedExtension(
  raw: Record<string, unknown>,
  name: string,
  warnings: string[],
): Record<string, unknown> | undefined {
  try {
    const value = raw[name];
    if (!record(value) || value.schema_version !== "1.0") return undefined;
    requireBoundedTree(value);
    if (JSON.stringify(value).length > 500000)
      throw new Error("Extensión demasiado grande");
    return value;
  } catch {
    warnings.push(
      `La extensión ${name} supera los límites de estructura admitidos.`,
    );
    return undefined;
  }
}

/** Unknown domains and versions are ignored; invalid known capabilities get warnings. */
export function readReportExtensions(
  raw: unknown,
  references: ReadonlyMap<string, Reference>,
): ReportExtensions {
  const result: ReportExtensions = { warnings: [] };
  if (!record(raw)) return result;
  const metrics = supportedExtension(
    raw,
    "market.platform_metrics",
    result.warnings,
  );
  if (metrics) {
    try {
      result.metrics = validateMetrics(metrics, references);
    } catch {
      result.warnings.push(
        "Las métricas no superaron la validación de muestra y evidencias.",
      );
    }
  }
  const value = supportedExtension(raw, "market.sentiment", result.warnings);
  if (value) {
    try {
      result.sentiment = validateSentiment(value, references, result.metrics);
    } catch {
      result.warnings.push(
        "El sentimiento no superó la validación de muestra y evidencias.",
      );
    }
  }
  return result;
}
