import { useState } from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { Chat } from "./features/desk/Chat";
import { SwarmEngine } from "./features/desk/engine";
vi.mock("voice-glow", () => ({
  VoiceBeam: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("./features/desk/Brain", () => ({
  Brain: () => <div aria-label="Red 3D" />,
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => ({
      ok: true,
      json: async () =>
        url === "/api/auth/session"
          ? { mode: "local", user: null }
          : url === "/api/desk/scheduled-tasks"
            ? {
                tasks: [],
                capabilities: [{ agentId: "demo", reportSchemaVersion: "1.0" }],
              }
            : [],
    })),
  );
  Element.prototype.scrollTo = vi.fn();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

it("opens Tareas from a clock left of settings and closes without losing the chat draft", async () => {
  render(<App />);
  await screen.findByRole("button", { name: "Tareas" });
  const scheduled = screen.getByRole("button", {
    name: "Tareas",
  });
  const configure = screen.getByRole("button", {
    name: "Configurar agentes",
  });
  expect(configure.previousElementSibling).toBe(scheduled);
  expect(scheduled.querySelector("svg.lucide-clock")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Mensaje al agente" }), {
    target: { value: "Consulta pendiente" },
  });
  const network = document.querySelector("#network-region");
  const workspace = document.querySelector(".workspace");
  fireEvent.click(scheduled);
  expect(document.querySelector("#network-region")).toBe(network);
  expect(document.querySelector(".workspace")).toBe(workspace);
  expect(document.querySelector(".scheduled-reports")).toBeNull();
  expect(workspace?.getAttribute("data-scheduled")).toBeNull();
  const heading = screen.getByRole("heading", {
    name: "Tareas",
  });
  expect(heading.id).toBe("chat-title");
  const region = screen.getByRole("region", { name: "Tareas" });
  expect(document.activeElement).toBe(region);
  expect(
    screen
      .getByRole("region", { name: "Tareas" })
      .classList.contains("agent-config-inline"),
  ).toBe(true);
  expect(
    screen.queryByRole("textbox", { name: "Mensaje al agente" }),
  ).toBeNull();
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Nueva tarea" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Nueva tarea" }));
  expect(screen.queryByRole("dialog", { name: "Nueva tarea" })).toBeNull();
  expect(screen.getByRole("region", { name: "Nueva tarea" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Nueva tarea" }).id).toBe(
    "chat-title",
  );
  fireEvent.click(screen.getByRole("button", { name: "Volver a Tareas" }));
  expect(screen.getByRole("heading", { name: "Tareas" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Activadas" })).toBeTruthy();
  expect(screen.queryByLabelText("Nombre de la tarea")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Nueva tarea" }));
  fireEvent.keyDown(region, { key: "Escape" });
  expect(screen.getByRole("heading", { name: "Tareas" }).id).toBe("chat-title");
  fireEvent.keyDown(region, { key: "Escape" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Tareas" }),
    ),
  );
  expect(
    (
      screen.getByRole("textbox", {
        name: "Mensaje al agente",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("Consulta pendiente");
  fireEvent.click(screen.getByRole("button", { name: "Tareas" }));
  fireEvent.click(screen.getByRole("button", { name: "Cerrar Tareas" }));
  expect(screen.queryByRole("region", { name: "Tareas" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Configurar agentes" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("heading", { name: "Borrador · Consulta pendiente" }).id,
  ).toBe("chat-title");
  fireEvent.click(screen.getByRole("button", { name: "Configurar agentes" }));
  expect(screen.getByRole("heading", { name: "Configuración" }).id).toBe(
    "chat-title",
  );
});
it("restores the task panel and selected tab after reload and respects explicit close", async () => {
  const first = render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Tareas" }));
  fireEvent.click(screen.getByRole("tab", { name: "Completadas" }));
  first.unmount();
  const restored = render(<App />);
  await screen.findByRole("heading", { name: "Tareas" });
  expect(
    screen
      .getByRole("tab", { name: "Completadas" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    screen.queryByRole("textbox", { name: "Mensaje al agente" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar Tareas" }));
  restored.unmount();
  render(<App />);
  await screen.findByRole("textbox", { name: "Mensaje al agente" });
  expect(screen.queryByRole("region", { name: "Tareas" })).toBeNull();
});

it("keeps Tareas beside a selection saved by the previous version", async () => {
  localStorage.setItem("agent-desk.report-task", "historical-task");
  try {
    render(<App />);
    await screen.findByRole("heading", { name: "Tareas" });
    expect(screen.getByRole("region", { name: "Tareas" })).toBeTruthy();
  } finally {
    localStorage.removeItem("agent-desk.report-task");
  }
});

it("keeps streaming cancellation in the simplified desk without the removed headers or tabs", async () => {
  render(<App />);
  await screen.findByRole("button", { name: "Tareas" });
  expect(screen.getByRole("main")).toBeTruthy();
  expect(
    screen.getByRole("textbox", { name: "Mensaje al agente" }),
  ).toBeTruthy();
  expect(screen.queryByText("Tu agente. Todas sus herramientas.")).toBeNull();
  expect(screen.queryByRole("tab")).toBeNull();
  expect(
    document.querySelector(".app-header,.stage-heading,.brain-caption"),
  ).toBeNull();
  expect(
    screen.queryByText("Simulación local · AIDP pendiente de publicación"),
  ).toBeNull();
  expect(document.querySelector(".aui-footer-spacer")).toBeTruthy();
  expect(
    document.querySelector(".activity-section")?.hasAttribute("hidden"),
  ).toBe(true);
  expect(screen.queryByText("Las ideas toman forma aquí.")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Pausar simulación" }),
  ).toBeNull();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Investigar IA" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar consulta" }));
  expect(
    await screen.findByText("Investigar IA", {
      selector: ".aui-user-message span",
    }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Reanudar simulación" }),
  ).toBeNull();
  expect(screen.getByText("thinking")).toBeTruthy();
  expect(screen.queryByText("Consultando herramientas…")).toBeNull();
  expect(document.querySelector(".aui-run-status")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Detener consulta" }));
  expect(
    await screen.findByText("Consulta cancelada. Puedes enviar otra."),
  ).toBeTruthy();
});
it("keeps older concurrent work cancellable in the external-store runtime", async () => {
  const engine = new SwarmEngine();
  engine.setPlaying(false);
  engine.inject("Primera");
  engine.inject("Segunda");
  function Harness() {
    const [snapshot, setSnapshot] = useState(engine.snapshot());
    return (
      <Chat
        snapshot={snapshot}
        agentName="Market Intelligence"
        reset={() => {}}
        act={(action) => {
          action(engine);
          setSnapshot(engine.snapshot());
        }}
      />
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Detener consulta" }));
  expect(
    await screen.findByRole("button", { name: "Detener consulta" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Detener consulta" }));
  expect(
    engine
      .snapshot()
      .conversations.every(
        (conversation) => conversation.status === "cancelled",
      ),
  ).toBe(true);
});
it("opens inline configuration inside the chat with real file fields", async () => {
  render(<App />);
  await screen.findByRole("button", { name: "Tareas" });
  fireEvent.click(screen.getByRole("button", { name: "Configurar agentes" }));
  expect(
    screen.getByRole("region", { name: "Oracle AI Data Platform Agent Flows" }),
  ).toBeTruthy();
  expect(screen.getByLabelText("Archivo config OCI")).toBeTruthy();
  expect(screen.getByLabelText("Archivo key.pem")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar configuración" }));
  expect(
    screen.queryByRole("region", {
      name: "Oracle AI Data Platform Agent Flows",
    }),
  ).toBeNull();
});

it("opens configuration from the header gear and preserves the composer draft", async () => {
  render(<App />);
  await screen.findByRole("button", { name: "Tareas" });
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Borrador que debe conservarse" },
  });
  const gear = screen.getByRole("button", {
    name: "Configurar agentes",
  });
  expect(gear.querySelector("svg")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Ampliar chat" })).toBeNull();
  fireEvent.click(gear);
  expect(
    screen.getByRole("region", { name: "Oracle AI Data Platform Agent Flows" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar configuración" }));
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "Borrador que debe conservarse",
  );
});
it("renders response feedback, measured simulation timings and unavailable token usage", async () => {
  const engine = new SwarmEngine();
  const id = engine.inject("Investigar contexto");
  engine.advance(30000);
  function Harness() {
    const [snapshot, setSnapshot] = useState(engine.snapshot());
    return (
      <Chat
        snapshot={snapshot}
        agentName="Market Intelligence"
        reset={() => {}}
        act={(action) => {
          action(engine);
          setSnapshot(engine.snapshot());
        }}
      />
    );
  }
  render(<Harness />);
  const positive = screen.getByRole("button", { name: "Respuesta útil" });
  fireEvent.click(positive);
  expect(positive.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Respuesta no útil" }));
  expect(positive.getAttribute("aria-pressed")).toBe("false");
  expect(engine.snapshot().conversations[0].feedback).toBe("negative");
  expect(screen.queryByRole("button", { name: "Uso de contexto" })).toBeNull();
  expect(screen.queryByText("Tiempo virtual de simulación")).toBeNull();
  expect(document.querySelector("details.response-timing")).toBeNull();
  expect(document.querySelector("span.response-timing")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Dictar mensaje" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Regenerar respuesta" }));
  expect(engine.snapshot().conversations).toHaveLength(1);
  expect(engine.snapshot().conversations[0].id).toBe(id);
  expect(engine.snapshot().conversations[0].status).toBe("running");
  expect(engine.snapshot().conversations[0].feedback).toBeUndefined();
  expect(
    await screen.findByRole("button", { name: "Detener consulta" }),
  ).toBeTruthy();
});

it("starts and stops response speech only after explicit clicks", () => {
  class Utterance extends EventTarget {
    constructor(public text: string) {
      super();
    }
  }
  const voice = { speak: vi.fn(), cancel: vi.fn() };
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", voice);
  const engine = new SwarmEngine();
  engine.inject("Leer esta respuesta");
  engine.advance(30000);
  render(
    <Chat
      snapshot={engine.snapshot()}
      agentName="Market Intelligence"
      reset={() => {}}
      act={(action) => action(engine)}
    />,
  );
  expect(voice.speak).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Leer respuesta" }));
  expect(voice.speak).toHaveBeenCalledWith(
    expect.objectContaining({
      text: engine.snapshot().conversations[0].answer,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Detener lectura" }));
  expect(voice.cancel).toHaveBeenCalled();
});

it("dictates into the draft through the installed browser adapter without sending", async () => {
  let recognition: Recognition;
  class Recognition extends EventTarget {
    lang = "";
    continuous = false;
    interimResults = false;
    constructor() {
      super();
      recognition = this;
    }
    start() {
      this.dispatchEvent(new Event("start"));
    }
    stop() {
      this.dispatchEvent(new Event("end"));
    }
    abort() {
      this.stop();
    }
  }
  vi.stubGlobal("SpeechRecognition", Recognition);
  render(<App />);
  await screen.findByRole("button", { name: "Tareas" });
  fireEvent.click(screen.getByRole("button", { name: "Dictar mensaje" }));
  const result = Object.assign([{ transcript: "Una pregunta dictada" }], {
    isFinal: true,
  });
  act(() =>
    recognition!.dispatchEvent(
      Object.assign(new Event("result"), { results: [result] }),
    ),
  );
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "Una pregunta dictada",
  );
  expect(document.querySelector(".aui-user-message")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Detener dictado" }));
  expect(
    await screen.findByRole("button", { name: "Dictar mensaje" }),
  ).toBeTruthy();
});

it("shows public source progress before results and replaces it when that source delivers a block", () => {
  const engine = new SwarmEngine();
  engine.inject("Consulta remota");
  const initial = engine.snapshot();
  const requestId = initial.conversations[0].id;
  const progress = {
    ...initial,
    events: [
      {
        id: 1,
        at: initial.time,
        type: "source.coverage",
        text: "Consultando la fuente seleccionada; los hallazgos se mostrarán después de contrastarlos.",
        from: "agent",
        to: "desk",
        requestId,
        source: "web" as const,
      },
    ],
  };
  const props = { agentName: "TEST", reset: () => {}, act: () => {} };
  const mounted = render(<Chat {...props} snapshot={progress} />);
  expect(
    mounted.container.querySelector('[data-tool-status="running"]')
      ?.textContent,
  ).toContain("Consultando fuentes...");
  expect(screen.queryByText("thinking")).toBeNull();
  mounted.rerender(
    <Chat
      {...props}
      snapshot={{
        ...progress,
        events: [
          {
            ...progress.events[0],
            text: "Información recuperada de la fuente; pendiente de análisis y verificación.",
          },
        ],
      }}
    />,
  );
  expect(
    mounted.container.querySelector('[data-tool-status="running"]')
      ?.textContent,
  ).toContain("Analizando resultados...");
  const delivered = {
    ...progress,
    events: [
      ...progress.events,
      {
        ...progress.events[0],
        id: 2,
        type: "draft.upsert",
        text: "Resultado contrastado",
      },
    ],
    findings: [
      {
        id: "block",
        requestId,
        source: "web" as const,
        title: "Web",
        text: "Resultado contrastado",
        at: initial.time,
        remote: true,
      },
    ],
  };
  mounted.rerender(<Chat {...props} snapshot={delivered} />);
  expect(
    mounted.container.querySelector('[data-tool-status="running"]'),
  ).toBeNull();
  expect(
    mounted.container.querySelector('[data-tool-status="completed"]')
      ?.textContent,
  ).toContain("Resultado contrastado");
});

it("streams public tool results before the final answer and collapses the history on completion", () => {
  const engine = new SwarmEngine();
  engine.inject("Investigar fuentes");
  let refresh: () => void = () => {};
  function Harness() {
    const [snapshot, setSnapshot] = useState(engine.snapshot());
    refresh = () => setSnapshot(engine.snapshot());
    return (
      <Chat
        snapshot={snapshot}
        agentName="Market Intelligence"
        reset={() => {}}
        act={(action) => action(engine)}
      />
    );
  }
  const { container } = render(<Harness />);
  expect(screen.getByText("thinking")).toBeTruthy();
  expect(container.querySelector('[data-tool-status="running"]')).toBeNull();
  const progress = container.querySelector(".t-shimmer")!;
  expect(progress.getAttribute("data-text")).toBe("thinking");
  expect(progress.getAttribute("data-running")).toBe("true");
  expect(container.querySelectorAll(".tool-progress li")).toHaveLength(0);
  expect(container.querySelector(".tool-progress summary")?.textContent).toBe(
    "thinking",
  );
  act(() => {
    engine.advance(2500);
    refresh();
  });
  expect(
    container.querySelectorAll('[data-tool-status="completed"]').length,
  ).toBe(1);
  expect(engine.snapshot().conversations[0].answer).toBe("");
  expect(screen.queryByText("thinking")).toBeNull();
  expect(container.querySelectorAll(".tool-progress summary")).toHaveLength(1);
  expect(screen.getByText("Worked for 2s")).toBeTruthy();
  expect(container.querySelector(".t-shimmer")).toBe(progress);
  expect(progress.getAttribute("data-text")).toBe("Worked for 2s");
  act(() => {
    engine.setPlaying(false);
    refresh();
  });
  expect(progress.getAttribute("data-playing")).toBe("false");
  act(() => {
    engine.setPlaying(true);
    refresh();
  });
  expect(container.querySelector(".tool-progress li p")?.textContent).toBe(
    engine.snapshot().findings[0].text,
  );
  expect(
    container.querySelector('.tool-progress .t-stream-w[data-enter="true"]'),
  ).toBeTruthy();
  act(() => {
    engine.advance(30000);
    refresh();
  });
  expect(screen.queryByText("thinking")).toBeNull();
  expect(container.querySelector(".tool-progress")?.hasAttribute("open")).toBe(
    false,
  );
  expect(container.querySelector(".answer-text")?.textContent).toContain(
    "Preparé",
  );
  expect(container.querySelectorAll(".tool-progress li")).toHaveLength(6);
  expect(progress.getAttribute("data-running")).toBe("false");
  expect(screen.queryByText("Recibido")).toBeNull();
  const completedLabel = container.querySelector(
    ".tool-progress summary",
  )?.textContent;
  act(() => {
    engine.advance(3600000);
    refresh();
  });
  expect(container.querySelector(".tool-progress summary")?.textContent).toBe(
    completedLabel,
  );
});

it("reveals the first received answer block in a new turn but does not replay a restored live answer", () => {
  const initial = new SwarmEngine().snapshot();
  let update!: (snapshot: typeof initial) => void;
  function Harness() {
    const [snapshot, setSnapshot] = useState(initial);
    update = setSnapshot;
    return (
      <Chat
        snapshot={snapshot}
        act={() => {}}
        reset={() => {}}
        agentName="Prueba"
        selectedConversation="stream"
      />
    );
  }
  const mounted = render(<Harness />);
  const state = structuredClone(initial);
  state.conversations.push({
    id: "fresh",
    question: "Pregunta",
    answer: "",
    createdAt: 0,
    chunks: 0,
    status: "running",
  });
  act(() => update(structuredClone(state)));
  state.conversations[0].answer = "Primer bloque recibido";
  act(() => update(structuredClone(state)));
  expect(
    mounted.container.querySelector(
      '.answer-text > .t-stream [data-enter="true"]',
    ),
  ).toBeTruthy();
  mounted.unmount();
  const restored = render(
    <Chat
      snapshot={state}
      act={() => {}}
      reset={() => {}}
      agentName="Prueba"
      selectedConversation="stream"
    />,
  );
  expect(
    restored.container.querySelector(
      '.answer-text > .t-stream [data-enter="true"]',
    ),
  ).toBeNull();
  expect(
    restored.container.querySelector(".answer-text > .t-stream")?.textContent,
  ).toBe("Primer bloque recibido");
});

it.each(["Enter", " "])(
  "chooses a saved agent with %s from the keyboard dropdown",
  (key) => {
    const select = vi.fn();
    const engine = new SwarmEngine();
    render(
      <Chat
        snapshot={engine.snapshot()}
        act={(action) => action(engine)}
        reset={() => {}}
        agentName="Market Intelligence"
        agentChoices={[
          { id: "demo", name: "Market Intelligence" },
          { id: "saved", name: "Agente guardado" },
        ]}
        selectedAgent="demo"
        onSelectAgent={select}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Configurar agente desde el chat" }),
    ).toBeNull();
    const picker = screen.getByRole("combobox", { name: "Elegir agente" });
    fireEvent.click(picker);
    expect(
      screen.getByRole("listbox", { name: "Agentes disponibles" }),
    ).toBeTruthy();
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    fireEvent.keyDown(picker, { key });
    expect(select).toHaveBeenCalledWith("saved");
    expect(screen.queryByRole("listbox")).toBeNull();
  },
);

it("closes chat options after selecting an action and restores focus", () => {
  const reset = vi.fn();
  render(
    <Chat
      snapshot={new SwarmEngine().snapshot()}
      act={() => {}}
      reset={reset}
      agentName="Market Intelligence"
      history={[{ id: "old", title: "Consulta anterior" }]}
    />,
  );
  const trigger = screen.getByLabelText("Opciones del chat");
  const menu = trigger.closest(".chat-options")!;
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name: "Nueva conversación" }));
  expect(reset).toHaveBeenCalledOnce();
  expect(menu.getAttribute("data-open")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("lists previous conversations before New and selects them with the keyboard", () => {
  const select = vi.fn();
  render(
    <Chat
      snapshot={new SwarmEngine().snapshot()}
      act={() => {}}
      reset={() => {}}
      agentName="Market Intelligence"
      history={[
        { id: "old", title: "Consulta anterior" },
        { id: "current", title: "Consulta actual" },
      ]}
      selectedConversation="current"
      onSelectConversation={select}
    />,
  );
  const trigger = screen.getByLabelText("Opciones del chat");
  fireEvent.click(trigger);
  const items = screen.getAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual([
    "Consulta anterior",
    "Consulta actual",
    "Nueva conversación",
  ]);
  expect(document.activeElement).toBe(items[0]);
  fireEvent.keyDown(items[0], { key: "ArrowDown" });
  expect(document.activeElement).toBe(items[1]);
  fireEvent.keyDown(items[1], { key: "ArrowUp" });
  expect(document.activeElement).toBe(items[0]);
  fireEvent.click(items[0]);
  expect(select).toHaveBeenCalledWith("old");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("keeps previous messages and drafts when starting and reopening a conversation", async () => {
  render(<App />);
  await screen.findByRole("button", { name: "Tareas" });
  expect(
    screen.queryByRole("button", { name: "Pausar simulación" }),
  ).toBeNull();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Consulta para recuperar" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Enviar consulta" }));
  await screen.findByText("Consulta para recuperar", {
    selector: ".aui-user-message span",
  });
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Borrador conservado" },
  });
  fireEvent.click(screen.getByLabelText("Opciones del chat"));
  fireEvent.click(screen.getByRole("menuitem", { name: "Nueva conversación" }));
  expect(document.querySelectorAll(".aui-user-message")).toHaveLength(0);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  fireEvent.click(screen.getByLabelText("Opciones del chat"));
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Consulta para recuperar" }),
  );
  expect(
    await screen.findByText("Consulta para recuperar", {
      selector: ".aui-user-message span",
    }),
  ).toBeTruthy();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
    "Borrador conservado",
  );
  expect(
    screen.queryByRole("button", {
      name: "Reiniciar simulación y borrar consultas",
    }),
  ).toBeNull();
  expect(document.querySelector(".simulation-controls")).toBeNull();
});

it("isolates copy and feedback state between sessions with reused engine request IDs", async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  });
  try {
    const first = new SwarmEngine();
    first.inject("Primera copia");
    first.advance(30000);
    const second = new SwarmEngine();
    second.inject("Segunda copia");
    second.advance(30000);
    expect(first.snapshot().conversations[0].id).toBe(
      second.snapshot().conversations[0].id,
    );
    const { rerender } = render(
      <Chat
        snapshot={first.snapshot()}
        act={(action) => action(first)}
        reset={() => {}}
        agentName="Market Intelligence"
        selectedConversation="session-a"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copiar respuesta" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Copiar respuesta" })
          .querySelector(".lucide-check"),
      ).not.toBeNull(),
    );
    rerender(
      <Chat
        snapshot={second.snapshot()}
        act={(action) => action(second)}
        reset={() => {}}
        agentName="Market Intelligence"
        selectedConversation="session-b"
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Copiar respuesta" })
        .querySelector(".lucide-check"),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Respuesta útil" }));
    expect(second.snapshot().conversations[0].feedback).toBe("positive");
    expect(first.snapshot().conversations[0].feedback).toBeUndefined();
  } finally {
    if (previous) Object.defineProperty(navigator, "clipboard", previous);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});
