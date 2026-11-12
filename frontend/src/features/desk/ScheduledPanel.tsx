import { useEffect, useRef, useState } from "react";
import { Pencil, Pause, Play, Trash2 } from "lucide-react";
import { usePanelEntrance } from "./usePanelEntrance";
import { ScheduledTaskForm } from "./ScheduledTaskForm";
import {
  loadScheduledTasks,
  saveScheduledTasks,
  type ScheduledTask,
  type ScheduledTaskStore,
} from "./scheduledTasks";
import "./ScheduledPanel.css";

type Agent = { id: string; name: string };
const repeats = {
  once: "Una vez",
  hourly: "Cada hora",
  daily: "Diario",
  weekdays: "Días de semana",
  weekly: "Semanal",
  monthly: "Mensual",
  custom: "Personalizado",
};
export function taskSchedule(task: ScheduledTask) {
  const days = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const units = {
    minutes: "minutos",
    hours: "horas",
    days: "días",
    weeks: "semanas",
    months: "meses",
  };
  const recurrence =
    task.repeat === "custom"
      ? `Cada ${task.interval} ${units[task.unit]}`
      : repeats[task.repeat];
  const detail =
    task.repeat === "weekly" || task.repeat === "weekdays"
      ? ` · ${task.days.map((day) => days[day]).join(", ")}`
      : task.repeat === "monthly"
        ? ` · día ${task.monthDay}`
        : "";
  return `${recurrence}${detail} · ${task.time} · ${task.timeZone}`;
}
function newTask(id: number, agent: Agent): ScheduledTask {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return {
    id: String(id).padStart(4, "0"),
    name: "",
    instructions: "",
    agentId: agent.id,
    agentName: agent.name,
    notify: false,
    repeat: "once",
    startDate: date,
    time: "09:00",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    days: [1, 2, 3, 4, 5],
    monthDay: now.getDate(),
    interval: 1,
    unit: "days",
    endDate: "",
    status: "active",
    createdAt: now.toISOString(),
  };
}
export function ScheduledPanel({
  onClose,
  agents = [{ id: "demo", name: "Demostración local" }],
  selectedAgent = "demo",
  onEditingChange,
  backRequest = 0,
}: {
  onClose: () => void;
  agents?: Agent[];
  selectedAgent?: string;
  onEditingChange?: (editing: boolean) => void;
  backRequest?: number;
}) {
  const panel = useRef<HTMLElement>(null);
  const [loaded, setLoaded] = useState(loadScheduledTasks);
  const [tab, setTab] = useState<ScheduledTask["status"]>("active");
  const [draft, setDraft] = useState<ScheduledTask | null>(null);
  const [error, setError] = useState("");
  const [deleted, setDeleted] = useState<ScheduledTask | null>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (backRequest) {
      setDraft(null);
      setError("");
    }
  }, [backRequest]);
  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);
  useEffect(() => () => onEditingChange?.(false), [onEditingChange]);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  useEffect(() => {
    if (draft)
      panel.current?.querySelector<HTMLInputElement>("form input")?.focus();
  }, [draft]);
  usePanelEntrance(
    panel,
    ":scope > .config-step-tabs, :scope > .scheduled-task-list, :scope > footer",
  );
  const store = loaded.store;
  const commit = (next: ScheduledTaskStore) => {
    try {
      saveScheduledTasks(next, store);
      setLoaded({ store: next });
      setError("");
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudieron guardar las tareas.",
      );
      return false;
    }
  };
  const create = () => {
    const task = newTask(
      store.nextId,
      agents.find((agent) => agent.id === selectedAgent) ?? {
        id: selectedAgent,
        name: "Agente no disponible",
      },
    );
    setError("");
    setDraft(task);
  };
  const save = (task: ScheduledTask) => {
    const exists = store.tasks.some((item) => item.id === task.id);
    const next = {
      ...store,
      nextId: exists ? store.nextId : store.nextId + 1,
      tasks: exists
        ? store.tasks.map((item) => (item.id === task.id ? task : item))
        : [...store.tasks, task],
    };
    if (commit(next)) {
      setDraft(null);
      setTab(task.status);
      setDeleted(null);
    }
  };
  return (
    <section
      ref={panel}
      id="scheduled-panel"
      tabIndex={-1}
      className="agent-config-glass agent-config-inline scheduled-panel"
      aria-labelledby="chat-title"
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          window.CSS?.supports?.("selector(select:open)") &&
          (event.target as Element).closest("select")?.matches(":open")
        )
          return;
        if (event.key === "Escape") {
          event.stopPropagation();
          if (draft) setDraft(null);
          else onClose();
        }
      }}
    >
      {loaded.error && (
        <div className="config-feedback config-feedback-error" role="alert">
          {loaded.error}
          <button type="button" onClick={() => setLoaded(loadScheduledTasks())}>
            Volver a cargar
          </button>
        </div>
      )}
      {error && (
        <button
          type="button"
          className="scheduled-reload"
          onClick={() => {
            setLoaded(loadScheduledTasks());
            setDraft(null);
            setDeleted(null);
            setError("");
          }}
        >
          Recargar tareas y descartar edición
        </button>
      )}
      {!loaded.error && draft ? (
        <ScheduledTaskForm
          key={draft.id}
          task={draft}
          agents={agents}
          onSave={save}
          error={error}
        />
      ) : (
        <>
          <div
            className="config-step-tabs scheduled-tabs"
            data-tooltip-disabled="true"
            role="tablist"
            aria-label="Estado de tareas"
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
                key={value}
                type="button"
                role="tab"
                id={`scheduled-tab-${value}`}
                aria-controls="scheduled-task-list"
                aria-selected={tab === value}
                tabIndex={tab === value ? 0 : -1}
                onKeyDown={(event) => {
                  const states = ["active", "paused", "completed"] as const;
                  const index = states.indexOf(tab);
                  const next =
                    event.key === "ArrowRight"
                      ? states[(index + 1) % 3]
                      : event.key === "ArrowLeft"
                        ? states[(index + 2) % 3]
                        : event.key === "Home"
                          ? states[0]
                          : event.key === "End"
                            ? states[2]
                            : null;
                  if (next) {
                    event.preventDefault();
                    setTab(next);
                    document.getElementById(`scheduled-tab-${next}`)?.focus();
                  }
                }}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="config-feedback config-feedback-error">
              {error}
            </p>
          )}
          {deleted && (
            <div role="status" className="scheduled-undo">
              Tarea eliminada.
              <button
                type="button"
                onClick={() => {
                  if (commit({ ...store, tasks: [...store.tasks, deleted] }))
                    setDeleted(null);
                }}
              >
                Deshacer
              </button>
            </div>
          )}
          <div
            id="scheduled-task-list"
            tabIndex={0}
            role="tabpanel"
            aria-labelledby={`scheduled-tab-${tab}`}
            className="scheduled-task-list config-step-panel"
            key={tab}
          >
            {store.tasks
              .filter((task) => task.status === tab)
              .map((task) => (
                <article className="scheduled-card" key={task.id}>
                  <h4>{task.name}</h4>
                  <p>
                    {task.agentName} · #{task.id}
                  </p>
                  <p>{taskSchedule(task)}</p>
                  <p>
                    Desde {task.startDate}
                    {task.endDate ? ` · Hasta ${task.endDate}` : ""}
                  </p>
                  <div className="scheduled-card-actions">
                    <button
                      type="button"
                      aria-label={`Editar ${task.name}`}
                      disabled={!!loaded.error}
                      onClick={() => {
                        setError("");
                        setDraft(task);
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    {task.status !== "completed" && (
                      <button
                        type="button"
                        disabled={!!loaded.error}
                        aria-label={`${task.status === "active" ? "Pausar" : "Activar"} ${task.name}`}
                        onClick={() =>
                          commit({
                            ...store,
                            tasks: store.tasks.map((item) =>
                              item.id === task.id
                                ? {
                                    ...item,
                                    status:
                                      task.status === "active"
                                        ? "paused"
                                        : "active",
                                  }
                                : item,
                            ),
                          })
                        }
                      >
                        {task.status === "active" ? (
                          <Pause size={15} />
                        ) : (
                          <Play size={15} />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      className="scheduled-delete"
                      aria-label={`Eliminar ${task.name}`}
                      disabled={!!loaded.error}
                      onClick={() => {
                        if (
                          commit({
                            ...store,
                            tasks: store.tasks.filter(
                              (item) => item.id !== task.id,
                            ),
                          })
                        ) {
                          setDeleted(task);
                        }
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
          </div>
          <footer className="scheduled-list-footer">
            <button
              type="button"
              className="save-profile"
              data-tooltip-disabled="true"
              disabled={!!loaded.error || store.tasks.length >= 200}
              onClick={() => create()}
            >
              Nueva tarea
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
