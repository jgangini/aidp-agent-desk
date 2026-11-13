import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ScheduledWorkspacePanel } from "./ScheduledWorkspacePanel";
import { useState } from "react";
import type { ServerTask } from "./scheduledApi";

it.each([false, true])(
  "keeps the task draft and requires saving after admin enrollment (admin=%s)",
  async (admin) => {
    const identity = "a".repeat(32);
    let enabled = false;
    let saved: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith("/reports")) {
        if (options?.method === "PUT") enabled = true;
        return new Response(JSON.stringify({ prod: enabled, test: false }));
      }
      if (options?.method === "PUT") {
        saved = { ...JSON.parse(String(options.body)), version: 1 };
        return new Response(JSON.stringify(saved));
      }
      return new Response(
        JSON.stringify({
          tasks: saved ? [saved] : [],
          capabilities: enabled
            ? [{ agentId: identity, reportSchemaVersion: "1.0" }]
            : [],
        }),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    render(
      <ScheduledWorkspacePanel
        agents={[{ id: identity, name: "Flow" }]}
        selectedAgent={identity}
        createRequest={1}
        canManageReports={admin}
        onClose={() => {}}
        onSelectTask={() => {}}
      />,
    );
    const form = await screen.findByRole("region", { name: "Nueva tarea" });
    fireEvent.change(within(form).getByLabelText("Nombre de la tarea"), {
      target: { value: "Informe conservado" },
    });
    fireEvent.change(within(form).getByLabelText(/Instrucciones/), {
      target: { value: "Investigar novedades" },
    });
    fireEvent.click(
      within(form).getByRole("button", { name: "Guardar y ejecutar" }),
    );
    await within(form).findByRole("alert");
    expect(saved).toBeUndefined();
    if (!admin) {
      expect(
        screen.queryByRole("button", { name: "Habilitar informes" }),
      ).toBeNull();
      expect(fetcher.mock.calls.some(([url]) => url.endsWith("/reports"))).toBe(
        false,
      );
      return;
    }
    fireEvent.click(
      within(form).getByRole("button", { name: "Habilitar informes" }),
    );
    await waitFor(() => expect(within(form).queryByRole("alert")).toBeNull());
    expect(saved).toBeUndefined();
    expect(
      (within(form).getByLabelText("Nombre de la tarea") as HTMLInputElement)
        .value,
    ).toBe("Informe conservado");
    expect(
      (within(form).getByLabelText(/Instrucciones/) as HTMLTextAreaElement)
        .value,
    ).toBe("Investigar novedades");
    fireEvent.click(
      within(form).getByRole("button", { name: "Guardar y ejecutar" }),
    );
    await waitFor(() =>
      expect(saved).toMatchObject({
        name: "Informe conservado",
        instructions: "Investigar novedades",
        agentId: identity,
      }),
    );
  },
);
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
it("loads tasks without visible loading copy and exposes busy state accessibly", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  render(
    <ScheduledWorkspacePanel
      agents={[]}
      selectedAgent="demo"
      onSelectTask={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(screen.queryByText("Cargando tareas…")).toBeNull();
  expect(screen.getByRole("tabpanel").getAttribute("aria-busy")).toBe("true");
  resolve(new Response(JSON.stringify({ tasks: [], capabilities: [] })));
  await screen.findByText("No hay tareas en este estado.");
  expect(screen.getByRole("tabpanel").getAttribute("aria-busy")).toBe("false");
});
it("separates schedules from finished reports and hides manual execution while running or paused", async () => {
  const tasks = [
    { id: "active", name: "Activa con informe", status: "active" },
    { id: "paused", name: "Pausada con informe", status: "paused" },
    { id: "empty", name: "Sin informes", status: "active" },
  ].map((task) => ({
    ...task,
    agentName: "Flow",
    agentId: "flow",
    repeat: "daily",
    time: "10:00",
    timeZone: "America/Lima",
    nextRunAt: "2030-01-01T10:00:00Z",
  })) as ServerTask[];
  const running = {
    id: "running",
    status: "running",
    trigger: "initial",
    taskVersion: 1,
    createdAt: "2026-11-12T10:00:00Z",
  };
  const partial = { ...running, id: "partial", status: "partial" };
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("/runs")
              ? {
                  runs: url.includes("/active/")
                    ? [running, partial]
                    : url.includes("/paused/")
                      ? [partial]
                      : [],
                }
              : { tasks, capabilities: [] },
          ),
        ),
    ),
  );
  function Panel() {
    const [selected, setSelected] = useState<ServerTask | null>(tasks[0]);
    return (
      <ScheduledWorkspacePanel
        agents={[]}
        selectedAgent="flow"
        selectedTask={selected}
        onSelectTask={setSelected}
        onSelectReport={vi.fn()}
        onClose={vi.fn()}
      />
    );
  }
  render(<Panel />);
  await screen.findByRole("button", { name: /Activa con informe Diario/ });
  expect(document.querySelector(".completed-task-reports")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Abrir ejecución running" }),
  ).toBeNull();
  expect(
    screen
      .getByRole("button", { name: /Activa con informe Diario/ })
      .getAttribute("data-tooltip-disabled"),
  ).toBe("true");
  expect(
    screen
      .getByRole("button", { name: "Editar Activa con informe" })
      .getAttribute("data-tooltip"),
  ).toBe("Editar");
  expect(
    screen
      .getByRole("button", { name: "Pausar Activa con informe" })
      .getAttribute("data-tooltip"),
  ).toBe("Pausar");
  const remove = screen.getByRole("button", {
    name: "Eliminar Activa con informe",
  });
  expect(remove.getAttribute("data-tooltip")).toBe("Eliminar");
  expect(remove.classList.contains("scheduled-delete")).toBe(true);
  expect(
    screen.queryByRole("button", { name: /Descargar informe/ }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Ejecutar ahora" })).toBeNull();
  expect(screen.queryByText("Flow")).toBeNull();
  expect(screen.queryByText(/Programación habilitada/)).toBeNull();
  expect(document.querySelectorAll(".scheduled-task-open > span")).toHaveLength(
    2,
  );
  expect(screen.queryByText("Pausada con informe")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "En pausa" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /^Pausada con informe Diario/ }),
  );
  expect(
    screen.getByRole("button", { name: "Reanudar Pausada con informe" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Editar Pausada con informe" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Eliminar Pausada con informe" }),
  ).toBeNull();
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Estado de ejecución" }),
    ).toBeNull(),
  );
  expect(screen.queryByRole("button", { name: "Ejecutar ahora" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Descargar informe/ }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Completadas" }));
  expect(
    await screen.findAllByRole("button", { name: "Descargar informe partial" }),
  ).toHaveLength(2);
  expect(screen.getByText("Activa con informe")).toBeTruthy();
  expect(screen.queryByText("Sin informes")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Abrir ejecución running" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Ejecutar ahora" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Pausar |Reanudar |Editar / }),
  ).toBeNull();
  expect(screen.queryByText(/Próxima:/)).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Activa con informe Flow/ }),
  ).toBeNull();
  const cards = screen.getByRole("tabpanel").querySelectorAll("article");
  expect(cards).toHaveLength(2);
  for (const card of cards) {
    expect(card.querySelector("article")).toBeNull();
    expect(
      within(card)
        .getByRole("button", { name: "Abrir ejecución partial" })
        .getAttribute("data-tooltip"),
    ).toBe("Ver");
  }
});
it("opens all Agent Flows, warns only on save and preserves input while choosing a supported flow", async () => {
  const selected = vi.fn();
  let saved: Record<string, unknown> | undefined;
  const request = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "PUT") {
      saved = { ...JSON.parse(options.body as string), version: 1 };
      return new Response(JSON.stringify(saved));
    }
    return new Response(
      JSON.stringify({
        tasks: saved ? [saved] : [],
        capabilities: [{ agentId: "b", reportSchemaVersion: "1.0" }],
      }),
    );
  });
  vi.stubGlobal("fetch", request);
  render(
    <ScheduledWorkspacePanel
      agents={[
        { id: "a", name: "Flow A" },
        { id: "b", name: "Flow B" },
      ]}
      selectedAgent="a"
      createRequest={1}
      onClose={() => {}}
      onSelectTask={selected}
    />,
  );
  const dialog = await screen.findByRole("region", { name: "Nueva tarea" });
  expect(document.querySelector("dialog[open]")).toBeNull();
  expect(within(dialog).queryByRole("alert")).toBeNull();
  expect(within(dialog).getByRole("option", { name: "Flow A" })).toBeTruthy();
  expect(within(dialog).getByRole("option", { name: "Flow B" })).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText("Nombre de la tarea"), {
    target: { value: "Informe conservado" },
  });
  fireEvent.change(within(dialog).getByLabelText(/Instrucciones/), {
    target: { value: "Investigar novedades" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Guardar y ejecutar" }),
  );
  const warning = await within(dialog).findByRole("alert");
  expect(warning.textContent).toContain("no tiene habilitada");
  expect(warning.classList.contains("config-feedback-warning")).toBe(true);
  expect(saved).toBeUndefined();
  await waitFor(
    () =>
      expect(
        request.mock.calls.filter(
          ([, options]) => !options?.method || options.method === "GET",
        ).length,
      ).toBeGreaterThan(1),
    { timeout: 5000 },
  );
  expect(within(dialog).getByRole("alert").textContent).toContain(
    "no tiene habilitada",
  );
  fireEvent.change(within(dialog).getByLabelText("Agent Flow"), {
    target: { value: "b" },
  });
  expect(within(dialog).queryByRole("alert")).toBeNull();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Guardar y ejecutar" }),
  );
  await waitFor(() => expect(selected).toHaveBeenCalledOnce());
  expect(saved).toMatchObject({
    agentId: "b",
    name: "Informe conservado",
    instructions: "Investigar novedades",
  });
}, 10000);

