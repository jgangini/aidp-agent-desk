import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ComputeControl } from "./ComputeControl";
import { AgentFlowPanel } from "./AgentConfigPanels";
import type {
  AgentCompute,
  ComputeContext,
  ComputeStatus,
} from "./computeLifecycle";
import type { ConfigurationFieldState } from "./ConfigurationField";
import type { DiscoveryOptions, DiscoverySelection } from "./discovery";
import { createRef } from "react";

const context: ComputeContext = {
  compartment_id: "compartment",
  instance_id: "instance",
  workspace_id: "workspace",
  agent_id: "agent",
};
const revision = "a".repeat(64);
const stopped: AgentCompute = {
  id: "compute",
  name: "Mercado compartido",
  state: "STOPPED",
  can_start: true,
  operation: "idle",
  message: "",
  confirmation: revision,
  targets: [
    { agent_id: "agent", name: "Mercado", surface: "PROD" },
    { agent_id: "agent", name: "Mercado TEST", surface: "TEST" },
  ],
};
const result = (compute: Partial<AgentCompute> = {}): ComputeStatus => ({
  computes: [{ ...stopped, ...compute }],
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const startCalls = (request: ReturnType<typeof vi.fn>) =>
  request.mock.calls.filter(([url]) => String(url).endsWith("/compute/start"));
function pollQueue() {
  const callbacks: Array<() => void> = [];
  const timeout = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(
    (callback, delay, ...args) => {
      if (delay === 5000) {
        callbacks.push(callback as () => void);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return timeout(callback, delay, ...args);
    },
  );
  return async () => {
    const callback = callbacks.shift();
    expect(callback).toBeTypeOf("function");
    await act(async () => callback!());
  };
}
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
  vi.restoreAllMocks();
});

it.each(["Cancelar", "Cerrar confirmación de inicio"])(
  "shows the exact compute, shared targets and cost before %s without starting",
  async (action) => {
    const request = vi.fn(async () => response(result()));
    vi.stubGlobal("fetch", request);
    render(<ComputeControl context={context} agentName="Mercado" />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Iniciar compute Mercado compartido",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Iniciar compute" });
    expect(within(dialog).getByText("Mercado compartido")).toBeTruthy();
    expect(within(dialog).getByText("Mercado")).toBeTruthy();
    expect(within(dialog).getByText("Mercado TEST")).toBeTruthy();
    expect(within(dialog).getByText("PROD")).toBeTruthy();
    expect(within(dialog).getByText("TEST")).toBeTruthy();
    expect(
      within(dialog).getByText(/puede generar costes en OCI/),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: action }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(startCalls(request)).toHaveLength(0);
  },
);

it.each([
  { state: "ACTIVE" },
  { state: "UNKNOWN" },
  { state: "STARTING" },
  { can_start: false },
  { operation: "uncertain" as const },
  { operation: "starting" as const },
])("does not offer start for %j", async (compute) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(result(compute))),
  );
  render(<ComputeControl context={context} agentName="Mercado" />);
  await waitFor(() =>
    expect(screen.queryByText("Consultando compute…")).toBeNull(),
  );
  expect(screen.queryByRole("button", { name: /Iniciar/ })).toBeNull();
});

it("distinguishes a reading error from STOPPED and retries status only", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("Lectura no disponible"))
    .mockResolvedValueOnce(response(result()));
  vi.stubGlobal("fetch", request);
  render(<ComputeControl context={context} agentName="Mercado" />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Lectura no disponible",
  );
  expect(screen.queryByText("Detenido")).toBeNull();
  expect(screen.queryByRole("button", { name: /Iniciar/ })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Consultar compute de Mercado" }),
  );
  await screen.findByRole("button", {
    name: "Iniciar compute Mercado compartido",
  });
  expect(startCalls(request)).toHaveLength(0);
});

