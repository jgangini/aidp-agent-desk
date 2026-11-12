import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { IdentityContext } from "../../shared/identity";
import { Desk } from "./Desk";

const actions = vi.hoisted(() => ({ newConversation: vi.fn() }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

vi.mock("./useSwarm", () => ({
  useSwarm: () => ({
    snapshot: {
      findings: [{ id: "finding" }],
      conversations: [],
      playing: false,
    },
    act: vi.fn(),
    history: [],
    newConversation: actions.newConversation,
    selectConversation: vi.fn(),
    deleteConversation: vi.fn(),
    selectedConversation: "conversation",
    draft: "Borrador conservado",
    setDraft: vi.fn(),
    setTitle: vi.fn(),
    renameConversation: vi.fn(),
    setAgent: vi.fn(),
  }),
}));
vi.mock("./profiles", () => ({
  useProfiles: () => ({
    selected: "demo",
    profiles: [],
    setSelected: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("./useRemoteAgent", () => ({ useRemoteAgent: () => ({}) }));
vi.mock("./Results", () => ({
  Results: () => (
    <div data-testid="preserved-results">Resultado conservado</div>
  ),
}));
vi.mock("./Brain", () => ({
  Brain: () => <div data-testid="preserved-brain">Red conservada</div>,
}));
vi.mock("./Chat", () => ({
  Chat: ({
    onUsers,
    initialDraft,
    onScheduled,
    scheduledOpen,
    configuration,
    onConfigure,
  }: {
    onUsers: () => void;
    initialDraft: string;
    onScheduled: () => void;
    scheduledOpen: boolean;
    configuration: ReactNode;
    onConfigure: () => void;
  }) => (
    <aside className="chat-panel">
      <div className="chat-header">
        <button aria-label="Mi cuenta">Perfil</button>
      </div>
      <button onClick={onUsers}>Abrir usuarios</button>
      {scheduledOpen ? (
        <button onClick={onConfigure}>Cerrar Tareas</button>
      ) : (
        <button onClick={onScheduled}>Tareas</button>
      )}
      {configuration}
      <input aria-label="Borrador" defaultValue={initialDraft} />
    </aside>
  ),
}));
vi.mock("../../shared/Tooltips", () => ({ Tooltips: () => null }));
vi.mock("./ChatResize", () => ({
  useChatResize: () => ({ layoutRef: null, style: {} }),
  ChatResizeHandle: () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});
function tree(admin: boolean) {
  return (
    <IdentityContext.Provider
      value={{
        hosted: true,
        admin,
        authenticated: true,
        leaving: false,
        logout: async () => {},
        openAccount: () => {},
      }}
    >
      <Desk />
    </IdentityContext.Provider>
  );
}

it("opens users in the left workspace and restores the same result, brain and chat nodes on close", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url === "/api/admin/user-management"
              ? { directory_available: true, allow_create: false }
              : [],
          ),
        ),
    ),
  );
  render(tree(true));
  const result = screen.getByTestId("preserved-results");
  const brain = await screen.findByTestId("preserved-brain");
  const draft = screen.getByLabelText("Borrador") as HTMLInputElement;
  fireEvent.change(draft, { target: { value: "Edición sin enviar" } });
  const workspace = result.closest(".workspace")!;
  fireEvent.click(screen.getByRole("button", { name: "Abrir usuarios" }));
  await screen.findByRole("heading", { name: "Usuarios", level: 1 });
  const branding = screen.getByRole("button", { name: "Volver al escritorio" });
  expect(branding.textContent).toBe("Agent Desk");
  expect(branding.closest(".users-heading")).toBeTruthy();
  expect(branding.classList.contains("desk-wordmark")).toBe(true);
  expect(branding.querySelector(".t-gradient-text")?.textContent).toBe("Desk");
  expect(workspace.getAttribute("data-users-open")).toBe("true");
  expect(workspace.contains(result)).toBe(true);
  expect(workspace.contains(brain)).toBe(true);
  expect(document.querySelector(".users-panel")?.closest(".workspace")).toBe(
    workspace,
  );
  expect(
    document
      .querySelector(".chat-panel")
      ?.contains(document.querySelector(".users-panel")),
  ).toBe(false);
  expect(screen.getByLabelText("Borrador")).toBe(draft);
  expect(draft.value).toBe("Edición sin enviar");
  await waitFor(() =>
    expect(
      screen
        .getByRole("region", { name: "Usuarios" })
        .getAttribute("aria-busy"),
    ).toBe("false"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cerrar usuarios" }));
  expect(screen.queryByRole("heading", { name: "Usuarios" })).toBeNull();
  expect(workspace.getAttribute("data-users-open")).toBe("false");
  expect(screen.getByTestId("preserved-results")).toBe(result);
  expect(screen.getByTestId("preserved-brain")).toBe(brain);
  expect(screen.getByLabelText("Borrador")).toBe(draft);
  expect(draft.value).toBe("Edición sin enviar");
  fireEvent.click(screen.getByRole("button", { name: "Abrir usuarios" }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("region", { name: "Usuarios" })
        .getAttribute("aria-busy"),
    ).toBe("false"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Volver al escritorio" }));
  expect(screen.queryByRole("heading", { name: "Usuarios" })).toBeNull();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Mi cuenta" }),
    ),
  );
  expect(screen.getByTestId("preserved-results")).toBe(result);
  expect(screen.getByTestId("preserved-brain")).toBe(brain);
  expect(screen.getByLabelText("Borrador")).toBe(draft);
  expect(draft.value).toBe("Edición sin enviar");
  expect(actions.newConversation).not.toHaveBeenCalled();
});

it("does not open administration for a member even if the callback is invoked", () => {
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  render(tree(false));
  fireEvent.click(screen.getByRole("button", { name: "Abrir usuarios" }));
  expect(screen.queryByRole("region", { name: "Usuarios" })).toBeNull();
  expect(request).not.toHaveBeenCalled();
});

it("opens the latest report with Tareas and preserves the chat when using the home wordmark", async () => {
  const response = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../contracts/fixtures/reports/government.json"),
      "utf8",
    ),
  );
  const task = {
    id: response.report.task_id,
    name: "Informe terminado",
    agentId: "demo",
    agentName: "Demostración local",
    version: 1,
    repeat: "daily",
    startDate: "2030-01-01",
    time: "10:00",
    timeZone: "America/Lima",
    status: "completed",
    createdAt: "2026-11-11T15:00:00Z",
    instructions: "Prueba",
    interval: 1,
    weekDays: [],
    notify: false,
  };
  const run = {
    id: response.report.task_run_id,
    taskId: task.id,
    taskVersion: 1,
    status: "completed",
    trigger: "initial",
    createdAt: task.createdAt,
    response,
  };
  const request = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("/scheduled-tasks")
            ? {
                tasks: [task],
                capabilities: [{ agentId: "demo", reportSchemaVersion: "1.0" }],
              }
            : url.endsWith("/runs")
              ? { runs: [run] }
              : url.includes("/runs/")
                ? run
                : url.endsWith("/user-management")
                  ? { directory_available: true, allow_create: false }
                  : [],
        ),
      ),
  );
  vi.stubGlobal("fetch", request);
  render(tree(true));
  const draft = screen.getByLabelText("Borrador");
  fireEvent.click(screen.getByRole("button", { name: "Abrir usuarios" }));
  await screen.findByRole("region", { name: "Usuarios" });
  fireEvent.click(screen.getByRole("button", { name: "Tareas" }));
  expect(screen.queryByRole("region", { name: "Usuarios" })).toBeNull();
  await screen.findByRole(
    "heading",
    { name: "Actuaciones documentadas" },
    { timeout: 5000 },
  );
  const landing = screen.getByRole("region", { name: task.name });
  expect(landing.querySelector("header")?.textContent).toBe("Agent Desk");
  expect(landing.querySelector(".saved-report")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Completadas" }));
  const row = await screen.findByRole("button", {
    name: `Abrir ejecución ${run.id}`,
  });
  fireEvent.click(screen.getByRole("button", { name: "Abrir usuarios" }));
  await screen.findByRole("region", { name: "Usuarios" });
  fireEvent.click(row);
  expect(screen.queryByRole("region", { name: "Usuarios" })).toBeNull();
  await screen.findByRole("heading", { name: "Actuaciones documentadas" });
  expect(
    screen.queryByRole("button", { name: "Nueva tarea de informe" }),
  ).toBeNull();
  fireEvent.click(
    document.querySelector<HTMLButtonElement>(
      ".task-report-heading .report-home",
    )!,
  );
  expect(document.querySelector(".task-report-workspace")).toBeNull();
  expect(screen.getByLabelText("Borrador")).toBe(draft);
  expect(actions.newConversation).not.toHaveBeenCalled();
  expect(request.mock.calls.every(([url]) => !url.endsWith("/run"))).toBe(true);
});
