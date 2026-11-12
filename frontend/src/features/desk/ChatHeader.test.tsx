import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IdentityContext } from "../../shared/identity";
import { ChatHeader } from "./ChatHeader";

afterEach(cleanup);

const props = {
  configuring: false,
  history: [],
  reset: () => {},
  scheduledOpen: false,
  scheduledEditing: false,
};

it("keeps the configuration action gated by the current identity", () => {
  const onConfigure = vi.fn();
  const tree = (admin: boolean) => (
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
      <ChatHeader {...props} onConfigure={onConfigure} />
    </IdentityContext.Provider>
  );
  const { rerender } = render(tree(false));
  const button = screen.getByRole("button", { name: "Configurar agentes" });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.click(button);
  expect(onConfigure).not.toHaveBeenCalled();
  rerender(tree(true));
  expect(button.hasAttribute("disabled")).toBe(false);
  fireEvent.click(button);
  expect(onConfigure).toHaveBeenCalledOnce();
});

it("preserves configuration and scheduled navigation controls without changing their targets", () => {
  const onConfigure = vi.fn();
  const onScheduled = vi.fn();
  const { container, rerender } = render(
    <ChatHeader
      {...props}
      onConfigure={onConfigure}
      onScheduled={onScheduled}
    />,
  );
  expect(container.firstElementChild?.className).toBe("chat-header");
  expect(screen.getByRole("heading", { name: "Nuevo Chat" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Tareas" }));
  expect(onScheduled).toHaveBeenCalledOnce();

  rerender(
    <ChatHeader
      {...props}
      configuring
      onConfigure={onConfigure}
      onScheduled={onScheduled}
    />,
  );
  expect(screen.getByRole("heading", { name: "Configuración" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Mi cuenta" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Opciones del chat" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Tareas" })).toBeNull();
  const close = screen.getByRole("button", { name: "Cerrar configuración" });
  expect(close.getAttribute("aria-controls")).toBe("agent-config-title");
  expect(close.getAttribute("aria-expanded")).toBe("true");
  expect(close.getAttribute("data-tooltip")).toBe("Cerrar configuración");

  rerender(
    <ChatHeader
      {...props}
      scheduledOpen
      scheduledEditing
      onConfigure={onConfigure}
      onScheduled={onScheduled}
    />,
  );
  expect(screen.getByRole("heading", { name: "Nueva tarea" })).toBeTruthy();
  const back = screen.getByRole("button", { name: "Volver a Tareas" });
  expect(back.getAttribute("aria-controls")).toBe("scheduled-panel");
  fireEvent.click(back);
  expect(onConfigure).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Mi cuenta" })).toBeTruthy();
});

it("routes administrator user management from the account menu", () => {
  const onUsers = vi.fn();
  render(
    <IdentityContext.Provider
      value={{
        hosted: true,
        admin: true,
        authenticated: true,
        leaving: false,
        logout: async () => {},
        openAccount: () => {},
      }}
    >
      <ChatHeader {...props} onUsers={onUsers} />
    </IdentityContext.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Mi cuenta" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Usuarios" }));
  expect(onUsers).toHaveBeenCalledOnce();
});
