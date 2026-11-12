import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  within,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AgentConfig } from "./AgentConfig";
import type { AgentProfile } from "./profiles";
vi.mock("gsap", () => ({
  gsap: {
    matchMedia: () => ({ add: vi.fn(), revert: vi.fn() }),
    to: () => ({ kill: vi.fn() }),
  },
}));
const saved: AgentProfile = {
  id: "saved",
  name: "Market Intelligence",
  endpoint_host: "aidp.example.org",
  flow_id: "flow",
  region: "us-ashburn-1",
  profile: "DEFAULT",
  ready: false,
};
const response = (value: unknown, ok = true) => ({
  ok,
  json: async () => value,
});
const empty = {
  compartments: [],
  transcription_models: [],
  speech_models: [],
  instances: [],
  workspaces: [],
  agents: [],
  warnings: [],
};
const managedDraft = {
  connection_managed: true,
  has_credentials: true,
  profile: "DEFAULT",
  region: "us-ashburn-1",
  compartment_id: "c1",
  instance_id: "i1",
  workspace_id: "w1",
  agent_ids: ["a1"],
  transcription_model: "stt1",
  speech_model: "tts1",
  profiles: [saved],
};
const network = vi.fn();
function cloud(url: string, init?: RequestInit) {
  if (init?.method === "DELETE") return Promise.resolve(response({}));
  if (url.endsWith("/profiles"))
    return Promise.resolve(
      response({
        profiles: [
          { name: "DEFAULT", region: "us-ashburn-1" },
          { name: "SECOND", region: "eu-frankfurt-1" },
        ],
      }),
    );
  if (url.endsWith("/draft")) {
    const body = init!.body as FormData;
    return Promise.resolve(
      response({
        has_credentials: true,
        region: "us-ashburn-1",
        profile: body.get("profile"),
        compartment_id: body.get("compartment_id"),
        instance_id: body.get("instance_id") || "",
        workspace_id: body.get("workspace_id") || "",
        agent_ids: JSON.parse(String(body.get("agent_ids") || "[]")),
        transcription_model: body.get("transcription_model") || "",
        speech_model: body.get("speech_model") || "",
        profiles:
          body.get("step") === "connection" ||
          (body.get("step") === "agents" && body.get("agent_ids") === "[]")
            ? []
            : [saved],
      }),
    );
  }
  if (url.endsWith("/import")) return Promise.resolve(response([saved]));
  const body = init!.body as FormData;
  if (body.get("stage") === "compartments")
    return Promise.resolve(
      response({
        ...empty,
        compartments: [
          { id: "c1", name: "Producción" },
          { id: "c2", name: "Pruebas" },
        ],
      }),
    );
  if (body.get("stage") === "resources" || body.get("stage") === "audio")
    return Promise.resolve(
      response({
        ...empty,
        transcription_models: [
          { id: "stt1", name: "Transcripción disponible" },
        ],
        speech_models: [{ id: "tts1", name: "Voz disponible" }],
        instances: [{ id: "i1", name: "AIDP Demo" }],
      }),
    );
  return Promise.resolve(
    response({
      ...empty,
      workspaces: [{ id: "w1", name: "Workspace Demo" }],
      agents: body.get("workspace_id")
        ? [
            {
              id: "a1",
              name: "Market Intelligence",
              description: "Investigación de mercado",
              available: true,
            },
            { id: "a2", name: "Sin publicar", available: false },
          ]
        : [],
    }),
  );
}
beforeEach(() => {
  sessionStorage.clear();
  network.mockReset().mockImplementation(cloud);
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url.endsWith("/draft/read")
      ? Promise.resolve(response({ has_credentials: false, profiles: [] }))
      : network(url, init),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup(profiles: AgentProfile[] = []) {
  const props = {
    profiles,
    selected: "demo",
    onSelect: vi.fn(),
    onSaved: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    error: "",
  };
  const rendered = render(<AgentConfig {...props} />);
  return {
    ...rendered,
    ...props,
    config: screen.getByLabelText("Archivo config OCI") as HTMLInputElement,
    key: screen.getByLabelText("Archivo key.pem") as HTMLInputElement,
  };
}
const file = (name: string, size = 32) =>
  new File([new Uint8Array(size)], name, { type: "application/octet-stream" });
function drop(input: HTMLInputElement, files: File[]) {
  fireEvent.drop(input.closest("label")!, {
    dataTransfer: { files, types: ["Files"] },
  });
}
function upload(inputs: ReturnType<typeof setup>) {
  drop(inputs.config, [file("config")]);
  drop(inputs.key, [file("key.pem")]);
}
function tab(name: string) {
  fireEvent.click(screen.getByRole("tab", { name }));
}
async function choose(label: string, value: string) {
  tab(
    label === "Audio a texto (STT)" || label === "Texto a Audio (TTS)"
      ? "Audio"
      : label === "Workspace" || label === "Oracle AI Data Platform Workbench"
        ? "Agent Flow"
        : "Conexión",
  );
  const select = (await screen.findByLabelText(label)) as HTMLSelectElement;
  await waitFor(() => expect(select.disabled).toBe(false));
  fireEvent.change(select, { target: { value } });
}
async function agents(inputs: ReturnType<typeof setup>) {
  upload(inputs);
  await screen.findByRole("option", { name: "DEFAULT" });
  await choose("Perfil", "DEFAULT");
  await screen.findByRole("option", { name: "Producción" });
  await choose("Compartimento", "c1");
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  const savedNotice = (await screen.findByText(/Conexión guardada/)).closest(
    "[role=status]",
  )!;
  expect(savedNotice.classList.contains("config-feedback-success")).toBe(true);
  expect(savedNotice.querySelector("svg")).toBeTruthy();
  tab("Agent Flow");
  await screen.findByRole("option", { name: "AIDP Demo" });
  await choose("Oracle AI Data Platform Workbench", "i1");
  await screen.findByRole("option", { name: "Workspace Demo" });
  expect(screen.queryByRole("checkbox")).toBeNull();
  await choose("Workspace", "w1");
  await waitFor(() =>
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0),
  );
  await waitFor(() =>
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0),
  );
  await screen.findByRole("checkbox", { name: /Market Intelligence/ });
  await waitFor(() =>
    expect(screen.queryByText("Buscando workspaces y agentes…")).toBeNull(),
  );
}