it("sends one confirmed start with its original snapshot revision and polls until ACTIVE", async () => {
  const nextPoll = pollQueue();
  let complete!: (value: Response) => void;
  let reads = 0;
  const request = vi.fn(async (url: string, _init?: RequestInit) =>
    url.endsWith("/start")
      ? new Promise<Response>((resolve) => {
          complete = resolve;
        })
      : response(
          ++reads === 1
            ? result()
            : result({ state: "ACTIVE", can_start: false }),
        ),
  );
  vi.stubGlobal("fetch", request);
  render(<ComputeControl context={context} agentName="Mercado" />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Iniciar compute Mercado compartido",
    }),
  );
  const confirm = within(screen.getByRole("dialog")).getByRole("button", {
    name: "Iniciar",
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(startCalls(request)).toHaveLength(1);
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  const body = JSON.parse(String(startCalls(request)[0][1].body));
  expect(body).toEqual({
    ...context,
    compute_id: stopped.id,
    compute_name: stopped.name,
    request_id: expect.stringMatching(/^[a-f0-9]{32}$/),
    confirmation: revision,
    confirmed: true,
  });
  expect(
    new Headers(startCalls(request)[0][1].headers).get("X-Agent-Desk"),
  ).toBe("configure");
  await act(async () =>
    complete(
      response(
        result({ state: "STARTING", operation: "starting", can_start: false }),
      ),
    ),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  await nextPoll();
  await screen.findByText("Activo");
  expect(startCalls(request)).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /Iniciar/ })).toBeNull();
});

it("reconciles the selected compute independently before confirming another compute", async () => {
  const nextPoll = pollQueue();
  const first = { ...stopped, targets: [stopped.targets[0]] };
  const second = {
    ...stopped,
    id: "compute-test",
    name: "Compute TEST",
    confirmation: "b".repeat(64),
    targets: [stopped.targets[1]],
  };
  let firstStarted = false;
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/start")) {
      const body = JSON.parse(String(init?.body));
      if (body.compute_id === first.id) {
        firstStarted = true;
        return response({
          computes: [
            {
              ...first,
              state: "STARTING",
              operation: "starting",
              can_start: false,
            },
            second,
          ],
        });
      }
      return response({
        computes: [
          { ...first, state: "ACTIVE", can_start: false },
          { ...second, state: "ACTIVE", can_start: false },
        ],
      });
    }
    return response({
      computes: [
        firstStarted ? { ...first, state: "ACTIVE", can_start: false } : first,
        second,
      ],
    });
  });
  vi.stubGlobal("fetch", request);
  render(<ComputeControl context={context} agentName="Mercado" />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: `Iniciar compute ${first.name}`,
    }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Iniciar" }),
  );
  await screen.findByLabelText(`Compute ${first.name}: Iniciando`);
  expect(startCalls(request)).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: `Iniciar compute ${second.name}` }),
  ).toBeNull();
  await nextPoll();
  const secondStart = await screen.findByRole("button", {
    name: `Iniciar compute ${second.name}`,
  });
  expect(startCalls(request)).toHaveLength(1);
  fireEvent.click(secondStart);
  const popup = screen.getByRole("dialog");
  expect(within(popup).getByText(second.name)).toBeTruthy();
  expect(startCalls(request)).toHaveLength(1);
  fireEvent.click(within(popup).getByRole("button", { name: "Iniciar" }));
  await screen.findByLabelText(`Compute ${second.name}: Activo`);
  const bodies = startCalls(request).map(([, init]) =>
    JSON.parse(String(init.body)),
  );
  expect(bodies.map((body) => body.compute_id)).toEqual([first.id, second.id]);
  expect(bodies.map((body) => body.confirmation)).toEqual([
    revision,
    second.confirmation,
  ]);
  expect(bodies[0].request_id).not.toBe(bodies[1].request_id);
});

it("preserves a real failure message without offering or repeating start for FAILED", async () => {
  const request = vi.fn(async (url: string) =>
    response(
      url.endsWith("/start")
        ? result({
            state: "FAILED",
            can_start: false,
            message: "Cuota OCI insuficiente.",
          })
        : result(),
    ),
  );
  vi.stubGlobal("fetch", request);
  render(<ComputeControl context={context} agentName="Mercado" />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Iniciar compute Mercado compartido",
    }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Iniciar" }),
  );
  await screen.findByText("Cuota OCI insuficiente.");
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /Iniciar/ })).toBeNull(),
  );
  expect(startCalls(request)).toHaveLength(1);
});

it("keeps an uncertain start read-only and stops polling on a reading error", async () => {
  const nextPoll = pollQueue();
  let reads = 0;
  const request = vi.fn(async (url: string) => {
    if (url.endsWith("/start")) throw new TypeError("Conexión interrumpida");
    return ++reads === 1
      ? response(result())
      : response({ detail: "No se pudo consultar OCI" }, 503);
  });
  vi.stubGlobal("fetch", request);
  render(<ComputeControl context={context} agentName="Mercado" />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Iniciar compute Mercado compartido",
    }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Iniciar",
    }),
  );
  await screen.findByText(/sin repetir el inicio/);
  await nextPoll();
  expect((await screen.findByRole("alert")).textContent).toContain(
    "No se pudo consultar OCI",
  );
  expect(screen.queryByRole("button", { name: /Iniciar/ })).toBeNull();
  expect(startCalls(request)).toHaveLength(1);
  expect(reads).toBe(2);
});

