import { useEffect, useRef, useState } from "react";
import { Pencil, Pause, Play, RotateCw, Trash2 } from "lucide-react";
import { taskSchedule } from "./ScheduledPanel";
import {
  taskRequest,
  TaskRequestError,
  type ServerTask,
  type TaskRun,
} from "./scheduledApi";

export function ScheduledTaskCard({
  task,
  selected,
  busy,
  onOpen,
  onOpenRun,
  onEdit,
  onToggle,
  onRemove,
}: {
  task: ServerTask;
  selected: boolean;
  busy: boolean;
  onOpen: (task: ServerTask) => void;
  onOpenRun?: (task: ServerTask, runId: string) => void;
  onEdit: (task: ServerTask) => void;
  onToggle: (task: ServerTask) => void;
  onRemove: (task: ServerTask) => void;
}) {
  const [latest, setLatest] = useState<TaskRun | null>(null);
  const [error, setError] = useState("");
  const [recovering, setRecovering] = useState(false);
  const mutation = useRef<AbortController | null>(null);
  const recoveryInFlight = useRef(false);
  const readEpoch = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const epoch = readEpoch.current;
      try {
        const value = await taskRequest<{ runs: TaskRun[] }>(
          `/${task.id}/runs`,
          "GET",
          undefined,
          controller.signal,
        );
        if (
          !controller.signal.aborted &&
          !recoveryInFlight.current &&
          readEpoch.current === epoch
        ) {
          const runs = value.runs ?? [];
          setLatest(
            runs.find((run) => ["queued", "running"].includes(run.status)) ??
              runs[0] ??
              null,
          );
          setError("");
        }
      } catch (reason) {
        if (!controller.signal.aborted && readEpoch.current === epoch) {
          if (
            reason instanceof TaskRequestError &&
            [401, 403, 404, 409].includes(reason.status)
          )
            setLatest(null);
          setError(
            reason instanceof Error
              ? reason.message
              : "No se pudo consultar la actividad.",
          );
        }
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void refresh(), 4000);
      }
    };
    const clear = () => {
      controller.abort();
      mutation.current?.abort();
      clearTimeout(timer);
      setLatest(null);
      setRecovering(false);
      recoveryInFlight.current = false;
    };
    window.addEventListener("agent-desk-session-changed", clear);
    void refresh();
    return () => {
      controller.abort();
      mutation.current?.abort();
      clearTimeout(timer);
      window.removeEventListener("agent-desk-session-changed", clear);
    };
  }, [task.id]);
  const recover = async () => {
    if (!latest || recoveryInFlight.current || busy) return;
    const controller = new AbortController();
    mutation.current = controller;
    recoveryInFlight.current = true;
    ++readEpoch.current;
    setRecovering(true);
    setError("");
    try {
      const run = await taskRequest<TaskRun>(
        `/${task.id}/runs/${latest.id}/recover`,
        "POST",
        {},
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (run.id !== latest.id || run.taskId !== task.id)
        throw new Error("La respuesta no corresponde a esta ejecución.");
      setLatest(run);
      onOpenRun?.(task, run.id);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "No se pudo recuperar la ejecución.",
        );
    } finally {
      recoveryInFlight.current = false;
      if (!controller.signal.aborted) setRecovering(false);
    }
  };
  return (
    <article
      className={`scheduled-server-card${selected ? " is-selected" : ""}`}
    >
      <button
        type="button"
        className="scheduled-task-open"
        data-tooltip-disabled="true"
        aria-pressed={selected}
        onClick={() =>
          latest && onOpenRun ? onOpenRun(task, latest.id) : onOpen(task)
        }
      >
        <strong>{task.name}</strong>
        <span>
          {taskSchedule(task).split(" · ").slice(0, -2).join(" · ")} ·{" "}
          {task.nextRunAt
            ? `Próxima: ${new Date(task.nextRunAt).toLocaleString("es", {
                timeZone: task.timeZone,
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}`
            : task.time}
          <span className="sr-only"> · Zona horaria: {task.timeZone}</span>
        </span>
      </button>
      <div className="scheduled-server-actions">
        {task.status !== "paused" &&
          !error &&
          latest?.status === "interrupted" &&
          latest.recoverable && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Recuperar ejecución ${task.name}`}
              data-tooltip="Recuperar"
              disabled={busy || recovering}
              onClick={() => void recover()}
            >
              <RotateCw size={15} aria-hidden="true" />
            </button>
          )}
        {task.status !== "paused" && (
          <button
            type="button"
            className="icon-button"
            aria-label={`Editar ${task.name}`}
            data-tooltip="Editar"
            disabled={busy || recovering}
            onClick={() => onEdit(task)}
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
        )}
        {task.status !== "completed" && (
          <button
            type="button"
            className="icon-button"
            aria-label={`${task.status === "paused" ? "Reanudar" : "Pausar"} ${task.name}`}
            data-tooltip={task.status === "paused" ? "Reanudar" : "Pausar"}
            disabled={busy || recovering}
            onClick={() => onToggle(task)}
          >
            {task.status === "paused" ? (
              <Play size={15} aria-hidden="true" />
            ) : (
              <Pause size={15} aria-hidden="true" />
            )}
          </button>
        )}
        {task.status !== "paused" && (
          <button
            type="button"
            className="icon-button scheduled-delete"
            aria-label={`Eliminar ${task.name}`}
            data-tooltip="Eliminar"
            disabled={busy || recovering}
            onClick={() => onRemove(task)}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="scheduled-task-error">
          {error}
        </p>
      )}
    </article>
  );
}