it("keeps discovered agents visible and selectable without opening a dropdown", async () => {
  const inputs = setup();
  await screen.findByRole("tab", { name: "Conexión" });
  const region = screen.getByRole("combobox", {
    name: "Región",
  }) as HTMLSelectElement;
  expect(region.disabled).toBe(true);
  expect(region.selectedOptions[0].textContent).toBe("Seleccionar…");
  await agents(inputs);
  expect(screen.queryByRole("combobox", { name: "Agent Flow" })).toBeNull();
  const checkbox = screen.getByRole("checkbox", {
    name: /Market Intelligence/,
  }) as HTMLInputElement;
  fireEvent.click(checkbox);
  fireEvent.click(document.body);
  expect(checkbox.checked).toBe(true);
  expect(screen.getByRole("checkbox", { name: /Sin publicar/ })).toBeTruthy();
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(false);
  expect(inputs.onClose).not.toHaveBeenCalled();
});
it("discovers profiles only after both files, sending File objects without reading or persisting contents", async () => {
  const inputs = setup(),
    config = file("config", 65536),
    key = file("private.PEM", 16384);
  const readConfig = vi.spyOn(config, "slice"),
    readKey = vi.spyOn(key, "slice"),
    store = vi.spyOn(Storage.prototype, "setItem");
  drop(inputs.config, [config]);
  expect(network).not.toHaveBeenCalled();
  drop(inputs.key, [key]);
  await screen.findByRole("option", { name: "DEFAULT" });
  const [url, request] = network.mock.calls[0];
  expect(url).toBe("/api/desk/discovery/profiles");
  expect(request.method).toBe("POST");
  expect(request.headers).toEqual({ "X-Agent-Desk": "configure" });
  expect(request.body.get("config")).toBe(config);
  expect(request.body.get("key")).toBe(key);
  expect(inputs.config.required).toBe(false);
  expect(inputs.key.required).toBe(false);
  expect(readConfig).not.toHaveBeenCalled();
  expect(readKey).not.toHaveBeenCalled();
  expect(store).not.toHaveBeenCalled();
  expect(
    inputs.container.querySelector("iframe,object,embed,video,audio"),
  ).toBeNull();
  expect(
    inputs.container.querySelectorAll(".credential-drop-surface.is-landing"),
  ).toHaveLength(2);
});
it("retains keyboard file inputs and native picker selection", () => {
  const { config, key } = setup();
  config.focus();
  expect(document.activeElement).toBe(config);
  expect(config.type).toBe("file");
  expect(key.accept).toBe(".pem");
  fireEvent.change(config, { target: { files: [file("oci.config")] } });
  expect(config.closest("label")?.textContent).toContain("oci.config");
  expect(config.required).toBe(false);
});
it.each([
  ["config", "config", 65537, "64 KiB"],
  ["key", "key.pem", 16385, "16 KiB"],
  ["key", "key.txt", 16, ".pem"],
  ["config", "config", 0, "vacío"],
] as const)(
  "rejects invalid %s metadata before discovery",
  async (kind, name, size, message) => {
    const inputs = setup();
    await screen.findByRole("tab", { name: "Conexión" });
    drop(inputs[kind], [file(name, size)]);
    expect(screen.getByRole("alert").textContent).toContain(message);
    expect(inputs[kind].required).toBe(true);
    expect(inputs[kind].getAttribute("aria-invalid")).toBe("true");
    expect(network).not.toHaveBeenCalled();
  },
);
it("keeps valid files on multiple-file rejection and restarts landing only for a valid replacement", async () => {
  const { config } = setup(),
    zone = config.closest("label")!;
  await screen.findByRole("tab", { name: "Conexión" });
  fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"] } });
  expect(zone.classList.contains("is-over")).toBe(true);
  fireEvent.dragLeave(zone);
  expect(zone.classList.contains("is-over")).toBe(false);
  drop(config, [file("existing.config")]);
  const before = zone.querySelector(".credential-drop-surface");
  drop(config, [file("one"), file("two")]);
  expect(screen.getByRole("alert").textContent).toContain("un solo archivo");
  expect(zone.querySelector(".credential-drop-surface")).toBe(before);
  expect(zone.textContent).toContain("existing.config");
  expect(config.required).toBe(false);
  drop(config, [file("second.config")]);
  expect(zone.querySelector(".credential-drop-surface")).not.toBe(before);
});
it("uses inline validation and first-invalid focus with replayable shake, without a Guardar tooltip", () => {
  const { config, container } = setup(),
    save = screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  expect(save.getAttribute("data-tooltip-disabled")).toBe("true");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(container.querySelector(".is-shaking")).toBeNull();
  const form = container.querySelector("form")!;
  expect(form.noValidate).toBe(true);
  fireEvent.submit(form);
  expect(document.activeElement).toBe(config);
  expect(network).not.toHaveBeenCalled();
  expect(
    document.getElementById(config.getAttribute("aria-describedby")!)
      ?.textContent,
  ).toBe("Selecciona el archivo config.");
  const zone = config.closest("label")!;
  expect(zone.classList.contains("is-shaking")).toBe(true);
  const end = new Event("animationend", { bubbles: true });
  Object.defineProperty(end, "animationName", { value: "agent-config-shake" });
  fireEvent(zone, end);
  expect(zone.classList.contains("is-shaking")).toBe(false);
  fireEvent.blur(config);
  expect(zone.classList.contains("is-shaking")).toBe(true);
  drop(config, [file("config")]);
  expect(config.getAttribute("aria-invalid")).toBe("false");
});
it("retains accessible feedback without shaking for reduced motion", () => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  const { config, container } = setup();
  fireEvent.submit(container.querySelector("form")!);
  expect(document.activeElement).toBe(config);
  expect(config.getAttribute("aria-invalid")).toBe("true");
  expect(container.querySelector(".is-shaking")).toBeNull();
});
it("imports selected published agents with independent optional STT and speech models", async () => {
  const inputs = setup();
  await agents(inputs);
  expect((screen.getByLabelText("Región") as HTMLInputElement).value).toBe(
    "us-ashburn-1",
  );
  expect(
    (screen.getByRole("checkbox", { name: /Sin publicar/ }) as HTMLInputElement)
      .disabled,
  ).toBe(true);
  expect(screen.getByText("Publicación requerida")).toBeTruthy();
  const save = screen.getByRole("button", {
    name: "Guardar",
  }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  await choose("Audio a texto (STT)", "stt1");
  await choose("Texto a Audio (TTS)", "tts1");
  tab("Agent Flow");
  await waitFor(() =>
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: /Market Intelligence/ }),
  );
  expect(save.disabled).toBe(false);
  fireEvent.click(save);
  await waitFor(() => expect(inputs.onSelect).toHaveBeenCalledWith("saved"));
  const request = network.mock.calls.find(
    ([url, r]) =>
      url.endsWith("/draft") && (r.body as FormData).get("step") === "agents",
  )![1];
  expect(request.body.get("profile")).toBe("DEFAULT");
  expect(request.body.get("compartment_id")).toBe("c1");
  expect(request.body.get("instance_id")).toBe("i1");
  expect(request.body.get("workspace_id")).toBe("w1");
  expect(request.body.get("transcription_model")).toBe("");
  expect(request.body.get("speech_model")).toBe("");
  expect(JSON.parse(request.body.get("agent_ids"))).toEqual(["a1"]);
  expect(inputs.onSaved).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Agent Flow guardado.")).toBeTruthy();
  expect(save.disabled).toBe(true);
  fireEvent.submit(save.closest("form")!);
  expect(inputs.onSaved).toHaveBeenCalledTimes(1);
  tab("Audio");
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await screen.findByText("Audio guardado.");
  expect(save.disabled).toBe(true);
  tab("Conexión");
  expect(save.disabled).toBe(true);
  tab("Agent Flow");
  expect(save.disabled).toBe(true);
  const audio = network.mock.calls.find(
    ([url, r]) =>
      url.endsWith("/draft") && (r.body as FormData).get("step") === "audio",
  )![1].body;
  expect(audio.get("transcription_model")).toBe("stt1");
  expect(audio.get("speech_model")).toBe("tts1");
});
it("does not block agent selection when regional audio catalogs are empty", async () => {
  network.mockImplementation((url: string, init?: RequestInit) =>
    url.endsWith("/options") &&
    (init!.body as FormData).get("stage") === "resources"
      ? Promise.resolve(
          response({
            ...empty,
            instances: [{ id: "i1", name: "AIDP Demo" }],
            warnings: ["Audio no disponible en esta región."],
          }),
        )
      : cloud(url, init),
  );
  const inputs = setup();
  await agents(inputs);
  tab("Audio");
  expect(screen.getByText("Audio no disponible en esta región.")).toBeTruthy();
  tab("Agent Flow");
  await waitFor(() =>
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0),
  );
  expect(
    (screen.getByLabelText("Audio a texto (STT)") as HTMLSelectElement).value,
  ).toBe("");
  expect(
    (screen.getByLabelText("Texto a Audio (TTS)") as HTMLSelectElement).value,
  ).toBe("");
  fireEvent.click(
    screen.getByRole("checkbox", { name: /Market Intelligence/ }),
  );
  expect(
    (screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
});
it("resets downstream selections and ignores stale responses after compartment changes", async () => {
  let resolveOld!: (value: unknown) => void, oldSignal!: AbortSignal;
  network.mockImplementation((url: string, init?: RequestInit) => {
    const body = init?.body as FormData;
    if (
      url.endsWith("/options") &&
      body.get("stage") === "resources" &&
      body.get("compartment_id") === "c1"
    ) {
      oldSignal = init!.signal as AbortSignal;
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    }
    return cloud(url, init);
  });
  const inputs = setup();
  upload(inputs);
  await screen.findByRole("option", { name: "DEFAULT" });
  await choose("Perfil", "DEFAULT");
  await screen.findByRole("option", { name: "Producción" });
  await choose("Compartimento", "c1");
  await waitFor(() => expect(resolveOld).toBeTypeOf("function"));
  await choose("Compartimento", "c2");
  tab("Agent Flow");
  await screen.findByRole("option", { name: "AIDP Demo" });
  expect(oldSignal.aborted).toBe(true);
  await act(async () =>
    resolveOld(
      response({
        ...empty,
        instances: [{ id: "old", name: "Instancia antigua" }],
      }),
    ),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("option", { name: "Instancia antigua" }),
    ).toBeNull(),
  );
  await choose("Audio a texto (STT)", "stt1");
  await choose("Oracle AI Data Platform Workbench", "i1");
  await screen.findByRole("option", { name: "Workspace Demo" });
  await choose("Perfil", "SECOND");
  await screen.findByRole("option", { name: "Producción" });
  expect(
    (screen.getByLabelText("Compartimento") as HTMLSelectElement).value,
  ).toBe("");
  expect(
    (
      screen.getByLabelText(
        "Oracle AI Data Platform Workbench",
      ) as HTMLSelectElement
    ).value,
  ).toBe("");
  expect(
    (screen.getByLabelText("Audio a texto (STT)") as HTMLSelectElement).value,
  ).toBe("");
  expect(
    (screen.getByLabelText("Workspace") as HTMLSelectElement).disabled,
  ).toBe(true);
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect((screen.getByLabelText("Región") as HTMLInputElement).value).toBe(
    "eu-frankfurt-1",
  );
});
it("aborts requests on file replacement and unmount, ignoring late profiles", async () => {
  let finish!: (value: unknown) => void;
  const signals: AbortSignal[] = [];
  network.mockImplementation((_url: string, init: RequestInit) => {
    signals.push(init.signal as AbortSignal);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const inputs = setup();
  upload(inputs);
  await waitFor(() => expect(signals).toHaveLength(1));
  const oldFinish = finish;
  drop(inputs.config, [file("other.config")]);
  await waitFor(() => expect(signals).toHaveLength(2));
  expect(signals[0].aborted).toBe(true);
  await act(async () =>
    oldFinish(response({ profiles: [{ name: "OLD", region: "old" }] })),
  );
  await waitFor(() =>
    expect(screen.queryByRole("option", { name: "OLD" })).toBeNull(),
  );
  inputs.unmount();
  expect(signals[1].aborted).toBe(true);
  await act(async () => finish(response({ profiles: [] })));
  expect(inputs.onSaved).not.toHaveBeenCalled();
});
it.each([true, false])(
  "aborts a pending section save on unmount and ignores its late result (ok=%s)",
  async (ok) => {
    const inputs = setup();
    await agents(inputs);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Market Intelligence/ }),
    );
    let finish!: (value: unknown) => void;
    let signal!: AbortSignal;
    network.mockImplementation((url: string, init?: RequestInit) => {
      if (!url.endsWith("/draft")) return cloud(url, init);
      signal = init!.signal as AbortSignal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(signal.aborted).toBe(false);
    expect(
      screen
        .getByRole("button", { name: "Guardando…" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("tab", { name: "Audio" }).hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.keyDown(inputs.container.querySelector("section")!, {
      key: "Escape",
    });
    expect(inputs.onClose).not.toHaveBeenCalled();
    inputs.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finish(
        response(ok ? { profiles: [saved] } : { detail: "Late failure" }, ok),
      ),
    );
    expect(inputs.onSaved).not.toHaveBeenCalled();
    expect(inputs.onSelect).not.toHaveBeenCalled();
  },
);
it("focuses the panel title and aborts active discovery when Escape closes the panel", async () => {
  let finish!: (value: unknown) => void;
  let signal!: AbortSignal;
  network.mockImplementation((_url: string, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const inputs = setup();
  expect(document.activeElement).toBe(
    screen.getByRole("heading", {
      name: "Oracle AI Data Platform Agent Flows",
    }),
  );
  upload(inputs);
  expect(signal.aborted).toBe(false);
  fireEvent.keyDown(inputs.config, { key: "Escape" });
  expect(inputs.onClose).toHaveBeenCalledOnce();
  expect(signal.aborted).toBe(true);
  await act(async () =>
    finish(response({ profiles: [{ name: "LATE", region: "old" }] })),
  );
  expect(screen.queryByRole("option", { name: "LATE" })).toBeNull();
});
it("retries discovery failure while retaining files", async () => {
  network.mockImplementationOnce(() =>
    Promise.resolve(response({ detail: "Comprueba el perfil OCI." }, false)),
  );
  const inputs = setup();
  upload(inputs);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Comprueba el perfil OCI.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByRole("option", { name: "DEFAULT" });
  expect(inputs.config.required).toBe(false);
  expect(inputs.key.required).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
});
it("imports multiple selected agents directly when the instance needs no workspace", async () => {
  network.mockImplementation((url: string, init?: RequestInit) => {
    if (
      url.endsWith("/options") &&
      (init!.body as FormData).get("stage") === "agents"
    )
      return Promise.resolve(
        response({
          ...empty,
          agents: [
            { id: "a1", name: "Agente uno", available: true },
            { id: "a3", name: "Agente dos", available: true },
          ],
        }),
      );
    return cloud(url, init);
  });
  const inputs = setup();
  upload(inputs);
  await screen.findByRole("option", { name: "DEFAULT" });
  await choose("Perfil", "DEFAULT");
  await screen.findByRole("option", { name: "Producción" });
  await choose("Compartimento", "c1");
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  const savedNotice = (await screen.findByText(/Conexión guardada/)).closest(
    "[role=status]",
  )!;
  expect(savedNotice.classList.contains("config-feedback-success")).toBe(true);
  expect(savedNotice.querySelector("svg")).toBeTruthy();
  tab("Agent Flow");
  await screen.findByRole("option", { name: "AIDP Demo" });
  await choose("Oracle AI Data Platform Workbench", "i1");
  await waitFor(() =>
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0),
  );
  await waitFor(() =>
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0),
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: "Agente uno" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Agente dos" }));
  expect(
    (screen.getByLabelText("Workspace") as HTMLSelectElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(inputs.onSelect).toHaveBeenCalledWith("saved"));
  const body = network.mock.calls.find(
    ([url, r]) =>
      url.endsWith("/draft") && (r.body as FormData).get("step") === "agents",
  )![1].body;
  expect(JSON.parse(body.get("agent_ids"))).toEqual(["a1", "a3"]);
  expect(body.get("workspace_id")).toBe("");
  expect(screen.getByText("Agent Flow guardado.")).toBeTruthy();
  expect(inputs.onSaved).toHaveBeenCalledTimes(1);
});

it("preserves files and selection after backend import rejection", async () => {
  network.mockImplementation((url: string, init?: RequestInit) =>
    url.endsWith("/draft") && (init!.body as FormData).get("step") === "agents"
      ? Promise.resolve(
          response({ detail: "El agente requiere publicación." }, false),
        )
      : cloud(url, init),
  );
  const inputs = setup();
  await agents(inputs);
  fireEvent.click(
    screen.getByRole("checkbox", { name: /Market Intelligence/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "El agente requiere publicación.",
  );
  expect(inputs.onSaved).not.toHaveBeenCalled();
  expect(inputs.onSelect).not.toHaveBeenCalled();
  expect(inputs.config.required).toBe(false);
  await waitFor(() =>
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0),
  );
  expect(
    (
      screen.getByRole("checkbox", {
        name: /Market Intelligence/,
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
});
it("keeps AIDP identity and discovery groups without duplicate saved-agent details", async () => {
  const { container, config, key } = setup([saved]);
  await screen.findByRole("tab", { name: "Conexión" });
  const icon = container.querySelector("header > .config-aidp-icon")!;
  expect(icon.getAttribute("src")).toBe("/icons/aidp/oci-ai-data-platform.svg");
  expect(icon.getAttribute("alt")).toBe("");
  expect(
    screen.getByText("Configura la conexión con tu Agent Flow publicado."),
  ).toBeTruthy();
  expect(container.querySelector(".config-privacy")).toBeNull();
  expect(screen.queryByLabelText("Nombre del agente")).toBeNull();
  expect(screen.queryByLabelText("Endpoint publicado")).toBeNull();
  expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual([
    "Conexión",
    "Agent Flow",
    "Audio",
    "Sugerencias",
  ]);
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  expect(config.form).toBe(key.form);
  expect((screen.getByLabelText("Perfil") as HTMLSelectElement).form).toBe(
    config.form,
  );
  expect(screen.queryByRole("table")).toBeNull();
  expect(container.querySelector(".configured-agents")).toBeNull();
});

it("restores saved stages without uploading credentials and discards unavailable agents", async () => {
  const draft = {
    has_credentials: true,
    profile: "DEFAULT",
    region: "us-ashburn-1",
    compartment_id: "c1",
    instance_id: "i1",
    workspace_id: "w1",
    agent_ids: ["a1", "a2", "deleted"],
    transcription_model: "stt1",
    speech_model: "tts1",
    profiles: [saved],
  };
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url.endsWith("/draft/read")
      ? Promise.resolve(response(draft))
      : network(url, init),
  );
  const inputs = setup();
  await screen.findAllByText("Guardado en el servidor");
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Compartimento") as HTMLSelectElement).value,
    ).toBe("c1"),
  );
  expect(inputs.config.required).toBe(false);
  tab("Agent Flow");
  await waitFor(() =>
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0),
  );
  expect(
    (
      screen.getByRole("checkbox", {
        name: /Market Intelligence/,
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect(
    network.mock.calls.every(([, r]) => !(r.body as FormData).has("key")),
  ).toBe(true);
  tab("Audio");
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Texto a Audio (TTS)") as HTMLSelectElement).value,
    ).toBe("tts1"),
  );
});
it("does not overwrite newly uploaded files with a late saved draft", async () => {
  let finish!: (value: unknown) => void;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url.endsWith("/draft/read")
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : network(url, init),
  );
  const inputs = setup();
  upload(inputs);
  await screen.findByRole("option", { name: "SECOND", hidden: true });
  await act(async () =>
    finish(
      response({
        has_credentials: true,
        profile: "OLD",
        region: "old",
        profiles: [],
      }),
    ),
  );
  expect(screen.queryByRole("option", { name: "OLD" })).toBeNull();
  expect(
    screen.getByText("key.pem", { selector: ".credential-drop-filename" }),
  ).toBeTruthy();
});
it("supports roving keyboard tabs with one exposed panel", async () => {
  setup();
  const connection = await screen.findByRole("tab", { name: "Conexi\u00f3n" });
  fireEvent.keyDown(connection, { key: "End" });
  expect(document.activeElement).toBe(
    screen.getByRole("tab", { name: "Sugerencias" }),
  );
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
    document.activeElement?.id,
  );
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(document.activeElement).toBe(connection);
});

it.each([false, true])(
  "hides connection uploads until the server mode is known without overwriting the saved step (managed=%s)",
  async (managed) => {
    sessionStorage.setItem("agent-desk.configuration-step", "0");
    let finish!: (value: unknown) => void;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
      url.endsWith("/draft/read")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : network(url, init),
    );
    const { config, container } = setup();
    expect(screen.queryByRole("tab", { name: "Conexión" })).toBeNull();
    expect(config.closest<HTMLElement>('[role="tabpanel"]')!.hidden).toBe(true);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(
      screen
        .getByRole("tab", { name: "Agent Flow" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      container.querySelector('[role="tablist"]')?.getAttribute("style"),
    ).toContain("--config-tab-count: 3");
    expect(sessionStorage.getItem("agent-desk.configuration-step")).toBe("0");
    await act(async () =>
      finish(
        response({
          has_credentials: false,
          profiles: [],
          connection_managed: managed,
        }),
      ),
    );
    expect(screen.getAllByRole("tab")).toHaveLength(managed ? 3 : 4);
    expect(sessionStorage.getItem("agent-desk.configuration-step")).toBe(
      managed ? "1" : "0",
    );
    if (managed) {
      expect(screen.queryByLabelText("Archivo config OCI")).toBeNull();
      expect(screen.queryByRole("tab", { name: "Conexión" })).toBeNull();
    } else {
      expect(
        screen
          .getByRole("tab", { name: "Conexión" })
          .getAttribute("aria-selected"),
      ).toBe("true");
      expect(config.closest<HTMLElement>('[role="tabpanel"]')!.hidden).toBe(
        false,
      );
    }
  },
);

it("keeps uploads hidden after a failed mode read and retries the server configuration", async () => {
  sessionStorage.setItem("agent-desk.configuration-step", "0");
  const read = vi
    .fn()
    .mockResolvedValueOnce(response({}, false))
    .mockResolvedValueOnce(response({ has_credentials: false, profiles: [] }));
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url.endsWith("/draft/read") ? read() : network(url, init),
  );
  const { config } = setup();
  const retry = await screen.findByRole("button", {
    name: "Reintentar configuración",
  });
  expect(screen.queryByRole("tab", { name: "Conexión" })).toBeNull();
  expect(config.closest<HTMLElement>('[role="tabpanel"]')!.hidden).toBe(true);
  expect(sessionStorage.getItem("agent-desk.configuration-step")).toBe("0");
  fireEvent.click(retry);
  await screen.findByRole("tab", { name: "Conexión" });
  expect(read).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Reintentar configuración" }),
  ).toBeNull();
  expect(config.closest<HTMLElement>('[role="tabpanel"]')!.hidden).toBe(false);
  expect(sessionStorage.getItem("agent-desk.configuration-step")).toBe("0");
});

it("uses three managed tabs, migrates the saved connection step and only clears Agent Flow", async () => {
  sessionStorage.setItem("agent-desk.configuration-step", "0");
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  let draft = structuredClone(managedDraft);
  const requests = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/draft/read")) return response(draft);
    if (url.endsWith("/draft/clear")) {
      expect(JSON.parse(init!.body as string)).toEqual({ step: "agents" });
      draft = { ...draft, instance_id: "", workspace_id: "", agent_ids: [] };
      return response(draft);
    }
    return network(url, init);
  });
  vi.stubGlobal("fetch", requests);
  const { container, onSaved } = setup([saved]);
  await waitFor(() =>
    expect(screen.queryByRole("tab", { name: "Conexión" })).toBeNull(),
  );
  const flow = screen.getByRole("tab", { name: "Agent Flow" });
  await waitFor(() => expect(flow.hasAttribute("disabled")).toBe(false));
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "Agent Flow",
    "Audio",
    "Sugerencias",
  ]);
  expect(flow.getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByLabelText("Archivo config OCI")).toBeNull();
  expect(screen.queryByLabelText("Archivo key.pem")).toBeNull();
  expect(screen.queryByLabelText("Perfil")).toBeNull();
  expect(screen.queryByLabelText("Compartimento")).toBeNull();
  expect(
    container.querySelector('[role="tablist"]')?.getAttribute("style"),
  ).toContain("--config-tab-count: 3");
  expect(
    container.querySelector<HTMLElement>(".config-step-pill")?.style.transform,
  ).toBe("translateX(0%)");
  fireEvent.keyDown(flow, { key: "End" });
  const suggestions = screen.getByRole("tab", { name: "Sugerencias" });
  expect(document.activeElement).toBe(suggestions);
  expect(suggestions.getAttribute("aria-selected")).toBe("true");
  expect(
    container.querySelector<HTMLElement>(".config-step-pill")?.style.transform,
  ).toBe("translateX(200%)");
  fireEvent.keyDown(suggestions, { key: "ArrowRight" });
  expect(document.activeElement).toBe(flow);
  fireEvent.keyDown(flow, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(suggestions);
  fireEvent.keyDown(suggestions, { key: "Home" });
  expect(document.activeElement).toBe(flow);
  expect(screen.getByRole("tabpanel").id).toBe(
    flow.getAttribute("aria-controls"),
  );
  expect(sessionStorage.getItem("agent-desk.configuration-step")).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.getByRole("dialog").textContent).toContain(
    "Limpiar Agent Flow",
  );
  fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
  await screen.findByText("Agent Flow limpiado.");
  expect(onSaved).toHaveBeenCalledOnce();
  expect(
    requests.mock.calls.filter(([url]) => url.endsWith("/draft/clear")),
  ).toHaveLength(1);
  expect(
    requests.mock.calls.some(([, init]) => init?.method === "DELETE"),
  ).toBe(false);
  expect(requests.mock.calls.some(([url]) => url.endsWith("/draft"))).toBe(
    false,
  );
  expect(draft.profile).toBe("DEFAULT");
  expect(draft.compartment_id).toBe("c1");
  expect(draft.connection_managed).toBe(true);
  expect(screen.queryByRole("tab", { name: "Conexión" })).toBeNull();
});

it.each(["c1", "c2"])(
  "restores pending managed selections only within the server connection (%s)",
  async (compartment) => {
    sessionStorage.setItem("agent-desk.configuration-step", "2");
    sessionStorage.setItem(
      "agent-desk.configuration-selection",
      JSON.stringify({
        connection: JSON.stringify([
          managedDraft.profile,
          managedDraft.compartment_id,
        ]),
        selection: {
          ...managedDraft,
          compartment_id: compartment,
          transcription_model: "",
        },
      }),
    );
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
      url.endsWith("/draft/read")
        ? Promise.resolve(response(managedDraft))
        : network(url, init),
    );
    setup([saved]);
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Audio" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(
      (screen.getByLabelText("Audio a texto (STT)") as HTMLSelectElement).value,
    ).toBe(compartment === "c1" ? "" : "stt1");
    const catalogRequests = network.mock.calls.filter(([url]) =>
      url.endsWith("/options"),
    );
    expect(catalogRequests.length).toBeGreaterThan(0);
    expect(
      catalogRequests.every(
        ([, init]) =>
          (init.body as FormData).get("profile") === "DEFAULT" &&
          (init.body as FormData).get("compartment_id") === "c1",
      ),
    ).toBe(true);
    expect(screen.queryByRole("tab", { name: "Conexión" })).toBeNull();
  },
);

