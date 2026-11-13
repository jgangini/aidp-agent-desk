import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SavedReport, TaskReportWorkspace } from "./TaskReportWorkspace";
import type { TaskRun, ServerTask } from "./scheduledApi";
const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../contracts/fixtures/reports/government.json"),
    "utf8",
  ),
);
function run(response: unknown): TaskRun {
  return {
    id: fixture.report.task_run_id,
    taskId: fixture.report.task_id,
    taskVersion: 1,
    status: "completed",
    trigger: "initial",
    createdAt: "2026-11-11T15:00:00Z",
    response,
  };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
function nextRefresh() {
  const scheduled: Array<() => void> = [];
  const timeout = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(
    (callback, delay, ...args) => {
      if (delay === 2500) {
        scheduled.push(callback as () => void);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return timeout(callback, delay, ...args);
    },
  );
  return async () => {
    await act(async () => {
      scheduled.shift()!();
    });
  };
}
function workspace(nonce = 1, editTemplate = false) {
  return (
    <TaskReportWorkspace
      task={
        {
          id: fixture.report.task_id,
          name: "Informe",
          timeZone: "America/Lima",
        } as ServerTask
      }
      onClose={vi.fn()}
      requestedRun={{ id: fixture.report.task_run_id, nonce, editTemplate }}
    />
  );
}
it("keeps the same A2UI nodes, media and expanded sources during equivalent authorized refreshes", async () => {
  const value = structuredClone(fixture);
  value.references[0].title = value.references[0].evidence_id;
  value.references[0].media = [
    {
      kind: "image",
      delivery: "direct",
      role: "attachment",
      url: "https://example.com/evidence.jpg",
    },
  ];
  const refresh = nextRefresh();
  const request = vi.fn(async () => new Response(JSON.stringify(run(value))));
  vi.stubGlobal("fetch", request);
  const view = render(workspace());
  await screen.findByRole("heading", { name: "Resumen" });
  const section = view.container.querySelector(".report-section");
  const sources = view.container.querySelector(
    ".report-sources",
  ) as HTMLDetailsElement;
  fireEvent.click(sources.querySelector("summary")!);
  const image = view.container.querySelector("img");
  expect(sources.open).toBe(true);
  await refresh();
  expect(request).toHaveBeenCalledTimes(2);
  expect(view.container.querySelector(".report-section")).toBe(section);
  expect(view.container.querySelector("img")).toBe(image);
  expect(sources.open).toBe(true);
  expect(screen.queryByText(value.references[0].evidence_id)).toBeNull();
  expect(sources.textContent).toContain("[1] example.com");
});
it.each([403, 404, 409])(
  "preserves a report on temporary failures but clears it on denial %s",
  async (status) => {
    const refresh = nextRefresh();
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(run(fixture))))
      .mockRejectedValueOnce(new TypeError("Red temporal"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Sin acceso" }), { status }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(run(fixture))));
    vi.stubGlobal("fetch", request);
    const view = render(workspace());
    await screen.findByRole("heading", { name: "Resumen" });
    const report = view.container.querySelector(".saved-report");
    await refresh();
    expect(view.container.querySelector(".saved-report")).toBe(report);
    expect(screen.getByRole("alert").textContent).toContain("Red temporal");
    await refresh();
    expect(view.container.querySelector(".saved-report")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Sin acceso");
    view.rerender(workspace(2));
    await screen.findByRole("heading", { name: "Resumen" });
    expect(request).toHaveBeenCalledTimes(4);
  },
);
it("retires the cached report immediately when account identity changes", async () => {
  nextRefresh();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(run(fixture)))),
  );
  const view = render(workspace());
  await screen.findByRole("heading", { name: "Resumen" });
  act(() => window.dispatchEvent(new Event("agent-desk-session-changed")));
  expect(view.container.querySelector(".saved-report")).toBeNull();
});
it("keeps the A2UI surface stable when equivalent report objects are passed again", async () => {
  const view = render(
    <SavedReport run={run(fixture)} timeZone="America/Lima" />,
  );
  await screen.findByRole("heading", { name: "Resumen" });
  const section = view.container.querySelector(".report-section");
  const sources = view.container.querySelector(
    ".report-sources",
  ) as HTMLDetailsElement;
  fireEvent.click(sources.querySelector("summary")!);
  view.rerender(
    <SavedReport run={run(structuredClone(fixture))} timeZone="America/Lima" />,
  );
  await waitFor(() =>
    expect(view.container.querySelector(".report-section")).toBe(section),
  );
  expect(sources.isConnected && sources.open).toBe(true);
});
it("reads the same run after recovery elsewhere without offering a second recovery action", async () => {
  const refresh = nextRefresh();
  let recovered = false;
  const pending = {
    ...run(undefined),
    status: "interrupted",
    recoverable: true,
  };
  const request = vi.fn(async (_url: string, _options?: RequestInit) => {
    return new Response(JSON.stringify(recovered ? run(fixture) : pending));
  });
  vi.stubGlobal("fetch", request);
  render(workspace());
  await screen.findByRole("heading", { name: "Actividad de la tarea" });
  expect(screen.queryByRole("button", { name: /Recuperar/ })).toBeNull();
  recovered = true;
  await refresh();
  await screen.findByRole("heading", { name: "Resumen" });
  expect(
    request.mock.calls.every(([, options]) => options?.method === "GET"),
  ).toBe(true);
});
it("updates the selected run activity in place and keeps it out of a finished report", async () => {
  const refresh = nextRefresh();
  const current: TaskRun = {
    ...run(undefined),
    status: "running",
    activity: [
      {
        id: "facebook",
        source: "Facebook",
        text: "Revisando publicaciones.",
        state: "running",
      },
      {
        id: "web",
        source: "Web",
        text: "Fuentes recuperadas.",
        state: "completed",
      },
    ],
  };
  let finished = false;
  const request = vi.fn(
    async () => new Response(JSON.stringify(finished ? run(fixture) : current)),
  );
  vi.stubGlobal("fetch", request);
  render(workspace());
  const activity = await screen.findByRole("list", {
    name: "Actividad del agente",
  });
  const first = activity.querySelector("li");
  current.activity![0] = {
    ...current.activity![0],
    text: "Publicaciones revisadas.",
    state: "completed",
  };
  await refresh();
  expect(activity.querySelector("li")).toBe(first);
  expect(first?.getAttribute("data-activity-state")).toBe("completed");
  expect(screen.getByText("Publicaciones revisadas.")).toBeTruthy();
  expect(screen.queryByText("Revisando publicaciones.")).toBeNull();
  finished = true;
  await refresh();
  await screen.findByRole("heading", { name: "Resumen" });
  expect(
    screen.queryByRole("list", { name: "Actividad del agente" }),
  ).toBeNull();
  expect(request.mock.calls).toHaveLength(3);
});
it("links page media instead of treating an HTML page as an embeddable image", async () => {
  const value = structuredClone(fixture);
  value.references[0].media = [
    {
      kind: "image",
      delivery: "page",
      role: "attachment",
      url: "https://example.com/media-page",
    },
  ];
  const view = render(<SavedReport run={run(value)} timeZone="America/Lima" />);
  await screen.findByRole("link", { name: "Abrir imagen en la fuente" });
  expect(view.container.querySelector("img")).toBeNull();
});
it("keeps the media frame and exposes the source when a remote image fails", async () => {
  const value = structuredClone(fixture);
  value.references[0].media = [
    {
      kind: "image",
      delivery: "direct",
      role: "attachment",
      url: "https://example.com/evidence.jpg",
    },
  ];
  const view = render(<SavedReport run={run(value)} timeZone="America/Lima" />);
  const image = view.container.querySelector("img")!;
  const frame = image.parentElement;
  fireEvent.error(image);
  expect(
    await screen.findByRole("link", {
      name: "Imagen no disponible. Abrir fuente",
    }),
  ).toBeTruthy();
  expect(view.container.querySelector(".report-media-frame")).toBe(frame);
});
it("plots only known retained counts and leaves insufficient sentiment uncharted", async () => {
  const market = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "../contracts/fixtures/reports/market-producer-response.json",
      ),
      "utf8",
    ),
  );
  const value = {
    ...run(market),
    id: market.report.task_run_id,
    taskId: market.report.task_id,
  };
  const view = render(<SavedReport run={value} timeZone="America/Lima" />);
  await screen.findByText("Recuento conservado: publicaciones");
  expect(view.container.querySelectorAll(".report-chart-track").length).toBe(2);
  expect(screen.queryByText("Recuento conservado: comentarios")).toBeNull();
  expect(view.container.querySelector(".report-sentiment-chart")).toBeNull();
});
it.each(["**facebook:** partial.", "**facebook**: partial."])(
  "omits operational diagnostics (%s) from the executive report without changing the saved evidence",
  async (heading) => {
    const market = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          "../contracts/fixtures/reports/market-producer-response.json",
        ),
        "utf8",
      ),
    );
    const section = market.report.sections.find(
      (item: { section_id: string }) => item.section_id === "metrics",
    );
    const platform = market.report.extensions[
      "market.platform_metrics"
    ].platforms.find((item: { source: string }) => item.source === "facebook");
    platform.retrieval_status = "partial";
    section.markdown = `${heading}\n\nCobertura partial descrita por el agente.\n\n- Conservar limitación.`;
    const original = JSON.stringify(market);
    const view = render(
      <SavedReport
        run={{
          ...run(market),
          id: market.report.task_run_id,
          taskId: market.report.task_id,
        }}
        timeZone="America/Lima"
      />,
    );
    await screen.findByText("Recuento conservado: publicaciones");
    expect(view.container.querySelector(".report-analysis-detail")).toBeNull();
    expect(screen.queryByText("Detalle del agente")).toBeNull();
    expect(screen.queryByText("Intentos de consulta")).toBeNull();
    expect(view.container.querySelector(".report-metrics-table")).toBeNull();
    expect(
      screen.queryByText("Cobertura partial descrita por el agente."),
    ).toBeNull();
    expect(platform.retrieval_status).toBe("partial");
    expect(JSON.stringify(market)).toBe(original);
  },
);
it("places an analytical block by its template even when optional Markdown is absent", async () => {
  const market = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "../contracts/fixtures/reports/market-producer-response.json",
      ),
      "utf8",
    ),
  );
  market.report.sections = market.report.sections.filter(
    (section: { section_id: string }) => section.section_id !== "metrics",
  );
  const definition = market.report.template.sections.find(
    (section: { section_id: string }) => section.section_id === "metrics",
  );
  definition.title = "Cobertura elegida";
  market.report.template.sections = [
    definition,
    ...market.report.template.sections.filter(
      (section: { section_id: string }) => section.section_id !== "metrics",
    ),
  ];
  const view = render(
    <SavedReport
      run={{
        ...run(market),
        id: market.report.task_run_id,
        taskId: market.report.task_id,
      }}
      timeZone="America/Lima"
    />,
  );
  await screen.findByText("Recuento conservado: publicaciones");
  expect(view.container.querySelector(".report-sections h2")?.textContent).toBe(
    "Cobertura elegida",
  );
  expect(
    view.container.querySelectorAll(".report-coverage-charts"),
  ).toHaveLength(1);
});
it("renders a government report through the A2UI catalog without social metrics", async () => {
  render(<SavedReport run={run(fixture)} timeZone="America/Lima" />);
  await waitFor(() =>
    expect(
      screen.getByRole("heading", {
        name: fixture.report.template.sections[0].title,
      }),
    ).toBeTruthy(),
  );
  expect(screen.queryByText("Cobertura de la investigación")).toBeNull();
  expect(screen.queryByRole("button", { name: "Descargar .md" })).toBeNull();
});
it("preserves Markdown when report references do not match", () => {
  render(
    <SavedReport
      run={run({
        ...fixture,
        report: { ...fixture.report, task_run_id: "another-run" },
      })}
      timeZone="America/Lima"
    />,
  );
  expect(screen.getByText(fixture.markdown)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Markdown");
});
it("does not repeat exact limitation lines already present in a report section", async () => {
  const value = structuredClone(fixture);
  value.report.limitations = ["Límite conservado", "Otra limitación"];
  value.report.sections[0].markdown += "\n\n- Límite conservado";
  render(<SavedReport run={run(value)} timeZone="America/Lima" />);
  await screen.findByRole("heading", { name: "Resumen" });
  expect(screen.getAllByText("Límite conservado")).toHaveLength(1);
  expect(screen.getByText("Otra limitación")).toBeTruthy();
});

it("uses the run's historical column layout and keeps generic reports without layout unchanged", async () => {
  const value = run(fixture);
  value.presentation = {
    schema_version: "1.0",
    rows: [
      {
        section_ids: fixture.report.template.sections.map(
          (s: { section_id: string }) => s.section_id,
        ),
      },
    ],
  };
  const view = render(<SavedReport run={value} timeZone="America/Lima" />);
  await screen.findByRole("heading", { name: "Resumen" });
  expect(
    view.container.querySelectorAll('.report-layout-row[data-columns="2"]'),
  ).toHaveLength(1);
  expect(
    screen.getByRole("heading", { name: "Actuaciones documentadas" }),
  ).toBeTruthy();
  view.rerender(<SavedReport run={run(fixture)} timeZone="America/Lima" />);
  await screen.findByRole("heading", { name: "Resumen" });
  expect(view.container.querySelector(".report-layout")).toBeNull();
});

it("preserves optional analytics outside a custom column template", async () => {
  const market = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "../contracts/fixtures/reports/market-producer-response.json",
      ),
      "utf8",
    ),
  );
  market.report.sections = market.report.sections.filter(
    (s: { section_id: string }) =>
      !["metrics", "sentiment"].includes(s.section_id),
  );
  market.report.template.sections = market.report.template.sections.filter(
    (s: { section_id: string }) =>
      !["metrics", "sentiment"].includes(s.section_id),
  );
  const value = {
    ...run(market),
    id: market.report.task_run_id,
    taskId: market.report.task_id,
    presentation: {
      schema_version: "1.0" as const,
      rows: market.report.template.sections.map(
        (s: { section_id: string }) => ({ section_ids: [s.section_id] }),
      ),
    },
  };
  const view = render(<SavedReport run={value} timeZone="America/Lima" />);
  await screen.findByText("Recuento conservado: publicaciones");
  expect(
    view.container.querySelectorAll(".report-coverage-charts"),
  ).toHaveLength(1);
  expect(
    screen.getByText("Evidencia insuficiente para clasificar sentimiento."),
  ).toBeTruthy();
});

it("replaces the report body with the inline editor and keeps the home wordmark", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("/template")
              ? { template: fixture.report.template, version: 1 }
              : run(fixture),
          ),
        ),
    ),
  );
  const view = render(workspace());
  await screen.findByRole("heading", { name: "Resumen" });
  expect(screen.queryByRole("button", { name: "Ajustar formato" })).toBeNull();
  view.rerender(workspace(2, true));
  await screen.findByRole("heading", { name: "Editar plantilla" });
  expect(view.container.querySelector(".task-report-body")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(await screen.findByRole("button", { name: "Guardar" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Ir al inicio" })).toBeTruthy();
});
