import { useEffect, useState } from "react";
import { Download, Eye, PanelsTopLeft, Trash2 } from "lucide-react";
import {
  taskRequest,
  runLabels,
  type ServerTask,
  type TaskRun,
} from "./scheduledApi";
import "./CompletedTaskReports.css";
export function CompletedTaskReports({
  task,
  onOpen,
  completedOnly = true,
  onDeleteReport,
  onFormat,
  hiddenRunIds = [],
  refreshKey = 0,
}: {
  task: ServerTask | null;
  onOpen: (task: ServerTask, runId: string) => void;
  completedOnly?: boolean;
  onDeleteReport?: (task: ServerTask, run: TaskRun) => void;
  onFormat?: (task: ServerTask, runId: string) => void;
  hiddenRunIds?: string[];
  refreshKey?: number;
}) {
  const [runs, setRuns] = useState<TaskRun[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setRuns([]);
    setError("");
    if (!task) return;
    const controller = new AbortController();
    let active = true;
    const refresh = async () => {
      try {
        const value = await taskRequest<{ runs: TaskRun[] }>(
          `/${task.id}/runs`,
          "GET",
          undefined,
          controller.signal,
        );
        if (active) {
          setRuns(value.runs);
          setError("");
        }
      } catch (reason) {
        if (active) {
          setRuns([]);
          setError(
            reason instanceof Error
              ? reason.message
              : "No se pudieron cargar los informes.",
          );
        }
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [task?.id, refreshKey]);
  if (!task) return null;
  const visibleRuns = runs.filter(
    (run) =>
      !hiddenRunIds.includes(run.id) &&
      ["completed", "partial"].includes(run.status) === completedOnly,
  );
  if (!error && visibleRuns.length === 0) return null;
  return (
    <section
      className={`completed-task-reports${completedOnly ? " completed-report-cards" : ""}`}
      id={`task-runs-${task.id}`}
      aria-label={`${completedOnly ? "Informes terminados" : "Ejecuciones"} de ${task.name}`}
    >
      {error && <p role="alert">{error}</p>}
      {visibleRuns.map((run) => (
        <article
          className={
            completedOnly
              ? "scheduled-server-card completed-report-card"
              : "completed-report-row"
          }
          key={run.id}
        >
          {completedOnly ? (
            <div className="completed-report-copy">
              <strong>{task.name}</strong>
              <div className="completed-report-meta">
                <span className="completed-report-date">
                  {new Date(run.createdAt).toLocaleString("es", {
                    timeZone: task.timeZone,
                  })}
                </span>
                <small>
                  <span className={`run-state run-state-${run.status}`}>
                    {runLabels[run.status]}
                  </span>{" "}
                  · Versión {run.taskVersion} ·{" "}
                  {
                    {
                      initial: "Manual",
                      manual: "Manual",
                      scheduled: "Programada",
                    }[run.trigger]
                  }
                </small>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="completed-report-open"
              aria-label={`Abrir ejecución ${run.id}`}
              onClick={() => onOpen(task, run.id)}
            >
              <span>
                {new Date(run.createdAt).toLocaleString("es", {
                  timeZone: task.timeZone,
                })}
              </span>
              <small>
                <span className={`run-state run-state-${run.status}`}>
                  {runLabels[run.status]}
                </span>{" "}
                · Versión {run.taskVersion} ·{" "}
                {
                  {
                    initial: "Manual",
                    manual: "Manual",
                    scheduled: "Programada",
                  }[run.trigger]
                }
              </small>
            </button>
          )}
          <div className="completed-report-actions">
            {completedOnly && (
              <button
                type="button"
                className="icon-button"
                aria-label={`Abrir ejecución ${run.id}`}
                data-tooltip="Ver"
                onClick={() => onOpen(task, run.id)}
              >
                <Eye size={16} aria-hidden="true" />
              </button>
            )}
            {completedOnly && onFormat && (
              <button
                type="button"
                className="icon-button"
                aria-label={`Formato del informe ${run.id}`}
                data-report-format={run.id}
                data-tooltip="Formato"
                onClick={() => onFormat(task, run.id)}
              >
                <PanelsTopLeft size={16} aria-hidden="true" />
              </button>
            )}
            {["completed", "partial"].includes(run.status) && (
              <button
                type="button"
                className="icon-button"
                aria-label={`Descargar informe ${run.id}`}
                data-tooltip="Descargar"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(run.id);
                  setError("");
                  try {
                    const value = await taskRequest<TaskRun>(
                      `/${task.id}/runs/${run.id}`,
                    );
                    if (value.id !== run.id || value.taskId !== task.id)
                      throw new Error(
                        "El informe no corresponde a esta ejecución.",
                      );
                    const { downloadRunReport } =
                      await import("./reportDownload");
                    downloadRunReport(value);
                  } catch (reason) {
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "No se pudo descargar el informe.",
                    );
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                <Download size={16} aria-hidden="true" />
              </button>
            )}
            {completedOnly && onDeleteReport && (
              <button
                type="button"
                className="icon-button completed-report-delete"
                aria-label={`Eliminar informe ${run.id}`}
                data-tooltip="Eliminar"
                disabled={busy !== null}
                onClick={() => onDeleteReport(task, run)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