it("cancels the inline draft from the header request without closing Tasks or saving", async () => {
  const request = vi.fn(
    async () => new Response(JSON.stringify({ tasks: [], capabilities: [] })),
  );
  vi.stubGlobal("fetch", request);
  const editing = vi.fn(),
    close = vi.fn();
  const props = {
    agents: [{ id: "demo", name: "Demo" }],
    selectedAgent: "demo",
    createRequest: 1,
    onSelectTask: vi.fn(),
    onClose: close,
    onEditingChange: editing,
  };
  const view = render(<ScheduledWorkspacePanel {...props} />);
  const form = await screen.findByRole("region", { name: "Nueva tarea" });
  fireEvent.change(within(form).getByLabelText("Nombre de la tarea"), {
    target: { value: "Borrador" },
  });
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(editing).toHaveBeenLastCalledWith("Nueva tarea");
  view.rerender(<ScheduledWorkspacePanel {...props} closeRequest={1} />);
  await screen.findByRole("tablist", { name: "Estado de tareas" });
  expect(editing).toHaveBeenLastCalledWith(null);
  expect(close).not.toHaveBeenCalled();
  expect(request.mock.calls).toHaveLength(1);
});

it("confirms report removal, preserves Undo after the last card disappears and restores without research", async () => {
  const task = {
    id: "report-task",
    name: "Informe",
    agentName: "Flow",
    agentId: "flow",
    status: "paused",
    timeZone: "America/Lima",
  } as ServerTask;
  const run = {
    id: "report-run",
    taskId: task.id,
    status: "partial",
    createdAt: "2026-11-12T10:00:00Z",
    taskVersion: 1,
    trigger: "initial",
  };
  let deleted = false;
  const request = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "DELETE") {
      deleted = true;
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/restore")) {
      deleted = false;
      return new Response(null, { status: 204 });
    }
    return new Response(
      JSON.stringify(
        url.endsWith("/runs")
          ? { runs: deleted ? [] : [run] }
          : { tasks: [task], capabilities: [] },
      ),
    );
  });
  vi.stubGlobal("fetch", request);
  const removed = vi.fn();
  render(
    <ScheduledWorkspacePanel
      agents={[]}
      selectedAgent="flow"
      onSelectTask={vi.fn()}
      onSelectReport={vi.fn()}
      onRemoveReport={removed}
      onClose={vi.fn()}
    />,
  );
  await screen.findByText("No hay tareas en este estado.");
  fireEvent.click(screen.getByRole("tab", { name: "Completadas" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Eliminar informe report-run" }),
  );
  let dialog = screen.getByRole("dialog", { name: "Eliminar informe" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(deleted).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "Eliminar informe report-run" }),
  );
  dialog = screen.getByRole("dialog", { name: "Eliminar informe" });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Eliminar informe" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Abrir ejecución report-run" }),
    ).toBeNull(),
  );
  await waitFor(() => expect(removed).toHaveBeenCalledWith(task.id, run.id));
  const undo = screen.getByRole("button", { name: "Deshacer" });
  expect(undo.closest("[role=status]")).toBeTruthy();
  expect(screen.getByText("Todavía no hay informes terminados.")).toBeTruthy();
  fireEvent.click(undo);
  await screen.findByRole("button", { name: "Abrir ejecución report-run" });
  expect(screen.queryByRole("button", { name: "Deshacer" })).toBeNull();
  const mutations = request.mock.calls.filter(
    ([, options]) => options?.method && options.method !== "GET",
  );
  expect(mutations.map(([url, options]) => [url, options?.method])).toEqual([
    ["/api/desk/scheduled-tasks/report-task/runs/report-run/report", "DELETE"],
    [
      "/api/desk/scheduled-tasks/report-task/runs/report-run/report/restore",
      "POST",
    ],
  ]);
  fireEvent.click(
    screen.getByRole("button", { name: "Eliminar informe report-run" }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Eliminar informe" })).getByRole(
      "button",
      { name: "Eliminar informe" },
    ),
  );
  await screen.findByRole("button", { name: "Deshacer" });
  act(() => window.dispatchEvent(new Event("agent-desk-session-changed")));
  expect(screen.queryByRole("button", { name: "Deshacer" })).toBeNull();
});

