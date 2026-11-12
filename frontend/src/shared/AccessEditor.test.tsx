import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AccessEditor } from "./AccessEditor";
import { IdentityContext } from "./identity";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});
const member = {
  id: "member",
  subject: "oracle-sub",
  email: "member@example.com",
  enabled: true,
  role: "member",
  profiles: ["agent-1"],
};
const admin = {
  ...member,
  id: "admin",
  subject: "admin-sub",
  email: "admin@example.com",
  role: "admin",
};
const profile = { id: "agent-1", name: "Análisis" };
function setup({
  allowCreate = false,
  available = true,
  users = [admin, member],
  onWrite = async (_init: RequestInit) => new Response(null, { status: 204 }),
} = {}) {
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST" || init?.method === "PUT") return onWrite(init);
    if (url === "/api/admin/user-management")
      return new Response(
        JSON.stringify({
          directory_available: available,
          allow_create: allowCreate,
        }),
      );
    if (url === "/api/desk/profiles")
      return new Response(JSON.stringify([profile]));
    if (url.startsWith("/api/admin/directory-users?"))
      return new Response("[]");
    return new Response(JSON.stringify(users));
  });
  vi.stubGlobal("fetch", request);
  return request;
}
function panel(hosted = true, authenticated = true, admin = true) {
  return (
    <IdentityContext.Provider
      value={{
        hosted,
        authenticated,
        admin,
        leaving: false,
        logout: async () => {},
        openAccount: () => {},
      }}
    >
      <AccessEditor onClose={() => {}} />
    </IdentityContext.Provider>
  );
}
async function loaded() {
  await waitFor(() =>
    expect(
      screen
        .getByRole("region", { name: "Usuarios" })
        .getAttribute("aria-busy"),
    ).toBe("false"),
  );
}
function openAdd() {
  fireEvent.click(screen.getByRole("button", { name: "Agregar usuario" }));
  return within(screen.getByRole("dialog", { name: "Agregar usuario" }));
}
function openEdit() {
  fireEvent.click(
    screen.getByRole("button", {
      name: "Editar permisos de member@example.com",
    }),
  );
  return within(screen.getByRole("dialog", { name: "Editar permisos" }));
}
const writes = (request: ReturnType<typeof setup>) =>
  request.mock.calls.filter(
    ([, init]) => init?.method === "POST" || init?.method === "PUT",
  );

it("opens adding from Plus immediately before X and keeps the workspace free of an inline form", async () => {
  setup();
  render(panel());
  await loaded();
  const add = screen.getByRole("button", { name: "Agregar usuario" });
  const close = screen.getByRole("button", { name: "Cerrar usuarios" });
  expect(close.previousElementSibling).toBe(add);
  expect(screen.queryByLabelText("Correo electrónico")).toBeNull();
  const editor = openAdd();
  expect(document.activeElement).toBe(
    editor.getByRole("combobox", { name: "Correo electrónico" }),
  );
  expect(editor.getByRole("button", { name: "Guardar" })).toBeTruthy();
  expect(
    screen.queryByText(
      "Usa el correo de una cuenta existente en el dominio Oracle.",
    ),
  ).toBeNull();
  expect(editor.getAllByRole("group", { name: "Agent Flow" })).toHaveLength(2);
});