it("keeps the popup's original shared-target revision when status changes in the background", async () => {
  let reads = 0;
  const request = vi.fn(async (url: string) => {
    if (url.endsWith("/start"))
      return response(
        { detail: "Los destinos compartidos cambiaron. Confirma de nuevo." },
        409,
      );
    return response(
      ++reads === 1
        ? result()
        : {
            ...result(),
            computes: [
              {
                ...stopped,
                confirmation: "b".repeat(64),
                targets: [
                  ...stopped.targets,
                  { agent_id: "new", name: "Nuevo destino", surface: "PROD" },
                ],
              },
            ],
          },
    );
  });
  vi.stubGlobal("fetch", request);
  render(<ComputeControl context={context} agentName="Mercado" />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Iniciar compute Mercado compartido",
    }),
  );
  const dialog = screen.getByRole("dialog");
  act(() =>
    window.dispatchEvent(
      new CustomEvent("agent-desk-compute-status-changed", {
        detail: { id: "compute", origin: "other-agent" },
      }),
    ),
  );
  await waitFor(() => expect(reads).toBe(2));
  await act(async () => {});
  expect(within(dialog).queryByText("Nuevo destino")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Iniciar" }));
  await screen.findByText(/Los destinos compartidos cambiaron/);
  expect(JSON.parse(String(startCalls(request)[0][1].body)).confirmation).toBe(
    revision,
  );
  expect(startCalls(request)).toHaveLength(1);
});

it.each([409, 422])(
  "requires a fresh popup and UUID after rejection %s and an explicitly ready reread",
  async (rejectedStatus) => {
    const nextPoll = pollQueue();
    let reads = 0;
    let starts = 0;
    const ready = {
      ...result(),
      computes: [
        {
          ...stopped,
          confirmation: "b".repeat(64),
          targets: [
            ...stopped.targets,
            {
              agent_id: "new",
              name: "Nuevo destino",
              surface: "PROD" as const,
            },
          ],
        },
      ],
    };
    const request = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/start"))
        return ++starts === 1
          ? response(
              {
                detail:
                  "Los destinos compartidos cambiaron. Confirma de nuevo.",
              },
              rejectedStatus,
            )
          : response(result({ state: "ACTIVE", can_start: false }));
      return response(++reads === 1 ? result() : ready);
    });
    vi.stubGlobal("fetch", request);
    render(<ComputeControl context={context} agentName="Mercado" />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Iniciar compute Mercado compartido",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Iniciar",
      }),
    );
    await screen.findByText(/Los destinos compartidos cambiaron/);
    expect(starts).toBe(1);
    expect(
      screen.queryByRole("button", { name: /Iniciar compute/ }),
    ).toBeNull();
    await nextPoll();
    const restart = await screen.findByRole("button", {
      name: "Iniciar compute Mercado compartido",
    });
    expect(starts).toBe(1);
    fireEvent.click(restart);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Nuevo destino")).toBeTruthy();
    expect(starts).toBe(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Iniciar" }));
    await screen.findByText("Activo");
    const bodies = startCalls(request).map(([, init]) =>
      JSON.parse(String(init.body)),
    );
    expect(bodies).toHaveLength(2);
    expect(bodies[0].confirmation).toBe(revision);
    expect(bodies[1].confirmation).toBe("b".repeat(64));
    expect(bodies[0].request_id).not.toBe(bodies[1].request_id);
  },
);

it("keeps a rejected attempt blocked when the reread reports another pending operation", async () => {
  const nextPoll = pollQueue();
  let reads = 0;
  const request = vi.fn(async (url: string) =>
    url.endsWith("/start")
      ? response({ detail: "Hay un inicio pendiente." }, 409)
      : response(
          ++reads === 1
            ? result()
            : result({
                state: "STOPPED",
                operation: "uncertain",
                can_start: false,
              }),
        ),
  );
  vi.stubGlobal("fetch", request);
  render(<ComputeControl context={context} agentName="Mercado" />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Iniciar compute Mercado compartido",
    }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Iniciar" }),
  );
  await screen.findByText(/Hay un inicio pendiente/);
  await nextPoll();
  expect(screen.queryByRole("button", { name: /Iniciar compute/ })).toBeNull();
  expect(startCalls(request)).toHaveLength(1);
});

