import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IdentityContext } from "../../shared/identity";
import { AccountMenu } from "./AccountMenu";

afterEach(cleanup);

it("offers only logout in a profile morph menu with keyboard and outside dismissal", () => {
  const logout = vi.fn(async () => {});
  const openAccount = vi.fn();
  render(
    <IdentityContext.Provider
      value={{
        hosted: true,
        admin: false,
        authenticated: true,
        leaving: false,
        logout,
        openAccount,
      }}
    >
      <AccountMenu />
    </IdentityContext.Provider>,
  );
  const trigger = screen.getByRole("button", { name: "Mi cuenta" });
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const menu = screen.getByRole("menu", { name: "Perfil" });
  const action = screen.getByRole("menuitem", { name: "Cerrar sesión" });
  expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
  expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(1);
  expect(document.activeElement).toBe(action);
  expect(openAccount).not.toHaveBeenCalled();
  fireEvent.keyDown(action, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  fireEvent.click(action);
  expect(logout).toHaveBeenCalledOnce();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("keeps sign-in available without a session", () => {
  const openAccount = vi.fn();
  render(
    <IdentityContext.Provider
      value={{
        hosted: false,
        admin: true,
        authenticated: false,
        leaving: false,
        logout: async () => {},
        openAccount,
      }}
    >
      <AccountMenu />
    </IdentityContext.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Mi cuenta" }));
  expect(openAccount).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
});

it("disables logout while a request is in progress", () => {
  const logout = vi.fn(async () => {});
  render(
    <IdentityContext.Provider
      value={{
        hosted: true,
        admin: false,
        authenticated: true,
        leaving: true,
        logout,
        openAccount: () => {},
      }}
    >
      <AccountMenu />
    </IdentityContext.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Mi cuenta" }));
  const action = screen.getByRole("menuitem", {
    name: "Cerrando sesión…",
  }) as HTMLButtonElement;
  expect(action.disabled).toBe(true);
  fireEvent.click(action);
  expect(logout).not.toHaveBeenCalled();
});

it("offers Usuarios above logout only to an authenticated hosted administrator", () => {
  const onUsers = vi.fn();
  const tree = (hosted: boolean, admin: boolean) => (
    <IdentityContext.Provider
      value={{
        hosted,
        admin,
        authenticated: true,
        leaving: false,
        logout: async () => {},
        openAccount: () => {},
      }}
    >
      <AccountMenu onUsers={onUsers} />
    </IdentityContext.Provider>
  );
  const { rerender } = render(tree(true, true));
  const trigger = screen.getByRole("button", { name: "Mi cuenta" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const actions = screen.getAllByRole("menuitem");
  expect(actions.map((action) => action.textContent)).toEqual([
    "Usuarios",
    "Cerrar sesión",
  ]);
  expect(document.activeElement).toBe(actions[0]);
  fireEvent.click(actions[0]);
  expect(onUsers).toHaveBeenCalledOnce();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  rerender(tree(true, false));
  fireEvent.click(trigger);
  expect(screen.queryByRole("menuitem", { name: "Usuarios" })).toBeNull();
  rerender(tree(false, true));
  expect(screen.queryByRole("menuitem", { name: "Usuarios" })).toBeNull();
});