it("retains the report and shows a deletion failure inside its confirmation", async () => {
  const task = {
    id: "task",
    name: "Informe",
    agentName: "Flow",
    status: "paused",
    timeZone: "America/Lima",
  };
  const run = {
    id: "run",
    status: "completed",
    createdAt: "2026-11-12T10:00:00Z",
    taskVersion: 1,
    trigger: "initial",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) =>
      options?.method === "DELETE"
        ? new Response(
            JSON.stringify({ detail: "No se pudo eliminar el informe." }),
            { status: 409 },
          )
        : new Response(
            JSON.stringify(
              url.endsWith("/runs")
                ? { runs: [run] }
                : { tasks: [task], capabilities: [] },
            ),
          ),
    ),
  );
  const removed = vi.fn();
  render(
    <ScheduledWorkspacePanel
      agents={[]}
      selectedAgent="demo"
      onSelectTask={vi.fn()}
      onSelectReport={vi.fn()}
      onRemoveReport={removed}
      onClose={vi.fn()}
    />,
  );
  await screen.findByText("No hay tareas en este estado.");
  fireEvent.click(screen.getByRole("tab", { name: "Completadas" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Eliminar informe run" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Eliminar informe" });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Eliminar informe" }),
  );
  expect((await within(dialog).findByRole("alert")).textContent).toContain(
    "No se pudo eliminar",
  );
  expect(
    screen.getByRole("button", { name: "Abrir ejecución run" }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Deshacer" })).toBeNull();
  expect(removed).not.toHaveBeenCalled();
});