it.each([true, false])(
  "adopts a late managed connection and discards local uploads and discovery errors (pending=%s)",
  async (pending) => {
    let finishRead!: (value: unknown) => void;
    let finishProfiles!: (value: unknown) => void;
    let manualSignal!: AbortSignal;
    const requests = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/draft/read"))
        return new Promise((resolve) => {
          finishRead = resolve;
        });
      if (url.endsWith("/profiles")) {
        manualSignal = init!.signal as AbortSignal;
        return new Promise((resolve) => {
          finishProfiles = resolve;
        });
      }
      const result = await network(url, init);
      if (url.endsWith("/draft"))
        return response({ ...(await result.json()), connection_managed: true });
      return result;
    });
    vi.stubGlobal("fetch", requests);
    const inputs = setup();
    upload(inputs);
    expect(manualSignal.aborted).toBe(false);
    if (!pending)
      await act(async () =>
        finishProfiles(
          response({ detail: "Manual discovery rejected" }, false),
        ),
      );
    fireEvent.submit(inputs.container.querySelector("form")!);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    await act(async () =>
      finishRead(
        response({
          ...managedDraft,
          instance_id: "",
          workspace_id: "",
          agent_ids: [],
          profiles: [],
          transcription_model: "",
          speech_model: "",
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole("tab", { name: "Agent Flow" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(manualSignal.aborted).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Conexión" })).toBeNull();
    expect(screen.queryByLabelText("Archivo config OCI")).toBeNull();
    expect(screen.queryByLabelText("Archivo key.pem")).toBeNull();
    expect(requests.mock.calls.some(([url]) => url.endsWith("/draft"))).toBe(
      false,
    );
    if (pending)
      await act(async () =>
        finishProfiles(
          response({ profiles: [{ name: "OLD", region: "old" }] }),
        ),
      );
    await choose("Oracle AI Data Platform Workbench", "i1");
    await choose("Workspace", "w1");
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /Market Intelligence/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Agent Flow guardado.");
    const form = requests.mock.calls.find(([url]) =>
      url.endsWith("/draft"),
    )![1]!.body as FormData;
    expect(form.has("config")).toBe(false);
    expect(form.has("key")).toBe(false);
    expect(form.get("profile")).toBe("DEFAULT");
    expect(form.get("compartment_id")).toBe("c1");
    expect(inputs.onSaved).toHaveBeenCalledOnce();
    expect(
      requests.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
  },
);

it("marks a compartment without AIDP instances as invalid and clears it on discovery", async () => {
  let finish!: (value: unknown) => void;
  network.mockImplementation((url: string, init?: RequestInit) => {
    const body = init?.body as FormData;
    if (
      url.endsWith("/options") &&
      body.get("stage") === "resources" &&
      body.get("compartment_id") === "c1"
    )
      return new Promise((resolve) => {
        finish = resolve;
      });
    return cloud(url, init);
  });
  const inputs = setup();
  upload(inputs);
  await screen.findByRole("option", { name: "DEFAULT" });
  await choose("Perfil", "DEFAULT");
  await screen.findByRole("option", { name: "Producción" });
  await choose("Compartimento", "c1");
  const compartment = screen.getByLabelText("Compartimento");
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(compartment.getAttribute("aria-invalid")).toBe("false");
  expect(compartment.getAttribute("aria-busy")).toBe("true");
  expect(
    compartment.parentElement?.querySelector(".config-select-spinner"),
  ).toBeTruthy();
  expect(screen.queryByText("Buscando audio e instancias�")).toBeNull();
  await act(async () => finish(response(empty)));
  const messageText = await screen.findByText(
    "No se encontraron instancias AIDP en este compartimento.",
  );
  const message = messageText.closest("[role=alert]")!;
  expect(compartment.classList.contains("is-error")).toBe(false);
  expect(compartment.getAttribute("aria-invalid")).toBe("false");
  expect(compartment.classList.contains("is-warning")).toBe(true);
  expect(compartment.getAttribute("aria-describedby")).toBe(message.id);
  expect(message.classList.contains("config-feedback-warning")).toBe(true);
  expect(message.querySelector("svg")).toBeTruthy();
  await choose("Compartimento", "c2");
  tab("Agent Flow");
  await screen.findByRole("option", { name: "AIDP Demo" });
  expect(compartment.getAttribute("aria-invalid")).toBe("false");
  expect(
    screen.queryByText(
      "No se encontraron instancias AIDP en este compartimento.",
    ),
  ).toBeNull();
});

it("restores the selected configuration step after remount", async () => {
  const first = setup();
  tab("Audio");
  first.unmount();
  setup();
  expect(
    screen.getByRole("tab", { name: "Audio" }).getAttribute("aria-selected"),
  ).toBe("true");
});
it("protects credentials not yet saved when the page reloads", () => {
  const inputs = setup();
  upload(inputs);
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});

it("recovers an unsaved audio selection using server credentials after remount", async () => {
  const draft = {
    has_credentials: true,
    profile: "DEFAULT",
    region: "us-ashburn-1",
    compartment_id: "c1",
    instance_id: "",
    workspace_id: "",
    agent_ids: [],
    transcription_model: "",
    speech_model: "",
    profiles: [],
  };
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url.endsWith("/draft/read")
      ? Promise.resolve(response(draft))
      : network(url, init),
  );
  const first = setup();
  await screen.findAllByText("Guardado en el servidor");
  await choose("Audio a texto (STT)", "stt1");
  first.unmount();
  setup();
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Audio a texto (STT)") as HTMLSelectElement).value,
    ).toBe("stt1"),
  );
  expect(
    screen.getByRole("tab", { name: "Audio" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(network.mock.calls.some(([url]) => url.endsWith("/draft"))).toBe(
    false,
  );
  expect(
    sessionStorage.getItem("agent-desk.configuration-selection"),
  ).not.toContain("key.pem");
});

it("confirms cancellation before deleting the draft and preserves it when dismissed", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url.endsWith("/draft/read")
      ? Promise.resolve(
          response({
            has_credentials: true,
            profiles: [],
            profile: "DEFAULT",
            compartment_id: "c1",
          }),
        )
      : network(url, init),
  );
  setup();
  const cancel = await screen.findByRole("button", {
    name: "Cancelar",
  });
  expect(
    (screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(cancel);
  expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Cancelar",
    }),
  );
  expect(network.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(
    false,
  );
  fireEvent.click(cancel);
  fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
  await waitFor(() =>
    expect(
      network.mock.calls.some(
        ([url, init]) =>
          url === "/api/desk/discovery/draft" && init?.method === "DELETE",
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole("tab", { name: "Conexión" })
        .getAttribute("aria-selected"),
    ).toBe("true"),
  );
  expect(screen.queryByRole("button", { name: "Continuar" })).toBeNull();
  const resetInputs = {
    config: screen.getByLabelText("Archivo config OCI") as HTMLInputElement,
    key: screen.getByLabelText("Archivo key.pem") as HTMLInputElement,
  };
  upload(resetInputs as ReturnType<typeof setup>);
  await choose("Perfil", "DEFAULT");
  await screen.findByRole("option", { name: "Producción" });
  await choose("Compartimento", "c1");
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
});

it("keeps the dialog open and reports a failed cancellation", async () => {
  network.mockImplementation((url, init) =>
    init?.method === "DELETE"
      ? Promise.resolve(response({}, false))
      : cloud(url, init),
  );
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url.endsWith("/draft/read")
      ? Promise.resolve(
          response({
            has_credentials: true,
            profiles: [],
            profile: "DEFAULT",
            compartment_id: "c1",
          }),
        )
      : network(url, init),
  );
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
  await waitFor(() =>
    expect(
      screen.getAllByText(
        "No se pudo eliminar la conexión. Inténtalo de nuevo.",
      ).length,
    ).toBeGreaterThan(0),
  );
  expect(screen.getByRole("dialog").hasAttribute("open")).toBe(true);
});

it("shows pending workspace and flow queries and permits cancelling populated sections", async () => {
  const inputs = setup();
  expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  await agents(inputs);
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
  let finish!: (value: unknown) => void;
  network.mockImplementation((url: string, init?: RequestInit) => {
    if (
      url.endsWith("/options") &&
      (init?.body as FormData).get("stage") === "agents"
    )
      return new Promise((resolve) => {
        finish = resolve;
      });
    return cloud(url, init);
  });
  await choose("Workspace", "");
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(screen.getByLabelText("Workspace").getAttribute("aria-busy")).toBe(
    "true",
  );
  expect(
    screen.getByRole("group", { name: "Agent Flow" }).getAttribute("aria-busy"),
  ).toBe("true");
  const agentList = screen.getByRole("group", { name: "Agentes disponibles" });
  expect(within(agentList).getByRole("status").textContent).toBe(
    "Buscando agentes…",
  );
  expect(within(agentList).queryByRole("checkbox")).toBeNull();
  expect(
    screen
      .getByLabelText("Workspace")
      .parentElement?.querySelector(".config-select-spinner"),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("group", { name: "Agent Flow" })
      .querySelector(".config-select-spinner"),
  ).toBeTruthy();
  await act(async () =>
    finish(
      response({
        ...empty,
        workspaces: [{ id: "w1", name: "Workspace Demo" }],
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Workspace").getAttribute("aria-busy")).toBe(
      "false",
    ),
  );
  tab("Audio");
  expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  tab("Conexi\u00f3n");
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
});

it("keeps a restored Agent Flow section locked after changing its selection", async () => {
  const draft = {
    has_credentials: true,
    profile: "DEFAULT",
    region: "us-ashburn-1",
    compartment_id: "c1",
    instance_id: "i1",
    workspace_id: "w1",
    agent_ids: ["a1"],
    transcription_model: "",
    speech_model: "",
    profiles: [saved],
  };
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url.endsWith("/draft/read")
      ? Promise.resolve(response(draft))
      : network(url, init),
  );
  const inputs = setup([saved]);
  await screen.findAllByText("Guardado en el servidor");
  tab("Agent Flow");
  const checkbox = await screen.findByRole("checkbox", {
    name: /Market Intelligence/,
  });
  await waitFor(() =>
    expect((checkbox as HTMLInputElement).checked).toBe(true),
  );
  fireEvent.click(checkbox);
  const save = screen.getByRole("button", {
    name: "Guardar",
  }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.click(save);
  fireEvent.submit(save.closest("form")!);
  expect(inputs.onSaved).not.toHaveBeenCalled();
  expect(network.mock.calls.some(([url]) => url.endsWith("/draft"))).toBe(
    false,
  );
});

it.each(["different-connection", "invalid-selection"])(
  "ignores a pending configuration from %s while restoring server credentials",
  async (failure) => {
    const draft = {
      has_credentials: true,
      profile: "DEFAULT",
      region: "us-ashburn-1",
      compartment_id: "c1",
      instance_id: "",
      workspace_id: "",
      agent_ids: [],
      transcription_model: "",
      speech_model: "",
      profiles: [],
    };
    sessionStorage.setItem("agent-desk.configuration-step", "2");
    sessionStorage.setItem(
      "agent-desk.configuration-selection",
      JSON.stringify({
        connection: JSON.stringify([
          draft.profile,
          failure === "different-connection" ? "another-compartment" : "c1",
        ]),
        selection: {
          ...draft,
          transcription_model: "stt1",
          agent_ids: failure === "invalid-selection" ? [42] : [],
        },
      }),
    );
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
      url.endsWith("/draft/read")
        ? Promise.resolve(response(draft))
        : network(url, init),
    );
    setup();
    await screen.findByRole("option", { name: "Transcripción disponible" });
    expect(
      (screen.getByLabelText("Audio a texto (STT)") as HTMLSelectElement).value,
    ).toBe("");
    expect(network.mock.calls.some(([url]) => url.endsWith("/draft"))).toBe(
      false,
    );
  },
);

it("requires explicit OCI Speech reconfiguration for legacy audio without changing valid saved locks", async () => {
  const draft = {
    has_credentials: true,
    profile: "DEFAULT",
    region: "us-chicago-1",
    compartment_id: "c1",
    instance_id: "i1",
    workspace_id: "w1",
    agent_ids: ["a1"],
    profiles: [saved],
    transcription_model: "google.gemini-2.5-flash",
    speech_model: "xai.grok-tts",
  };
  network.mockImplementation(async (url: string, init?: RequestInit) => {
    const result = await cloud(url, init);
    const stage = (init?.body as FormData)?.get("stage");
    if (
      url.endsWith("/options") &&
      ["resources", "audio"].includes(String(stage))
    ) {
      return response({
        ...((await result.json()) as typeof empty),
        transcription_models: [
          { id: "oci.speech.whisper.es", name: "OCI Speech Whisper" },
        ],
        speech_models: [
          { id: "oci.speech.carmen.es-ES", name: "OCI Speech Carmen" },
        ],
      });
    }
    return result;
  });
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url.endsWith("/draft/read")
      ? Promise.resolve(response(draft))
      : network(url, init),
  );
  setup([saved]);
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Compartimento") as HTMLSelectElement).value,
    ).toBe("c1"),
  );
  tab("Audio");
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Audio a texto (STT)") as HTMLSelectElement).value,
    ).toBe(draft.transcription_model),
  );
  expect(
    screen.getByRole("button", { name: "Guardar" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(
    (
      (screen.getByLabelText("Audio a texto (STT)") as HTMLSelectElement)
        .selectedOptions[0] as HTMLOptionElement
    ).disabled,
  ).toBe(true);
  expect(network.mock.calls.some(([url]) => url.endsWith("/draft"))).toBe(
    false,
  );
  await choose("Audio a texto (STT)", "oci.speech.whisper.es");
  await choose("Texto a Audio (TTS)", "oci.speech.carmen.es-ES");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Guardar" }).hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() =>
    expect(
      network.mock.calls.some(
        ([url, init]) =>
          url.endsWith("/draft") &&
          (init?.body as FormData).get("step") === "audio",
      ),
    ).toBe(true),
  );
  const body = network.mock.calls.find(([url]) => url.endsWith("/draft"))![1]
    .body as FormData;
  expect(body.get("transcription_model")).toBe("oci.speech.whisper.es");
  expect(body.get("speech_model")).toBe("oci.speech.carmen.es-ES");
  await screen.findByText("Audio guardado.");
  expect(
    screen.getByRole("button", { name: "Guardar" }).hasAttribute("disabled"),
  ).toBe(true);
});

it.each(["agents", "audio"] as const)(
  "cancels only %s and preserves the other section after remount",
  async (section) => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    let draft = {
      has_credentials: true,
      profile: "DEFAULT",
      region: "us-ashburn-1",
      compartment_id: "c1",
      instance_id: "i1",
      workspace_id: "w1",
      agent_ids: ["a1"],
      transcription_model: "stt1",
      speech_model: "tts1",
      profiles: [saved],
    };
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/draft/read")) return response(draft);
      if (url.endsWith("/draft/clear")) {
        expect(JSON.parse(init!.body as string)).toEqual({ step: section });
        draft = {
          ...draft,
          ...(section === "agents"
            ? { instance_id: "", workspace_id: "", agent_ids: [] }
            : { transcription_model: "", speech_model: "" }),
        };
        return response(draft);
      }
      return network(url, init);
    });
    const first = setup([saved]);
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Compartimento") as HTMLSelectElement).value,
      ).toBe("c1"),
    );
    tab(section === "agents" ? "Agent Flow" : "Audio");
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Audio" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("dialog").textContent).toContain(
      section === "agents" ? "Limpiar Agent Flow" : "Limpiar Audio",
    );
    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
    await screen.findByText(
      section === "agents" ? "Agent Flow limpiado." : "Audio limpiado.",
    );
    first.unmount();
    setup([saved]);
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Compartimento") as HTMLSelectElement).value,
      ).toBe("c1"),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Audio" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    tab("Audio");
    expect(
      (screen.getByLabelText("Audio a texto (STT)") as HTMLSelectElement).value,
    ).toBe(section === "agents" ? "stt1" : "");
    expect(
      (screen.getByLabelText("Texto a Audio (TTS)") as HTMLSelectElement).value,
    ).toBe(section === "agents" ? "tts1" : "");
    tab("Agent Flow");
    expect(
      (
        screen.getByLabelText(
          "Oracle AI Data Platform Workbench",
        ) as HTMLSelectElement
      ).value,
    ).toBe(section === "audio" ? "i1" : "");
    tab("Conexi\u00f3n");
    expect(
      (screen.getByLabelText("Compartimento") as HTMLSelectElement).value,
    ).toBe("c1");
    expect(
      network.mock.calls.some(([, init]) => init?.method === "DELETE"),
    ).toBe(false);
  },
);
