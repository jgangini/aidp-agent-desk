import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AccountGate } from "../../shared/AccountGate";
import { AccountMenu } from "./AccountMenu";
import {
  apiFetch,
  useIdentity,
  setStoragePrincipal,
} from "../../shared/identity";
import { readChatStorage, writeChatStorage } from "./chatStorage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setStoragePrincipal("");
  sessionStorage.clear();
});
function Content() {
  const identity = useIdentity();
  return (
    <>
      <button onClick={identity.openAccount}>Perfil</button>
      <AccountMenu />
    </>
  );
}
it("gates the application before authentication and uses Oracle only", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ mode: "oracle", user: null })),
      ),
  );
  render(
    <AccountGate>
      <Content />
    </AccountGate>,
  );
  expect(screen.queryByText("Perfil")).toBeNull();
  expect(await screen.findByText("Continuar con Oracle")).toBeTruthy();
  expect(document.querySelector(".account-header")).toBeNull();
  expect(document.querySelector(".account-hero .desk-wordmark")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Agent Desk" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Inicia sesión" })).toBeNull();
  expect(document.querySelector("form")?.getAttribute("action")).toBe(
    "/api/auth/login",
  );
  expect(document.querySelector("form")?.getAttribute("method")).toBe("post");
  expect(document.querySelector('input[type="email"]')).toBeNull();
  expect(document.querySelector('input[type="password"]')).toBeNull();
});
it("opens the profile while keeping the conversation mounted", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          mode: "oracle",
          user: { id: "u1", role: "member", email: "m@example.com" },
        }),
      ),
    ),
  );
  render(
    <AccountGate>
      <Content />
    </AccountGate>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Perfil" }));
  expect(
    await screen.findByRole("heading", { name: "Mi cuenta" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "Perfil", hidden: true })
      .closest("[hidden]"),
  ).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Ir al inicio"));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Perfil", hidden: true })
        .closest("[hidden]"),
    ).toBeNull(),
  );
});
it("keeps the login button available while focus rechecks an anonymous session", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ mode: "oracle", user: null })),
    );
  vi.stubGlobal("fetch", request);
  render(
    <AccountGate>
      <Content />
    </AccountGate>,
  );
  const button = await screen.findByRole("button", {
    name: "Continuar con Oracle",
  });
  let finish!: (response: Response) => void;
  request.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.focus(window);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("button", { name: "Continuar con Oracle" })).toBe(
    button,
  );
  expect(button.closest("form")?.getAttribute("action")).toBe(
    "/api/auth/login",
  );
  finish(new Response(JSON.stringify({ mode: "oracle", user: null })));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
});

it("keeps the first click available during revalidation and blocks content if it fails", async () => {
  const request = vi.fn().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        mode: "oracle",
        user: { id: "u1", role: "member", email: "m@example.com" },
      }),
    ),
  );
  vi.stubGlobal("fetch", request);
  render(
    <AccountGate>
      <Content />
    </AccountGate>,
  );
  await screen.findByRole("button", { name: "Perfil" });
  let rejectCheck!: (reason: Error) => void;
  request.mockImplementation(
    () =>
      new Promise<Response>((_resolve, reject) => {
        rejectCheck = reject;
      }),
  );
  fireEvent.focus(window);
  fireEvent.focus(window);
  expect(request).toHaveBeenCalledTimes(2);
  const profile = screen.getByRole("button", { name: "Perfil" });
  fireEvent.click(profile);
  expect(
    await screen.findByRole("heading", { name: "Mi cuenta" }),
  ).toBeTruthy();
  rejectCheck(new Error("offline"));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "No se pudo comprobar la sesión",
    ),
  );
  expect(screen.queryByRole("button", { name: "Perfil" })).toBeNull();
});
it("offers logout in the account dropdown and preserves the session on failure", async () => {
  const request = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        mode: "oracle",
        user: { id: "u1", role: "member", email: "m@example.com" },
      }),
    ),
  );
  vi.stubGlobal("fetch", request);
  render(
    <AccountGate>
      <Content />
    </AccountGate>,
  );
  const trigger = await screen.findByLabelText("Mi cuenta");
  fireEvent.click(trigger);
  expect(screen.queryByRole("heading", { name: "Mi cuenta" })).toBeNull();
  request.mockResolvedValueOnce(new Response("{}", { status: 500 }));
  expect(screen.getByRole("menu", { name: "Perfil" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Mi cuenta" })).toBe(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name: "Cerrar sesión" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "No se pudo cerrar la sesión",
  );
  expect(request.mock.calls[1][0]).toBe("/api/auth/logout");
  expect(request.mock.calls[1][1].method).toBe("POST");
  expect(
    new Headers(request.mock.calls[1][1].headers).get("X-Agent-Desk-User"),
  ).toBe("u1");
  expect(
    screen.getByRole("button", { name: "Perfil", hidden: true }),
  ).toBeTruthy();
});
it("keeps local and tenant user history in distinct storage namespaces", () => {
  writeChatStorage("draft", "local");
  setStoragePrincipal("u1");
  expect(readChatStorage("draft")).toBeUndefined();
  writeChatStorage("draft", "first");
  setStoragePrincipal("u2");
  expect(readChatStorage("draft")).toBeUndefined();
  writeChatStorage("draft", "second");
  setStoragePrincipal("u1");
  expect(readChatStorage("draft")).toBe("first");
  setStoragePrincipal("");
  expect(readChatStorage("draft")).toBe("local");
});

it("keeps user administration out of the account page", async () => {
  const request = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        mode: "oracle",
        user: { id: "admin", email: "admin@example.com", role: "admin" },
      }),
    ),
  );
  vi.stubGlobal("fetch", request);
  render(
    <AccountGate>
      <Content />
    </AccountGate>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Perfil" }));
  await screen.findByRole("heading", { name: "Mi cuenta" });
  expect(screen.queryByRole("heading", { name: "Usuarios" })).toBeNull();
  expect(screen.queryByLabelText("Correo electrónico")).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
});
it("binds hosted requests to the rendered user and rejects a changed session", async () => {
  setStoragePrincipal("u1");
  const request = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", request);
  await apiFetch("/api/desk/profiles");
  expect(
    new Headers(request.mock.calls[0][1].headers).get("X-Agent-Desk-User"),
  ).toBe("u1");
  const changed = vi.fn();
  window.addEventListener("agent-desk-session-changed", changed);
  request.mockResolvedValueOnce(new Response("{}", { status: 409 }));
  await expect(apiFetch("/api/desk/profiles")).rejects.toThrow(
    "La cuenta cambi\u00f3",
  );
  expect(changed).toHaveBeenCalledOnce();
  window.removeEventListener("agent-desk-session-changed", changed);
});
