import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { storageKey, useIdentity } from "../../shared/identity";
import {
  taskRequest,
  type ServerTask,
  type TaskListing,
  type TaskRun,
} from "./scheduledApi";
export { ScheduledWorkspacePanel } from "./ScheduledWorkspacePanel";
const TaskReportWorkspace = lazy(() =>
  import("./TaskReportWorkspace").then((module) => ({
    default: module.TaskReportWorkspace,
  })),
);

export function useScheduledReports(onHome?: () => void) {
  const identity = useIdentity();
  const [selectedTask, setSelectedTask] = useState<ServerTask | null>(null);
  const [view, setView] = useState<"closed" | "overview" | "task">("closed");
  const requestCount = useRef(0);
  const latestRequest = useRef<AbortController | null>(null);
  const [requestedRun, setRequestedRun] = useState<{
    id: string | null;
    nonce: number;
    editTemplate?: boolean;
  }>();
  const selectReportTask = (task: ServerTask | null) => {
    latestRequest.current?.abort();
    setSelectedTask(task);
    setView(task ? "overview" : "closed");
    setRequestedRun({ id: null, nonce: ++requestCount.current });
    try {
      const key = storageKey("agent-desk.report-task");
      if (task) localStorage.setItem(key, task.id);
      else localStorage.removeItem(key);
    } catch {
      /* Selection still works when browser storage is blocked. */
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    const generation = requestCount.current;
    let id: string | null = null;
    try {
      id = localStorage.getItem(storageKey("agent-desk.report-task"));
    } catch {
      return;
    }
    if (id && id.length <= 128)
      void taskRequest<TaskListing>("", "GET", undefined, controller.signal)
        .then((listing) => {
          if (
            !controller.signal.aborted &&
            requestCount.current === generation
          ) {
            const task = listing.tasks.find((task) => task.id === id) ?? null;
            setSelectedTask(task);
            const savedRun =
              task &&
              sessionStorage.getItem(
                storageKey(`agent-desk.report-run.${task.id}`),
              );
            setView(task ? (savedRun ? "task" : "overview") : "closed");
          }
        })
        .catch(() => {});
    return () => controller.abort();
  }, [identity.authenticated]);
  const reportTask = view === "task" ? selectedTask : null;
  const selectReportRun = (
    task: ServerTask,
    id: string,
    editTemplate = false,
  ) => {
    selectReportTask(task);
    setView("task");
    setRequestedRun({ id, nonce: ++requestCount.current, editTemplate });
  };
  const closeReport = () => {
    latestRequest.current?.abort();
    ++requestCount.current;
    setView("closed");
    try {
      localStorage.removeItem(storageKey("agent-desk.report-task"));
    } catch {}
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          '.chat-header button[aria-label="Cerrar Tareas"], .chat-header button[aria-label="Tareas"]',
        )
        ?.focus(),
    );
  };
  const openReports = async () => {
    latestRequest.current?.abort();
    const controller = new AbortController();
    latestRequest.current = controller;
    const generation = ++requestCount.current;
    setView("overview");
    try {
      const listing = await taskRequest<TaskListing>(
        "",
        "GET",
        undefined,
        controller.signal,
      );
      const histories = await Promise.allSettled(
        listing.tasks.map(async (task) => {
          const { runs } = await taskRequest<{ runs: TaskRun[] }>(
            `/${task.id}/runs`,
            "GET",
            undefined,
            controller.signal,
          );
          return runs
            .filter(
              (run) =>
                run.taskId === task.id &&
                ["completed", "partial"].includes(run.status),
            )
            .map((run) => ({ task, run }));
        }),
      );
      if (controller.signal.aborted || requestCount.current !== generation)
        return;
      const newest = histories
        .flatMap((result) =>
          result.status === "fulfilled" ? result.value : [],
        )
        .sort(
          (a, b) =>
            Date.parse(b.run.finishedAt ?? b.run.createdAt) -
              Date.parse(a.run.finishedAt ?? a.run.createdAt) ||
            b.run.id.localeCompare(a.run.id),
        )[0];
      if (newest) selectReportRun(newest.task, newest.run.id);
    } catch {
      // The task panel exposes listing failures and remains available for retry.
    }
  };
  useEffect(() => {
    const clear = () => {
      latestRequest.current?.abort();
      ++requestCount.current;
      setSelectedTask(null);
      setRequestedRun(undefined);
      setView("closed");
    };
    window.addEventListener("agent-desk-session-changed", clear);
    return () => {
      latestRequest.current?.abort();
      window.removeEventListener("agent-desk-session-changed", clear);
    };
  }, []);
  const removeReportRun = (taskId: string, runId: string) => {
    if (selectedTask?.id !== taskId) return;
    let selected = requestedRun?.id;
    try {
      selected ??= sessionStorage.getItem(
        storageKey(`agent-desk.report-run.${taskId}`),
      );
    } catch {}
    if (selected !== runId) return;
    latestRequest.current?.abort();
    ++requestCount.current;
    setRequestedRun({ id: null, nonce: requestCount.current });
    setView("overview");
    try {
      sessionStorage.removeItem(storageKey(`agent-desk.report-run.${taskId}`));
    } catch {}
  };
  const reportArea =
    view !== "closed" ? (
      <Suspense fallback={<p role="status">Cargando informes…</p>}>
        <TaskReportWorkspace
          key={
            reportTask ? `${reportTask.id}-${reportTask.version}` : "reports"
          }
          task={reportTask}
          onClose={() => {
            closeReport();
            onHome?.();
          }}
          onBack={() => {
            latestRequest.current?.abort();
            ++requestCount.current;
            setView("overview");
            requestAnimationFrame(() =>
              document.querySelector<HTMLElement>("#scheduled-panel")?.focus(),
            );
          }}
          requestedRun={requestedRun}
        />
      </Suspense>
    ) : null;
  return {
    reportTask,
    reportOpen: view !== "closed",
    openReports,
    closeReport,
    selectedTask,
    selectReportTask,
    selectReportRun,
    removeReportRun,
    reportArea,
  };
}
