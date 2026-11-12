export interface Presentation {
  schema_version: "1.0";
  purpose:
    | "progress"
    | "result"
    | "clarification"
    | "answer"
    | "artifact"
    | "terminal";
  activity?: {
    activity_id: string;
    phase: "retrieving" | "retrieved" | "reused" | "pending" | "failed";
    state: "running" | "pending" | "completed" | "failed";
    outcome:
      | "available"
      | "empty"
      | "insufficient"
      | "unavailable"
      | "pending"
      | "query_rejected"
      | "failed"
      | null;
  } | null;
}
const purposes: Record<string, Presentation["purpose"]> = {
  "source.coverage": "progress",
  "draft.upsert": "result",
  "draft.corrected": "result",
  "draft.compacted": "result",
  "clarification.required": "clarification",
  "run.completed": "answer",
  "artifact.upsert": "artifact",
  "run.failed": "terminal",
  "run.cancelled": "terminal",
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Presentación no válida");
  return value as Record<string, unknown>;
}
function validActivityState(activity: Record<string, unknown>): boolean {
  switch (activity.phase) {
    case "retrieving":
      return activity.state === "running" && activity.outcome === null;
    case "pending":
      return activity.state === "pending" && activity.outcome === "pending";
    case "failed":
      return activity.state === "failed" && activity.outcome === "failed";
    case "retrieved":
    case "reused":
      return (
        activity.state === "completed" &&
        typeof activity.outcome === "string" &&
        [
          "available",
          "empty",
          "insufficient",
          "unavailable",
          "query_rejected",
        ].includes(activity.outcome)
      );
    default:
      return false;
  }
}
export function parsePresentation(value: unknown, type: string): Presentation {
  const item = record(value);
  if (
    item.schema_version !== "1.0" ||
    !Object.hasOwn(purposes, type) ||
    item.purpose !== purposes[type] ||
    Object.keys(item).some(
      (key) => !["schema_version", "purpose", "activity"].includes(key),
    )
  )
    throw new TypeError("Propósito de presentación no válido");
  if (item.activity != null) {
    const activity = record(item.activity);
    if (
      type !== "source.coverage" ||
      typeof activity.activity_id !== "string" ||
      !/^[a-f0-9]{64}$/.test(activity.activity_id) ||
      Object.keys(activity).sort().join(",") !==
        "activity_id,outcome,phase,state"
    )
      throw new TypeError("Actividad no válida");
    if (!validActivityState(activity))
      throw new TypeError("Estado de actividad contradictorio");
  }
  return item as unknown as Presentation;
}
export function eventPresentation(
  event: Record<string, unknown>,
): Presentation | undefined {
  const coverage = event.coverage;
  if (
    !coverage ||
    typeof coverage !== "object" ||
    !("presentation" in coverage)
  )
    return;
  const parsed = parsePresentation(coverage.presentation, String(event.type));
  if (
    parsed.activity &&
    (typeof event.source_key !== "string" ||
      !event.source_key ||
      (coverage as Record<string, unknown>).phase !== parsed.activity.phase)
  )
    throw new TypeError("Origen o fase de actividad no válido");
  return parsed;
}
