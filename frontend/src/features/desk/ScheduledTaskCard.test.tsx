import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ScheduledTaskCard } from "./ScheduledTaskCard";
import type { ServerTask, TaskRun } from "./scheduledApi";

const task = {
  id: "task",
  name: "Escucha de mercado",
  status: "active",
  repeat: "daily",
  time: "20:01",
  timeZone: "America/Lima",
  nextRunAt: "2026-11-14T01:01:00Z",
} as ServerTask;
const interrupted: TaskRun = {
  id: "same-run",
  taskId: task.id,
  taskVersion: 1,
  status: "interrupted",
  recoverable: true,
  trigger: "initial",
  createdAt: "2026-11-13T01:14:42Z",
};
const props = () => ({
  task,
  selected: false,
  busy: false,
  onOpen: vi.fn(),
  onOpenRun: vi.fn(),
  onEdit: vi.fn(),
  onToggle: vi.fn(),
  onRemove: vi.fn(),
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("opens live activity from the compact task button without rendering execution rows", async () => {
  const callbacks = props();
  const request = vi.fn(
    async (_url: string, _options?: RequestInit) =>
      new Response(
        JSON.stringify({
          runs: [
            { ...interrupted, status: "running", recoverable: false },
            { ...interrupted, id: "old-report", status: "completed" },
          ],
        }),
      ),
  );
  vi.stubGlobal("fetch", request);
  const { container } = render(<ScheduledTaskCard {...callbacks} />);
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  await act(async () => {});
  fireEvent.click(
    screen.getByRole("button", { name: /Escucha de mercado Diario/ }),
  );
  expect(callbacks.onOpenRun).toHaveBeenCalledWith(task, "same-run");
  expect(callbacks.onOpen).not.toHaveBeenCalled();
  expect(container.querySelector("section")).toBeNull();
  expect(container.querySelector(".completed-report-row")).toBeNull();
  expect(screen.queryByText(/Versión|Interrumpida|old-report/)).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Recuperar|Descargar/ }),
  ).toBeNull();
  expect(
    request.mock.calls.every(([, options]) => options?.method === "GET"),
  ).toBe(true);
});

it("recovers the same run from its card icon once and opens it on the left", async () => {
  const callbacks = props();
  let complete!: (response: Response) => void;
  const request = vi.fn(async (_url: string, options?: RequestInit) =>
    options?.method === "POST"
      ? new Promise<Response>((resolve) => {
          complete = resolve;
        })
      : new Response(JSON.stringify({ runs: [interrupted] })),
  );
  vi.stubGlobal("fetch", request);
  render(<ScheduledTaskCard {...callbacks} />);
  const recover = await screen.findByRole("button", {
    name: "Recuperar ejecución Escucha de mercado",
  });
  expect(recover.getAttribute("data-tooltip")).toBe("Recuperar");
  expect(recover.querySelector("svg")).toBeTruthy();
  fireEvent.click(recover);
  fireEvent.click(recover);
  expect((recover as HTMLButtonElement).disabled).toBe(true);
  await act(async () =>
    complete(
      new Response(
        JSON.stringify({
          ...interrupted,
          status: "queued",
          recoverable: false,
        }),
      ),
    ),
  );
  await waitFor(() =>
    expect(callbacks.onOpenRun).toHaveBeenCalledWith(task, interrupted.id),
  );
  const mutations = request.mock.calls.filter(
    ([, options]) => options?.method === "POST",
  );
  expect(mutations).toHaveLength(1);
  expect(mutations[0][0]).toBe(
    "/api/desk/scheduled-tasks/task/runs/same-run/recover",
  );
  expect(screen.queryByRole("button", { name: /Recuperar/ })).toBeNull();
});

it("preserves the paused card's only Play action", async () => {
  const callbacks = props();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ runs: [interrupted] }))),
  );
  render(
    <ScheduledTaskCard {...callbacks} task={{ ...task, status: "paused" }} />,
  );
  await act(async () => {});
  expect(
    screen
      .getByRole("button", { name: "Reanudar Escucha de mercado" })
      .querySelector("svg"),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: /Editar|Eliminar|Recuperar/ }),
  ).toBeNull();
});

it("does not restore a stale recovery action when an earlier poll finishes after recovery", async () => {
  const callbacks = props();
  let refresh!: () => void;
  let completeStale!: (response: Response) => void;
  const timeout = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(
    (callback, delay, ...args) => {
      if (delay === 4000) {
        refresh = callback as () => void;
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return timeout(callback, delay, ...args);
    },
  );
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST")
        return new Response(
          JSON.stringify({
            ...interrupted,
            status: "queued",
            recoverable: false,
          }),
        );
      if (++reads === 1)
        return new Response(JSON.stringify({ runs: [interrupted] }));
      return new Promise<Response>((resolve) => {
        completeStale = resolve;
      });
    }),
  );
  render(<ScheduledTaskCard {...callbacks} />);
  const recover = await screen.findByRole("button", {
    name: /Recuperar ejecución/,
  });
  act(() => refresh());
  expect(reads).toBe(2);
  fireEvent.click(recover);
  await waitFor(() => expect(callbacks.onOpenRun).toHaveBeenCalledOnce());
  await act(async () =>
    completeStale(new Response(JSON.stringify({ runs: [interrupted] }))),
  );
  expect(
    screen.queryByRole("button", { name: /Recuperar ejecución/ }),
  ).toBeNull();
});

it("ignores recovery results after the account session changes", async () => {
  const callbacks = props();
  let complete!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? new Promise<Response>((resolve) => {
            complete = resolve;
          })
        : new Response(JSON.stringify({ runs: [interrupted] })),
    ),
  );
  render(<ScheduledTaskCard {...callbacks} />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Recuperar ejecución/ }),
  );
  act(() => window.dispatchEvent(new Event("agent-desk-session-changed")));
  await act(async () =>
    complete(
      new Response(JSON.stringify({ ...interrupted, status: "queued" })),
    ),
  );
  expect(callbacks.onOpenRun).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: /Recuperar ejecución/ }),
  ).toBeNull();
});