it.each([false, true])(
  "saves typed email and Agent Flow using server create permission %s",
  async (allowCreate) => {
    const request = setup({ allowCreate });
    render(panel());
    await loaded();
    const add = screen.getByRole("button", { name: "Agregar usuario" });
    const editor = openAdd();
    const email = editor.getByRole("combobox", {
      name: "Correo electrónico",
    }) as HTMLInputElement;
    expect(email.type).toBe("email");
    expect(email.required).toBe(true);
    expect(editor.queryByLabelText("Crear cuenta en Oracle")).toBeNull();
    expect(!!editor.queryByText(/se enviará una invitación/)).toBe(allowCreate);
    fireEvent.change(email, { target: { value: "new@example.com" } });
    fireEvent.click(editor.getByLabelText("Análisis"));
    fireEvent.click(editor.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(JSON.parse(String(writes(request)[0][1]?.body))).toEqual({
      email: "new@example.com",
      profiles: [profile.id],
      create_in_directory: allowCreate,
    });
    expect(document.activeElement).toBe(add);
  },
);

it("requires a valid email before sending the add request", async () => {
  const request = setup();
  render(panel());
  await loaded();
  const editor = openAdd();
  const email = editor.getByRole("combobox", {
    name: "Correo electrónico",
  }) as HTMLInputElement;
  fireEvent.change(email, { target: { value: "not-an-email" } });
  expect(email.closest("form")!.checkValidity()).toBe(false);
  fireEvent.click(editor.getByRole("button", { name: "Guardar" }));
  expect(writes(request)).toHaveLength(0);
});

it("keeps a rejected existing-account request in the modal without claiming an invitation", async () => {
  const request = setup({
    onWrite: async () =>
      new Response(
        JSON.stringify({
          detail: "No existe una cuenta activa con ese correo.",
        }),
        { status: 422 },
      ),
  });
  render(panel());
  await loaded();
  const editor = openAdd();
  fireEvent.change(
    editor.getByRole("combobox", { name: "Correo electrónico" }),
    { target: { value: "missing@example.com" } },
  );
  fireEvent.click(editor.getByRole("button", { name: "Guardar" }));
  expect((await editor.findByRole("alert")).textContent).toContain(
    "No existe una cuenta activa",
  );
  expect(
    (
      editor.getByRole("combobox", {
        name: "Correo electrónico",
      }) as HTMLInputElement
    ).value,
  ).toBe("missing@example.com");
  expect(editor.queryByText(/invitación/)).toBeNull();
  expect(writes(request)).toHaveLength(1);
});

it("keeps existing members editable when directory adding is unavailable", async () => {
  const request = setup({ available: false });
  render(panel());
  await loaded();
  expect(
    (
      screen.getByRole("button", {
        name: "Agregar usuario",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  const editor = openEdit();
  expect(
    (editor.getByLabelText("Correo electrónico") as HTMLInputElement).readOnly,
  ).toBe(true);
  fireEvent.change(editor.getByRole("combobox", { name: "Acceso" }), {
    target: { value: "disabled" },
  });
  fireEvent.click(editor.getByLabelText("Análisis"));
  fireEvent.click(editor.getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(JSON.parse(String(writes(request)[0][1]?.body))).toEqual({
    subject: member.subject,
    email: member.email,
    enabled: false,
    profiles: [],
  });
});

it.each([true, false])(
  "submits the selected edit access value %s and restores pencil focus",
  async (enabled) => {
    const request = setup({ users: [admin, { ...member, enabled: !enabled }] });
    render(panel());
    await loaded();
    const trigger = screen.getByRole("button", {
      name: "Editar permisos de member@example.com",
    });
    const editor = openEdit();
    fireEvent.change(editor.getByRole("combobox", { name: "Acceso" }), {
      target: { value: enabled ? "enabled" : "disabled" },
    });
    fireEvent.click(editor.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(JSON.parse(String(writes(request)[0][1]?.body)).enabled).toBe(
      enabled,
    );
  },
);

it.each([
  ["add", "cancel"],
  ["add", "escape"],
  ["edit", "cancel"],
  ["edit", "escape"],
])(
  "preserves table context and performs no write on %s %s",
  async (kind, action) => {
    const request = setup();
    render(panel());
    await loaded();
    const table = screen.getByRole("table", { name: "Usuarios" });
    const trigger = screen.getByRole("button", {
      name:
        kind === "add"
          ? "Agregar usuario"
          : "Editar permisos de member@example.com",
    });
    const editor = kind === "add" ? openAdd() : openEdit();
    const modal = screen.getByRole("dialog");
    fireEvent.click(editor.getByLabelText("Análisis"));
    if (action === "cancel")
      fireEvent.click(editor.getByRole("button", { name: "Cancelar" }));
    else fireEvent(modal, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("table", { name: "Usuarios" })).toBe(table);
    expect(document.activeElement).toBe(trigger);
    expect(writes(request)).toHaveLength(0);
  },
);

it.each(["add", "edit"])(
  "blocks dismissal and duplicate writes while %s is saving",
  async (kind) => {
    let finish!: (response: Response) => void;
    const request = setup({
      onWrite: () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    });
    render(panel());
    await loaded();
    const editor = kind === "add" ? openAdd() : openEdit();
    if (kind === "add")
      fireEvent.change(
        editor.getByRole("combobox", { name: "Correo electrónico" }),
        { target: { value: "new@example.com" } },
      );
    const modal = screen.getByRole("dialog");
    fireEvent.click(editor.getByRole("button", { name: "Guardar" }));
    expect(
      (
        editor.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement
      ).matches(":disabled"),
    ).toBe(true);
    expect(
      (editor.getByLabelText("Análisis") as HTMLInputElement).matches(
        ":disabled",
      ),
    ).toBe(true);
    fireEvent(modal, new Event("cancel", { cancelable: true }));
    fireEvent.click(editor.getByRole("button", { name: "Guardando…" }));
    expect(screen.getByRole("dialog")).toBe(modal);
    expect(writes(request)).toHaveLength(1);
    finish(new Response(null, { status: 204 }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  },
);

it("keeps failed edit values in the modal for correction or retry", async () => {
  setup({
    onWrite: async () =>
      new Response(
        JSON.stringify({ detail: "No se pudieron guardar los permisos." }),
        { status: 503 },
      ),
  });
  render(panel());
  await loaded();
  const editor = openEdit();
  fireEvent.change(editor.getByRole("combobox", { name: "Acceso" }), {
    target: { value: "disabled" },
  });
  fireEvent.click(editor.getByRole("button", { name: "Guardar" }));
  await editor.findByRole("alert");
  expect(
    (editor.getByRole("combobox", { name: "Acceso" }) as HTMLSelectElement)
      .value,
  ).toBe("disabled");
  expect(
    (
      editor.getByRole("button", { name: "Guardar" }) as HTMLButtonElement
    ).matches(":disabled"),
  ).toBe(false);
});

it.each(["add", "edit"])(
  "reports saved %s separately from failed refresh and retries without writing again",
  async (kind) => {
    const request = setup();
    render(panel());
    await loaded();
    const editor = kind === "add" ? openAdd() : openEdit();
    if (kind === "add")
      fireEvent.change(
        editor.getByRole("combobox", { name: "Correo electrónico" }),
        { target: { value: "new@example.com" } },
      );
    request.mockImplementation(async (_url, init) =>
      init?.method === "PUT" || init?.method === "POST"
        ? new Response(null, { status: 204 })
        : new Response("{}", { status: 503 }),
    );
    fireEvent.click(editor.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("alert").textContent).toContain(
      "Los permisos se guardaron, pero no se pudo actualizar la lista",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reintentar carga" }));
    await screen.findByText(
      "No se pudo actualizar la lista de usuarios. Reintenta la carga.",
    );
    expect(writes(request)).toHaveLength(1);
  },
);

it.each([
  [true, true, false],
  [false, true, true],
  [true, false, true],
])(
  "does not load or display management outside authenticated hosted administration (%s, %s, %s)",
  (hosted, authenticated, admin) => {
    const request = setup();
    render(panel(hosted, authenticated, admin));
    expect(screen.queryByRole("region", { name: "Usuarios" })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  },
);

it("retains the accessible table and keeps missing email subjects internal", async () => {
  const request = setup({ users: [admin, { ...member, email: "" }] });
  render(panel());
  await loaded();
  const table = screen.getByRole("table", { name: "Usuarios" });
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent),
  ).toEqual(["Usuario", "Acceso", "Agentes", "Acciones"]);
  expect(screen.queryByText(member.subject)).toBeNull();
  expect(
    screen.queryByRole("button", {
      name: "Editar permisos de admin@example.com",
    }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Editar permisos de Cuenta sin correo",
    }),
  );
  const editor = within(screen.getByRole("dialog"));
  const email = editor.getByLabelText("Correo electrónico") as HTMLInputElement;
  expect(email.readOnly).toBe(true);
  expect(email.closest("form")!.checkValidity()).toBe(true);
  fireEvent.click(editor.getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(JSON.parse(String(writes(request)[0][1]?.body))).toMatchObject({
    subject: member.subject,
    email: "",
  });
});
