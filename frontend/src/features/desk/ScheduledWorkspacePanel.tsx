import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Pause, Play, Trash2, X } from "lucide-react";
import { loadScheduledTasks, type ScheduledTask } from "./scheduledTasks";
import { ScheduledTaskForm } from "./ScheduledTaskForm";
import { CompletedTaskReports } from "./CompletedTaskReports";
import { ReportEnableAction } from "./ReportSettings";
import { taskSchedule } from "./ScheduledPanel";
import { readChatStorage, writeChatStorage } from "./chatStorage";
import {
  taskRequest,
  taskDefinition,
  type ServerTask,
  type TaskListing,
  type TaskRun,
} from "./scheduledApi";
import "./ScheduledWorkspace.css";
import "./ScheduledInlineForm.css";
import "./ConversationMenu.css";

export function ScheduledWorkspacePanel({
  agents,
  selectedAgent,
  onClose,
  onSelectTask,
  onRemoveTask,
  createRequest = 0,
  selectedTask = null,
  onSelectReport,
  onFormatReport,
  onRemoveReport,
  onEditingChange,
  closeRequest = 0,
  canManageReports = false,
}: {
  agents: { id: string; name: string }[];
  selectedAgent: string;
  onClose: () => void;
  onSelectTask: (task: ServerTask) => void;
  onRemoveTask?: (id: string) => void;
  createRequest?: number;
  selectedTask?: ServerTask | null;
  onSelectReport?: (task: ServerTask, runId: string) => void;
  onFormatReport?: (task: ServerTask, runId: string) => void;
  onRemoveReport?: (taskId: string, runId: string) => void;
  onEditingChange?: (title: string | null) => void;
  closeRequest?: number;
  canManageReports?: boolean;
}) {
  const [listing, setListing] = useState<TaskListing>({
    tasks: [],
    capabilities: [],
  });
  const [loaded, setLoaded] = useState(false);
  const [legacy] = useState(loadScheduledTasks);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [formWarning, setFormWarning] = useState(false);
  const [blockedAgent, setBlockedAgent] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<ScheduledTask["status"]>(() => {
    const saved = readChatStorage("tasks-tab");
    return saved === "paused" || saved === "completed" ? saved : "active";
  });
  useEffect(() => {
    writeChatStorage("tasks-tab", tab);
  }, [tab]);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<ScheduledTask | null>(null);
  const [remove, setRemove] = useState<ServerTask | null>(null);
  const [removeReport, setRemoveReport] = useState<{
    task: ServerTask;
    run: TaskRun;
  } | null>(null);
  const [undoReport, setUndoReport] = useState<{
    taskId: string;
    runId: string;
  } | null>(null);
  const [hiddenReports, setHiddenReports] = useState<Record<string, string[]>>(
    {},
  );
  const [reportRefresh, setReportRefresh] = useState(0);
  const [reportError, setReportError] = useState("");
  const reportMutation = useRef<AbortController | null>(null);
  const editingCallback = useRef(onEditingChange);
  editingCallback.current = onEditingChange;
  const editingTitle = draft
    ? listing.tasks.some((task) => task.id === draft.id)
      ? "Editar tarea"
      : "Nueva tarea"
    : null;
  useEffect(() => {
    editingCallback.current?.(editingTitle);
  }, [editingTitle]);
  useEffect(
    () => () => {
      editingCallback.current?.(null);
    },
    [],
  );
  useEffect(() => {
    if (!busy) setDraft(null);
  }, [closeRequest]);
  useEffect(() => {
    const clear = () => {
      reportMutation.current?.abort();
      setUndoReport(null);
      setRemoveReport(null);
      setHiddenReports({});
      setBusy(false);
      setReportError("");
    };
    window.addEventListener("agent-desk-session-changed", clear);
    return () => {
      reportMutation.current?.abort();
      window.removeEventListener("agent-desk-session-changed", clear);
    };
  }, []);
  const dialog = useRef<HTMLDialogElement>(null);
  const add = () =>
    document.querySelector<HTMLButtonElement>(
      '.chat-header button[aria-label="Nueva tarea"]',
    );
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const value = await taskRequest<TaskListing>(
          "",
          "GET",
          undefined,
          signal,
        );
        if (tab === "completed") {
          const matches = await Promise.all(
            value.tasks.map(async (task) => {
              const result = await taskRequest<{ runs: TaskRun[] }>(
                `/${task.id}/runs`,
                "GET",
                undefined,
                signal,
              );
              return result.runs.some((run) =>
                ["completed", "partial"].includes(run.status),
              )
                ? task.id
                : null;
            }),
          );
          if (signal?.aborted) return;
          setCompletedIds(matches.filter((id): id is string => id !== null));
        }
        setListing(value);
        setLoaded(true);
        setError("");
      } catch (e) {
        if (!signal?.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "No se pudieron cargar las tareas.",
          );
      }
    },
    [tab],
  );
  useEffect(() => {
    setLoaded(false);
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(controller.signal), 4000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (remove || removeReport) dialog.current?.showModal();
    else if (dialog.current?.open) {
      dialog.current.close();
      add()?.focus();
    }
  }, [remove, removeReport]);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const supported = agents.filter((a) =>
    listing.capabilities.some(
      (c) => c.agentId === a.id && c.reportSchemaVersion === "1.0",
    ),
  );
  const save = async (task: ScheduledTask) => {
    if (busy) return;
    const showSaveError = draft ? setFormError : setError;
    if (
      !listing.capabilities.some(
        (capability) =>
          capability.agentId === task.agentId &&
          capability.reportSchemaVersion === "1.0",
      )
    ) {
      setFormWarning(true);
      setBlockedAgent(task.agentId);
      showSaveError(
        canManageReports
          ? "El Agent Flow seleccionado no tiene habilitada la entrega de informes. Puedes habilitarla si el agente es compatible."
          : "El Agent Flow seleccionado no tiene habilitada la entrega de informes. Selecciona otro Agent Flow.",
      );
      return;
    }
    setBusy(true);
    setFormWarning(false);
    setFormError("");
    setError("");
    try {
      const saved = await taskRequest<ServerTask>(
        `/${task.id}`,
        "PUT",
        taskDefinition(task),
      );
      setDraft(null);
      setTab(saved.status);
      await refresh();
      onSelectTask(saved);
    } catch (e) {
      showSaveError(
        e instanceof Error ? e.message : "No se pudo guardar la tarea.",
      );
    } finally {
      setBusy(false);
    }
  };
  const change = async (task: ServerTask) => {
    await save({
      ...task,
      status: task.status === "paused" ? "active" : "paused",
    });
  };
  const create = () => {
    const agent = agents.find((a) => a.id === selectedAgent) ??
      agents[0] ?? { id: "", name: "Selecciona un Agent Flow" };
    setError("");
    setFormError("");
    setDraft(newServerTask(agent, listing.tasks));
  };
  const handledRequest = useRef(0);
  useEffect(() => {
    if (loaded && createRequest !== handledRequest.current) {
      handledRequest.current = createRequest;
      create();
    }
  }, [createRequest, loaded, supported.length]);
  const visibleTasks = listing.tasks.filter((task) =>
    tab === "completed" ? completedIds.includes(task.id) : task.status === tab,
  );
  const deleteReport = async () => {
    if (!removeReport || busy) return;
    const { task, run } = removeReport;
    const controller = new AbortController();
    reportMutation.current = controller;
    setBusy(true);
    setReportError("");
    try {
      await taskRequest(
        `/${task.id}/runs/${run.id}/report`,
        "DELETE",
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setHiddenReports((prior) => ({
        ...prior,
        [task.id]: [...(prior[task.id] ?? []), run.id],
      }));
      setUndoReport({ taskId: task.id, runId: run.id });
      onRemoveReport?.(task.id, run.id);
      setRemoveReport(null);
      setReportRefresh((value) => value + 1);
      await refresh(controller.signal);
    } catch (reason) {
      if (!controller.signal.aborted)
        setReportError(
          reason instanceof Error
            ? reason.message
            : "No se pudo eliminar el informe.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const restoreReport = async () => {
    if (!undoReport || busy) return;
    const { taskId, runId } = undoReport;
    const controller = new AbortController();
    reportMutation.current = controller;
    setBusy(true);
    setReportError("");
    try {
      await taskRequest(
        `/${taskId}/runs/${runId}/report/restore`,
        "POST",
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setHiddenReports((prior) => ({
        ...prior,
        [taskId]: (prior[taskId] ?? []).filter((id) => id !== runId),
      }));
      setUndoReport(null);
      setReportRefresh((value) => value + 1);
      await refresh(controller.signal);
    } catch (reason) {
      if (!controller.signal.aborted)
        setReportError(
          reason instanceof Error
            ? reason.message
            : "No se pudo restaurar el informe.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <section
      ref={panel}
      id="scheduled-panel"
      tabIndex={-1}
      className="scheduled-server-panel agent-config-inline"
      aria-label="Tareas"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (busy) {
            event.preventDefault();
            return;
          }
          if (draft || remove || removeReport) {
            setDraft(null);
            setRemove(null);
            setRemoveReport(null);
          } else onClose();
        }
      }}
    >
      {undoReport && (
        <div className="scheduled-report-undo" role="status">
          <span>Informe eliminado.</span>
          <button
            type="button"
            className="report-back"
            disabled={busy}
            onClick={() => void restoreReport()}
          >
            Deshacer
          </button>
        </div>
      )}
      {reportError && !removeReport && (
        <p role="alert" className="form-error">
          {reportError}
        </p>
      )}
      {draft ? (
        <section
          className="scheduled-inline-form"
          aria-label={editingTitle ?? "Tarea"}
        >
          <ScheduledTaskForm
            key={draft.id}
            task={draft}
            agents={agents}
            onSave={(task) => void save(task)}
            error={formError}
            warning={formWarning}
            onAgentChange={() => {
              setFormError("");
              setFormWarning(false);
              setBlockedAgent("");
            }}
            noticeAction={
              canManageReports &&
              formWarning &&
              blockedAgent &&
              /^[a-f0-9]{32}$/.test(blockedAgent.replace(/^test:/, "")) ? (
                <ReportEnableAction
                  key={blockedAgent}
                  agentId={blockedAgent}
                  onEnabled={async () => {
                    await refresh();
                    setFormError("");
                    setFormWarning(false);
                    setBlockedAgent("");
                  }}
                />
              ) : undefined
            }
            onCancel={() => setDraft(null)}
            submitLabel={
              busy
                ? "Guardando…"
                : listing.tasks.some((task) => task.id === draft.id)
                  ? "Guardar cambios"
                  : "Guardar y ejecutar"
            }
            disabled={busy}
          />
        </section>
      ) : (
        <>
          <div
            className="config-step-tabs scheduled-tabs"
            role="tablist"
            aria-label="Estado de tareas"
            data-tooltip-disabled="true"
          >
            <span
              className="config-step-pill"
              aria-hidden="true"
              style={{
                transform: `translateX(${["active", "paused", "completed"].indexOf(tab) * 100}%)`,
              }}
            />
            {(
              [
                ["active", "Activadas"],
                ["paused", "En pausa"],
                ["completed", "Completadas"],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                id={`server-tab-${value}`}
                role="tab"
                aria-selected={tab === value}
                aria-controls="server-task-list"
                tabIndex={tab === value ? 0 : -1}
                onKeyDown={(event) => {
                  const states = ["active", "paused", "completed"] as const;
                  const index = states.indexOf(value);
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % 3
                      : event.key === "ArrowLeft"
                        ? (index + 2) % 3
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? 2
                            : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  setTab(states[next]);
                  document
                    .getElementById(`server-tab-${states[next]}`)
                    ?.focus();
                }}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {error && !draft && !remove && !removeReport && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <LegacyTaskImports
            loaded={loaded}
            tasks={legacy.store.tasks}
            existing={listing.tasks}
            agents={supported}
            busy={busy}
            onImport={(task) =>
              void save({ ...task, status: "paused", notify: false })
            }
          />
          <div
            id="server-task-list"
            role="tabpanel"
            aria-busy={!loaded && !error}
            aria-labelledby={`server-tab-${tab}`}
            className="scheduled-server-list"
          >
            {loaded && !visibleTasks.length && (
              <p className="scheduled-help">
                {tab === "completed"
                  ? "Todavía no hay informes terminados."
                  : "No hay tareas en este estado."}
              </p>
            )}
            {loaded &&
              visibleTasks.map((task) =>
                tab === "completed" ? (
                  <CompletedTaskReports
                    key={task.id}
                    task={task}
                    onOpen={(value, id) => onSelectReport?.(value, id)}
                    onFormat={onFormatReport}
                    onDeleteReport={(task, run) => {
                      setReportError("");
                      setRemoveReport({ task, run });
                    }}
                    hiddenRunIds={hiddenReports[task.id] ?? []}
                    refreshKey={reportRefresh}
                  />
                ) : (
                  <ScheduledTaskRow
                    key={task.id}
                    task={task}
                    reportsOnly={false}
                    selected={selectedTask?.id === task.id}
                    busy={busy}
                    onOpen={onSelectTask}
                    onEdit={(value) => {
                      setError("");
                      setFormError("");
                      setDraft(value);
                    }}
                    onToggle={(value) => void change(value)}
                    onRemove={setRemove}
                  >
                    {selectedTask?.id === task.id && onSelectReport && (
                      <CompletedTaskReports
                        key={task.id}
                        task={task}
                        onOpen={onSelectReport}
                        completedOnly={false}
                      />
                    )}
                  </ScheduledTaskRow>
                ),
              )}
          </div>
        </>
      )}
      <dialog
        ref={dialog}
        className="history-delete-dialog task-delete-dialog"
        aria-labelledby="task-dialog-title"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else {
            setDraft(null);
            setRemove(null);
            setRemoveReport(null);
          }
        }}
        onClose={() => {
          if (!busy) {
            setDraft(null);
            setRemove(null);
            setRemoveReport(null);
            add()?.focus();
          }
        }}
      >
        <header>
          <h2 id="task-dialog-title">
            {removeReport
              ? "Eliminar informe"
              : remove
                ? "Eliminar tarea"
                : listing.tasks.some((t) => t.id === draft?.id)
                  ? "Editar tarea"
                  : "Nueva tarea"}
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Cerrar formulario"
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setRemove(null);
              setRemoveReport(null);
            }}
          >
            <X size={18} />
          </button>
        </header>
        {removeReport ? (
          <>
            <p>
              El informe de «{removeReport.task.name}» se quitará de
              Completadas. Podrás deshacerlo.
            </p>
            {reportError && <p role="alert">{reportError}</p>}
            <footer>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRemoveReport(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="history-confirm-delete"
                disabled={busy}
                onClick={() => void deleteReport()}
              >
                Eliminar informe
              </button>
            </footer>
          </>
        ) : remove ? (
          <>
            <p>Se eliminarán «{remove.name}» y sus informes guardados.</p>
            {error && <p role="alert">{error}</p>}
            <footer>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRemove(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="history-confirm-delete"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await taskRequest(`/${remove.id}`, "DELETE");
                    onRemoveTask?.(remove.id);
                    setRemove(null);
                    await refresh();
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "No se pudo eliminar.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Eliminar tarea
              </button>
            </footer>
          </>
        ) : null}
      </dialog>
    </section>
  );
}
function LegacyTaskImports({
  loaded,
  tasks,
  existing,
  agents,
  busy,
  onImport,
}: {
  loaded: boolean;
  tasks: ScheduledTask[];
  existing: ServerTask[];
  agents: { id: string }[];
  busy: boolean;
  onImport: (task: ScheduledTask) => void;
}) {
  const pending = tasks.filter(
    (task) => !existing.some((current) => current.id === task.id),
  );
  if (!loaded || !pending.length) return null;
  return (
    <details className="scheduled-help">
      <summary>Definiciones guardadas en este navegador</summary>
      <p>
        Se conservan sin ejecutarse. Puedes importarlas al servidor en pausa.
      </p>
      {pending.map((task) => (
        <div key={task.id}>
          <span>
            {task.name} · {task.agentName}
          </span>
          <button
            type="button"
            className="report-back"
            disabled={
              busy || !agents.some((agent) => agent.id === task.agentId)
            }
            onClick={() => onImport(task)}
          >
            Importar en pausa
          </button>
        </div>
      ))}
    </details>
  );
}
function newServerTask(
  agent: { id: string; name: string },
  tasks: ServerTask[],
): ScheduledTask {
  const now = new Date();
  const start = new Date(now.getTime() + 5 * 60000);
  let id = String(
    Date.now() * 1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 1000),
  );
  while (tasks.some((task) => task.id === id)) id = String(Number(id) + 1);
  return {
    id,
    name: "",
    instructions: "",
    agentId: agent.id,
    agentName: agent.name,
    notify: false,
    repeat: "daily",
    startDate: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`,
    time: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
    timeZone:
      Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Lima",
    days: [1, 2, 3, 4, 5],
    monthDay: start.getDate(),
    interval: 1,
    unit: "days",
    endDate: "",
    status: "active",
    createdAt: now.toISOString(),
  };
}

function ScheduledTaskRow({
  task,
  reportsOnly,
  selected,
  children,
  busy,
  onOpen,
  onEdit,
  onToggle,
  onRemove,
}: {
  task: ServerTask;
  reportsOnly: boolean;
  selected: boolean;
  children: React.ReactNode;
  busy: boolean;
  onOpen: (task: ServerTask) => void;
  onEdit: (task: ServerTask) => void;
  onToggle: (task: ServerTask) => void;
  onRemove: (task: ServerTask) => void;
}) {
  return (
    <article
      className={`scheduled-server-card${selected ? " is-selected" : ""}`}
    >
      <button
        type="button"
        className="scheduled-task-open"
        data-tooltip-disabled="true"
        aria-expanded={selected}
        onClick={() => onOpen(task)}
      >
        <strong>{task.name}</strong>
        {!reportsOnly && (
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
        )}
      </button>
      {!reportsOnly && (
        <div className="scheduled-server-actions">
          {task.status !== "paused" && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Editar ${task.name}`}
              data-tooltip="Editar"
              disabled={busy}
              onClick={() => {
                onEdit(task);
              }}
            >
              <Pencil size={15} />
            </button>
          )}
          {task.status !== "completed" && (
            <button
              type="button"
              className="icon-button"
              aria-label={`${task.status === "paused" ? "Reanudar" : "Pausar"} ${task.name}`}
              data-tooltip={task.status === "paused" ? "Reanudar" : "Pausar"}
              disabled={busy}
              onClick={() => onToggle(task)}
            >
              {task.status === "paused" ? (
                <Play size={15} />
              ) : (
                <Pause size={15} />
              )}
            </button>
          )}
          {task.status !== "paused" && (
            <button
              type="button"
              className="icon-button scheduled-delete"
              aria-label={`Eliminar ${task.name}`}
              data-tooltip="Eliminar"
              disabled={busy}
              onClick={() => onRemove(task)}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      )}
      {children}
    </article>
  );
}