it.each([502, 503])(
  "does not release an unknown %s start even when a reread appears ready",
  async (status) => {
    const nextPoll = pollQueue();
    const request = vi.fn(async (url: string) =>
      url.endsWith("/start")
        ? response({ detail: "No se conoce el resultado del inicio." }, status)
        : response(result()),
    );
    vi.stubGlobal("fetch", request);
    render(<ComputeControl context={context} agentName="Mercado" />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Iniciar compute Mercado compartido",
      }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Iniciar",
      }),
    );
    await screen.findByText(/No se conoce el resultado/);
    await nextPoll();
    expect(
      screen.queryByRole("button", { name: /Iniciar compute/ }),
    ).toBeNull();
    expect(startCalls(request)).toHaveLength(1);
  },
);

it("bounds automatic waiting to 15 minutes without sending another start", async () => {
  const nextPoll = pollQueue();
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  let reads = 0;
  const request = vi.fn(async (url: string) =>
    response(
      url.endsWith("/start") || ++reads > 1
        ? result({ state: "STARTING", operation: "starting", can_start: false })
        : result(),
    ),
  );
  vi.stubGlobal("fetch", request);
  render(<ComputeControl context={context} agentName="Mercado" />);
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Iniciar compute Mercado compartido",
    }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Iniciar",
    }),
  );
  await screen.findByText("Iniciando");
  clock.mockReturnValue(1000 + 15 * 60_000);
  await nextPoll();
  await screen.findByText(/agotó los 15 minutos/);
  expect(startCalls(request)).toHaveLength(1);
});

it("aborts target reads and ignores delayed results after a workspace change", async () => {
  let complete!: (value: Response) => void;
  const request = vi.fn(async (_url: string, init?: RequestInit) =>
    JSON.parse(String(init?.body)).workspace_id === "workspace"
      ? new Promise<Response>((resolve) => {
          complete = resolve;
        })
      : response(
          result({ name: "Otro compute", state: "ACTIVE", can_start: false }),
        ),
  );
  vi.stubGlobal("fetch", request);
  const view = render(<ComputeControl context={context} agentName="Mercado" />);
  view.rerender(
    <ComputeControl
      context={{ ...context, workspace_id: "other" }}
      agentName="Mercado"
    />,
  );
  await screen.findByText("Activo");
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () => complete(response(result())));
  expect(screen.queryByText("Detenido")).toBeNull();
  expect(screen.queryByRole("button", { name: /Iniciar/ })).toBeNull();
  expect(startCalls(request)).toHaveLength(0);
  view.unmount();
  expect(request.mock.calls[1][1]?.signal?.aborted).toBe(true);
});

it("fails closed on a malformed status instead of enabling start", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      response({ ...result(), computes: [{ ...stopped, can_start: "true" }] }),
    ),
  );
  render(<ComputeControl context={context} agentName="Mercado" />);
  await screen.findByText("La respuesta del compute no es válida.");
  expect(screen.queryByRole("button", { name: /Iniciar/ })).toBeNull();
});

it("mounts compute status only for the active, complete and loaded Agent Flow selection", async () => {
  const request = vi.fn(async () =>
    response(result({ state: "ACTIVE", can_start: false })),
  );
  vi.stubGlobal("fetch", request);
  const discovery = {
    options: {
      instances: [],
      workspaces: [],
      agents: [
        {
          id: "agent",
          name: "Mercado",
          available: true,
          description: "Publicado",
        },
      ],
    } as unknown as DiscoveryOptions,
    selection: { ...context, agent_ids: [] } as unknown as DiscoverySelection,
    loading: false,
    stage: "agents",
    error: "",
  };
  const props = {
    fieldId: "flow",
    discovery,
    busy: false,
    agentsRef: createRef<HTMLFieldSetElement>(),
    onToggle: vi.fn(),
    fieldState: {
      selection: discovery.selection,
      errors: {},
      fieldId: "flow",
      step: 1,
      disabled: false,
      loading: false,
      stage: "agents",
      onChange: vi.fn(),
      onEmpty: vi.fn(),
    } satisfies ConfigurationFieldState,
  };
  const view = render(<AgentFlowPanel {...props} active={false} />);
  expect(request).not.toHaveBeenCalled();
  view.rerender(
    <AgentFlowPanel
      {...props}
      active={true}
      discovery={{ ...discovery, loading: true }}
    />,
  );
  expect(request).not.toHaveBeenCalled();
  view.rerender(<AgentFlowPanel {...props} active={true} />);
  await screen.findByText("Activo");
  expect(screen.getByText("Publicado")).toBeTruthy();
  expect(request).toHaveBeenCalledOnce();
});
