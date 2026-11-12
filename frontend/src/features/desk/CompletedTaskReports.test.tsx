import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CompletedTaskReports } from "./CompletedTaskReports";
import type { ServerTask } from "./scheduledApi";
const actions = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("./reportDownload", () => ({ downloadRunReport: actions.download }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  actions.download.mockReset();
  vi.restoreAllMocks();
});
it("does not show a heading or loading footer before the concrete report rows arrive", async () => {
  let complete!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    ),
  );
  const view = render(
    <CompletedTaskReports
      task={
        { id: "task", name: "Prueba", timeZone: "America/Lima" } as ServerTask
      }
      onOpen={vi.fn()}
    />,
  );
  expect(view.container.childElementCount).toBe(0);
  await act(async () =>
    complete(
      new Response(
        JSON.stringify({
          runs: [
            {
              id: "done",
              status: "partial",
              createdAt: "2026-11-12T10:00:00Z",
              taskVersion: 1,
              trigger: "initial",
            },
          ],
        }),
      ),
    ),
  );
  expect(
    await screen.findByRole("button", { name: "Descargar informe done" }),
  ).toBeTruthy();
  expect(screen.queryByRole("heading")).toBeNull();
  expect(screen.queryByText("Cargando informes…")).toBeNull();
});

it("opens format for the selected report and uses one-word tooltips and two origin labels", async () => {
  const task = {
    id: "task",
    name: "Informe",
    timeZone: "America/Lima",
  } as ServerTask;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            runs: [
              {
                id: "first",
                status: "completed",
                taskVersion: 1,
                trigger: "initial",
                createdAt: "2026-11-12T10:00:00Z",
              },
              {
                id: "scheduled",
                status: "completed",
                taskVersion: 1,
                trigger: "scheduled",
                createdAt: "2026-11-12T11:00:00Z",
              },
            ],
          }),
        ),
    ),
  );
  const onFormat = vi.fn();
  const { container } = render(
    <CompletedTaskReports
      task={task}
      onOpen={vi.fn()}
      onFormat={onFormat}
      onDeleteReport={vi.fn()}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Formato del informe first" }),
  );
  expect(onFormat).toHaveBeenCalledWith(task, "first");
  expect(screen.getByText(/· Versión 1 · Manual/)).toBeTruthy();
  expect(screen.getByText(/· Versión 1 · Programada/)).toBeTruthy();
  expect(screen.queryByText(/Prueba inicial/)).toBeNull();
  for (const button of container.querySelectorAll("[data-tooltip]"))
    expect(button.getAttribute("data-tooltip")?.split(/\s+/)).toHaveLength(1);
});
it("omits the execution block when only finished reports remain", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ runs: [{ id: "done", status: "partial" }] }),
        ),
    ),
  );
  const view = render(
    <CompletedTaskReports
      task={{ id: "task", name: "Prueba" } as ServerTask}
      onOpen={vi.fn()}
      completedOnly={false}
    />,
  );
  await waitFor(() =>
    expect(view.container.querySelector(".completed-task-reports")).toBeNull(),
  );
  expect(screen.queryByText("Sin ejecución en curso.")).toBeNull();
});
it("keeps manual execution disabled when polling loses the active run state", async () => {
  let refresh!: () => Promise<void>;
  const interval = globalThis.setInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation((callback, delay) => {
    if (delay === 4000) {
      refresh = callback as () => Promise<void>;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }
    return interval(callback, delay);
  });
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          runs: [
            {
              id: "active",
              status: "running",
              taskVersion: 1,
              trigger: "initial",
              createdAt: "2026-11-12T10:00:00Z",
            },
          ],
        }),
      ),
    )
    .mockRejectedValue(new Error("Estado desconocido"));
  vi.stubGlobal("fetch", request);
  render(
    <CompletedTaskReports
      task={
        {
          id: "task",
          name: "Mercado",
          status: "active",
          timeZone: "America/Lima",
        } as ServerTask
      }
      onOpen={vi.fn()}
      completedOnly={false}
    />,
  );
  await screen.findByRole("button", { name: "Abrir ejecución active" });
  await act(async () => {
    await refresh();
  });
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Estado desconocido",
  );
  expect(screen.queryByRole("button", { name: "Ejecutar ahora" })).toBeNull();
});
it("keeps failed executions accessible without manual actions or completed downloads", async () => {
  const task = {
    id: "task",
    name: "Mercado",
    status: "active",
    timeZone: "America/Lima",
  } as ServerTask;
  const rows = ["failed", "completed", "partial"].map((status) => ({
    id: status,
    status,
    createdAt: "2026-11-12T10:00:00Z",
    trigger: "initial",
    taskVersion: 1,
  }));
  const request = vi.fn(
    async () => new Response(JSON.stringify({ runs: rows })),
  );
  vi.stubGlobal("fetch", request);
  const open = vi.fn();
  render(
    <CompletedTaskReports task={task} onOpen={open} completedOnly={false} />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Abrir ejecución failed" }),
  );
  expect(open).toHaveBeenCalledWith(task, "failed");
  expect(screen.queryByRole("button", { name: "Ejecutar ahora" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Descargar informe/ }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Abrir ejecución completed" }),
  ).toBeNull();
});
it("downloads the concrete completed report from its own row without starting another run", async () => {
  const task = {
    id: "1234",
    name: "Informe",
    agentName: "Agente oculto",
    timeZone: "America/Lima",
  } as ServerTask;
  const rows = [
    {
      id: "first",
      taskId: task.id,
      status: "completed",
      taskVersion: 1,
      createdAt: "2026-11-11T15:00:00Z",
    },
    {
      id: "second",
      taskId: task.id,
      status: "partial",
      taskVersion: 2,
      createdAt: "2026-11-11T16:00:00Z",
    },
    {
      id: "running",
      taskId: task.id,
      status: "running",
      taskVersion: 2,
      createdAt: "2026-11-11T17:00:00Z",
    },
  ];
  const fetch = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(url.endsWith("/runs") ? { runs: rows } : rows[1]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const open = vi.fn();
  const remove = vi.fn();
  const view = render(
    <CompletedTaskReports task={task} onOpen={open} onDeleteReport={remove} />,
  );
  const button = await screen.findByRole("button", {
    name: "Descargar informe second",
  });
  const cards = view.container.querySelectorAll(
    "article.completed-report-card",
  );
  expect(cards).toHaveLength(2);
  expect(cards[0].querySelector("strong")?.textContent).toBe(task.name);
  expect(screen.queryByText("Agente oculto")).toBeNull();
  expect(
    cards[0].querySelector(".completed-report-meta .completed-report-date"),
  ).toBeTruthy();
  expect(cards[0].querySelector(".completed-report-meta small")).toBeTruthy();
  const eye = screen.getByRole("button", { name: "Abrir ejecución second" });
  expect(eye.getAttribute("data-tooltip")).toBe("Ver");
  expect(eye.querySelector("svg")).toBeTruthy();
  expect(eye.parentElement).toBe(button.parentElement);
  fireEvent.click(eye);
  expect(open).toHaveBeenCalledWith(task, "second");
  const trash = screen.getByRole("button", { name: "Eliminar informe second" });
  expect(trash.classList.contains("completed-report-delete")).toBe(true);
  expect(trash.querySelector("svg")).toBeTruthy();
  expect(trash.previousElementSibling).toBe(button);
  fireEvent.click(trash);
  expect(remove).toHaveBeenCalledWith(task, rows[1]);
  expect(
    screen.queryByRole("button", { name: "Descargar informe running" }),
  ).toBeNull();
  fireEvent.click(button);
  await waitFor(() => expect(actions.download).toHaveBeenCalledWith(rows[1]));
  expect(fetch.mock.calls.every((call) => call[0].includes("/runs"))).toBe(
    true,
  );
  expect(
    fetch.mock.calls.some((call) => call[0].endsWith("/runs/second")),
  ).toBe(true);
});
