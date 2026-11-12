import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ServerTask, TaskListing } from "./scheduledApi";
import { useScheduledReports } from "./useScheduledReports";
const requests = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("./scheduledApi", () => ({ taskRequest: requests.list }));
vi.mock("../../shared/identity", () => ({
  storageKey: (key: string) => key,
  useIdentity: () => ({ authenticated: false }),
}));
vi.mock("./ScheduledWorkspacePanel", () => ({
  ScheduledWorkspacePanel: () => null,
}));
vi.mock("./TaskReportWorkspace", () => ({
  TaskReportWorkspace: ({
    onClose,
    requestedRun,
  }: {
    onClose: () => void;
    requestedRun?: { id: string | null; editTemplate?: boolean };
  }) => (
    <>
      <output aria-label="Ejecución seleccionada">{requestedRun?.id}</output>
      <output aria-label="Modo formato">
        {String(requestedRun?.editTemplate === true)}
      </output>
      <button onClick={onClose}>Cerrar informe de prueba</button>
    </>
  ),
}));
const taskA = { id: "a", version: 1 } as ServerTask;
const taskB = { id: "b", version: 1 } as ServerTask;
function Harness({ onHome }: { onHome?: () => void }) {
  const reports = useScheduledReports(onHome);
  return (
    <>
      <output aria-label="Tarea seleccionada">
        {reports.selectedTask?.id}
      </output>
      <button onClick={() => reports.selectReportRun(taskB, "run-b")}>
        Abrir B
      </button>
      <button onClick={() => reports.selectReportRun(taskB, "run-b", true)}>
        Formato B
      </button>
      {reports.reportArea}
      <button onClick={() => reports.selectReportTask(taskA)}>
        Seleccionar tarjeta A
      </button>
      <output aria-label="Informe abierto">{reports.reportTask?.id}</output>
      <button onClick={() => void reports.openReports()}>Abrir tareas</button>
    </>
  );
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});
it("routes Formato to the chosen report and Ver exits the editor without research", async () => {
  requests.list.mockResolvedValue({ tasks: [], capabilities: [] });
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Formato B" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Modo formato").textContent).toBe("true"),
  );
  expect(screen.getByLabelText("Ejecución seleccionada").textContent).toBe(
    "run-b",
  );
  fireEvent.click(screen.getByRole("button", { name: "Abrir B" }));
  expect(screen.getByLabelText("Modo formato").textContent).toBe("false");
  expect(requests.list).not.toHaveBeenCalled();
});
it("opens the newest available finished report across authorized task histories once, including partial", async () => {
  const onHome = vi.fn();
  const tasks = [taskA, taskB, { id: "denied", version: 1 } as ServerTask];
  requests.list.mockImplementation(async (path: string) => {
    if (path === "") return { tasks, capabilities: [] };
    if (path === "/denied/runs") throw new Error("No autorizado");
    return {
      runs:
        path === "/a/runs"
          ? [
              {
                id: "old",
                taskId: "a",
                status: "completed",
                createdAt: "2026-11-12T10:00:00Z",
                finishedAt: "2026-11-12T10:10:00Z",
              },
              {
                id: "running",
                taskId: "a",
                status: "running",
                createdAt: "2026-11-12T12:00:00Z",
              },
              {
                id: "foreign",
                taskId: "foreign",
                status: "completed",
                createdAt: "2026-11-12T13:00:00Z",
              },
            ]
          : [
              {
                id: "latest",
                taskId: "b",
                status: "partial",
                createdAt: "2026-11-12T09:00:00Z",
                finishedAt: "2026-11-12T11:00:00Z",
              },
            ],
    };
  });
  render(<Harness onHome={onHome} />);
  fireEvent.click(screen.getByRole("button", { name: "Abrir tareas" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Informe abierto").textContent).toBe("b"),
  );
  expect(screen.getByLabelText("Ejecución seleccionada").textContent).toBe(
    "latest",
  );
  expect(requests.list).toHaveBeenCalledTimes(4);
  expect(requests.list.mock.calls.every((call) => call[1] === "GET")).toBe(
    true,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Cerrar informe de prueba" }),
  );
  expect(onHome).toHaveBeenCalledOnce();
});
it.each(["select", "close", "session"])(
  "does not let a late latest lookup override %s",
  async (action) => {
    let complete!: (value: unknown) => void;
    requests.list.mockImplementation(async (path: string) =>
      path === ""
        ? { tasks: [taskA], capabilities: [] }
        : new Promise((resolve) => {
            complete = resolve;
          }),
    );
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir tareas" }));
    await waitFor(() => expect(requests.list).toHaveBeenCalledTimes(2));
    if (action === "select")
      fireEvent.click(screen.getByRole("button", { name: "Abrir B" }));
    else if (action === "close")
      fireEvent.click(
        await screen.findByRole("button", { name: "Cerrar informe de prueba" }),
      );
    else
      act(() => window.dispatchEvent(new Event("agent-desk-session-changed")));
    await act(async () =>
      complete({
        runs: [
          {
            id: "late",
            taskId: "a",
            status: "completed",
            createdAt: "2026-11-12T12:00:00Z",
          },
        ],
      }),
    );
    expect(screen.getByLabelText("Informe abierto").textContent).toBe(
      action === "select" ? "b" : "",
    );
  },
);
it("keeps task selection in overview until an execution is opened", async () => {
  render(<Harness />);
  fireEvent.click(
    screen.getByRole("button", { name: "Seleccionar tarjeta A" }),
  );
  expect(screen.getByLabelText("Tarea seleccionada").textContent).toBe("a");
  expect(screen.getByLabelText("Informe abierto").textContent).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Abrir B" }));
  expect(screen.getByLabelText("Informe abierto").textContent).toBe("b");
});
it.each([false, true])(
  "does not replace a user selection or reopen a closed report when restoration arrives late (close=%s)",
  async (close) => {
    localStorage.setItem("agent-desk.report-task", "a");
    let restore!: (value: TaskListing) => void;
    requests.list.mockReturnValue(
      new Promise<TaskListing>((resolve) => {
        restore = resolve;
      }),
    );
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir B" }));
    const closeButton = await screen.findByRole("button", {
      name: "Cerrar informe de prueba",
    });
    if (close) fireEvent.click(closeButton);
    await act(async () => restore({ tasks: [taskA, taskB], capabilities: [] }));
    await waitFor(() =>
      expect(screen.getByLabelText("Tarea seleccionada").textContent).toBe("b"),
    );
    expect(
      screen.queryByRole("button", { name: "Cerrar informe de prueba" }) !==
        null,
    ).toBe(!close);
    expect(requests.list).toHaveBeenCalledTimes(1);
  },
);
