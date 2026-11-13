import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowLeft, X } from "lucide-react";
import { storageKey } from "../../shared/identity";
import { prepareSavedReport } from "./reportDownload";
import { Limitations, additionalReportLimitations } from "./ReportSurface";
import { MarkdownText } from "./MarkdownText";
import { ReportMedia } from "./ReportMedia";
import { ReportLayoutSurface } from "./ReportLayoutSurface";
import { ReportTemplateEditor } from "./ReportTemplateEditor";
import { TaskRunActivity } from "./TaskRunActivity";
import {
  taskRequest,
  TaskRequestError,
  runLabels,
  type ServerTask,
  type TaskRun,
} from "./scheduledApi";
import "./ScheduledWorkspace.css";

interface WorkspaceProps {
  task: ServerTask;
  onClose: () => void;
  onBack?: () => void;
  requestedRun?: { id: string | null; nonce: number; editTemplate?: boolean };
}
export function TaskReportWorkspace(
  props: Omit<WorkspaceProps, "task"> & { task: ServerTask | null },
) {
  return props.task ? (
    <ReportTask {...props} task={props.task} />
  ) : (
    <section className="task-report-workspace" aria-label="Informes por tarea">
      <ReportHeading onClose={props.onClose} />
    </section>
  );
}
function ReportHeading({
  onClose,
  onBack,
  focusKey,
  onEditClose,
  saving = false,
}: Pick<WorkspaceProps, "onClose" | "onBack"> & {
  focusKey?: string | null;
  onEditClose?: () => void;
  saving?: boolean;
}) {
  const heading = useRef<HTMLElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [focusKey]);
  return (
    <header
      className="task-report-heading"
      ref={heading}
      tabIndex={-1}
      aria-label="Informes por tarea"
    >
      <button
        type="button"
        className="desk-wordmark report-home"
        aria-label="Ir al inicio"
        onClick={onClose}
        disabled={saving}
      >
        Agent <span className="t-gradient-text">Desk</span>
      </button>
      {onEditClose ? (
        <div className="report-editor-actions">
          <h2>Editar plantilla</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Cerrar ajuste de formato"
            disabled={saving}
            onClick={onEditClose}
          >
            <X size={18} />
          </button>
        </div>
      ) : (
        onBack && (
          <button
            type="button"
            className="icon-button report-mobile-back"
            aria-label="Volver a Tareas"
            onClick={onBack}
          >
            <ArrowLeft size={18} />
          </button>
        )
      )}
    </header>
  );
}
function ReportTask({ task, onClose, onBack, requestedRun }: WorkspaceProps) {
  const workspace = useRef<HTMLElement>(null);
  const [selected, updateSelected] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(
        storageKey(`agent-desk.report-run.${task.id}`),
      );
    } catch {
      return null;
    }
  });
  const setSelected = (id: string | null) => {
    updateSelected(id);
    try {
      const key = storageKey(`agent-desk.report-run.${task.id}`);
      if (id) sessionStorage.setItem(key, id);
      else sessionStorage.removeItem(key);
    } catch {
      /* The server keeps the report even if selection cannot be saved. */
    }
  };
  const [run, setRun] = useState<TaskRun | null>(null);
  const [error, setError] = useState("");
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [formatNotice, setFormatNotice] = useState("");
  const closeTemplate = () => {
    setEditingTemplate(false);
    requestAnimationFrame(() => {
      const action = [
        ...document.querySelectorAll<HTMLButtonElement>(
          "button[data-report-format]",
        ),
      ].find((button) => button.dataset.reportFormat === selected);
      if (action?.getClientRects().length) action.focus();
      else
        workspace.current
          ?.querySelector<HTMLElement>(".task-report-heading")
          ?.focus();
    });
  };
  useEffect(() => {
    if (requestedRun) {
      setSelected(requestedRun.id);
      setEditingTemplate(requestedRun.editTemplate === true);
    }
  }, [requestedRun?.nonce, requestedRun?.id, requestedRun?.editTemplate]);
  useEffect(() => {
    if (!selected) {
      setRun(null);
      return;
    }
    setRun((prior) =>
      prior?.id === selected && prior.taskId === task.id ? prior : null,
    );
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const value = await taskRequest<TaskRun>(
          `/${task.id}/runs/${selected}`,
          "GET",
          undefined,
          controller.signal,
        );
        if (active) {
          setRun((prior) =>
            JSON.stringify(prior) === JSON.stringify(value) ? prior : value,
          );
          setError("");
          timer = setTimeout(() => void refresh(), 2500);
        }
      } catch (e) {
        if (active) {
          const denied =
            e instanceof TaskRequestError &&
            [401, 403, 404, 409].includes(e.status);
          if (denied) {
            setRun(null);
            setEditingTemplate(false);
          }
          setError(
            e instanceof Error ? e.message : "No se pudo cargar el informe.",
          );
          if (!denied) timer = setTimeout(() => void refresh(), 2500);
        }
      }
    };
    const sessionChanged = () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      setRun(null);
      setEditingTemplate(false);
      setError("La sesión cambió. Vuelve a abrir el informe.");
    };
    window.addEventListener("agent-desk-session-changed", sessionChanged);
    void refresh();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener("agent-desk-session-changed", sessionChanged);
    };
  }, [task.id, selected, requestedRun?.nonce]);
  return (
    <section
      className="task-report-workspace"
      aria-label={task.name}
      ref={workspace}
    >
      <ReportHeading
        onClose={onClose}
        onBack={onBack}
        focusKey={selected}
        onEditClose={editingTemplate ? closeTemplate : undefined}
        saving={templateSaving}
      />
      {editingTemplate && (
        <ReportTemplateEditor
          taskId={task.id}
          previewRun={run}
          onSavingChange={setTemplateSaving}
          onClose={closeTemplate}
          onSaved={(version) =>
            setFormatNotice(
              `Formato guardado en la versión ${version}. Se aplicará en las próximas ejecuciones.`,
            )
          }
        />
      )}
      {!editingTemplate && (
        <div className="task-report-body">
          <h1 id="task-report-title" className="sr-only">
            {task.name}
          </h1>
          {formatNotice && (
            <p role="status" className="report-note">
              {formatNotice}
            </p>
          )}
          {error && (
            <p role="alert" className="config-feedback config-feedback-error">
              {error}
            </p>
          )}
          {selected ? (
            <>
              {run && run.id === selected ? (
                <SavedReport run={run} timeZone={task.timeZone} />
              ) : !error ? (
                <p role="status">Cargando informe…</p>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function SavedReport({
  run,
  timeZone,
}: {
  run: TaskRun;
  timeZone: string;
}) {
  const accepted = useMemo(() => prepareSavedReport(run), [run]);
  const { report, reportIssue, references, markdown, extensions } = accepted;
  return (
    <article className="saved-report" aria-label="Informe de ejecución">
      <header className="saved-report-header">
        <div>
          <h2>
            {report?.title ??
              (["completed", "partial"].includes(run.status)
                ? "Resultado de ejecución"
                : "Actividad de la tarea")}
          </h2>
          <p>
            {formatTime(run.createdAt, timeZone)} · {runLabels[run.status]} ·
            Versión {run.taskVersion}
          </p>
        </div>
      </header>
      {(run.status === "queued" || run.status === "running") && (
        <p role="status">
          {run.status === "queued"
            ? "La ejecución está en cola."
            : "El agente está investigando. Puedes salir de esta página; la ejecución continúa en el servidor."}
        </p>
      )}
      {run.error && (
        <p className="config-feedback config-feedback-error" role="alert">
          {run.error}
        </p>
      )}
      {run.status === "interrupted" && (
        <p>
          La ejecución fue interrumpida. Su resultado remoto puede ser
          desconocido; no se reintentó automáticamente.
        </p>
      )}
      {!["completed", "partial"].includes(run.status) && (
        <TaskRunActivity activity={run.activity} />
      )}
      {reportIssue && (
        <p className="report-note" role="status">
          {reportIssue}
        </p>
      )}
      {report?.period && (
        <p className="report-period">
          Periodo: {formatTime(report.period.start, report.period.time_zone)} —{" "}
          {formatTime(report.period.end, report.period.time_zone)} ·{" "}
          {report.period.time_zone} · final{" "}
          {report.period.bounds === "[start,end]" ? "inclusivo" : "exclusivo"}
        </p>
      )}
      {report ? (
        <ReportBoundary
          key={run.id}
          fallback={<MarkdownText text={markdown} live={false} />}
        >
          <ReportLayoutSurface
            report={report}
            references={references}
            extensions={extensions}
            presentation={run.presentation}
          />
        </ReportBoundary>
      ) : (
        markdown && <MarkdownText text={markdown} live={false} />
      )}
      <Limitations
        items={additionalReportLimitations(report, extensions.warnings)}
      />
      {report && <ReportMedia references={references} />}
    </article>
  );
}
function formatTime(value: string, zone: string) {
  return new Date(value).toLocaleString("es", { timeZone: zone });
}
class ReportBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <>
        <p role="status">
          La presentación no es compatible; se muestra Markdown.
        </p>
        {this.props.fallback}
      </>
    ) : (
      this.props.children
    );
  }
}
