import { apiFetch } from "../../shared/identity";
import { deskHeaders } from "./deskHttp";
import type { ScheduledTask } from "./scheduledTasks";
import type { ReportPresentation } from "./reportPresentation";

export interface ServerTask extends ScheduledTask {
  version: number;
  nextRunAt: string | null;
}
export interface TaskRun {
  id: string;
  taskId: string;
  taskVersion: number;
  status:
    "queued" | "running" | "completed" | "partial" | "failed" | "interrupted";
  trigger: "initial" | "manual" | "scheduled";
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  error?: string | null;
  response?: unknown;
  recoverable?: boolean;
  presentation?: ReportPresentation | null;
}
export interface TaskListing {
  tasks: ServerTask[];
  capabilities: { agentId: string; reportSchemaVersion: string }[];
}
export function taskDefinition(task: ScheduledTask): ScheduledTask {
  const {
    id,
    name,
    instructions,
    agentId,
    agentName,
    notify,
    repeat,
    startDate,
    time,
    timeZone,
    days,
    monthDay,
    interval,
    unit,
    endDate,
    status,
    createdAt,
  } = task;
  return {
    id,
    name,
    instructions,
    agentId,
    agentName,
    notify,
    repeat,
    startDate,
    time,
    timeZone,
    days,
    monthDay,
    interval,
    unit,
    endDate,
    status,
    createdAt,
  };
}
export class TaskRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export async function taskRequest<T>(
  path = "",
  method = "GET",
  value?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await apiFetch(`/api/desk/scheduled-tasks${path}`, {
    method,
    signal,
    headers: {
      ...deskHeaders,
      ...(value === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const body =
    response.status === 204
      ? undefined
      : await response.json().catch(() => undefined);
  if (!response.ok)
    throw new TaskRequestError(
      typeof body?.detail === "string"
        ? body.detail
        : "No se pudo completar la operación de tareas.",
      response.status,
    );
  return body as T;
}
export const runLabels: Record<TaskRun["status"], string> = {
  queued: "En cola",
  running: "En ejecución",
  completed: "Completada",
  partial: "Parcial",
  failed: "Fallida",
  interrupted: "Interrumpida",
};
