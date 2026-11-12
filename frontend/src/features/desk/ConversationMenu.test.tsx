import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConversationMenu } from "./ConversationMenu";

afterEach(cleanup);

it("starts a conversation directly on click without history or popup semantics", () => {
  const onNew = vi.fn();
  const { container } = render(<ConversationMenu history={[]} onNew={onNew} />);
  const trigger = screen.getByRole("button", { name: "Opciones del chat" });
  expect(trigger.hasAttribute("aria-haspopup")).toBe(false);
  expect(trigger.hasAttribute("aria-expanded")).toBe(false);
  expect(trigger.hasAttribute("aria-controls")).toBe(false);
  fireEvent.click(trigger);
  expect(onNew).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
  expect(container.querySelector('[data-open="true"]')).toBeNull();
});

it("allows native Enter activation and never opens an empty menu with navigation keys", () => {
  const onNew = vi.fn();
  render(<ConversationMenu history={[]} onNew={onNew} />);
  const trigger = screen.getByRole("button", { name: "Opciones del chat" });
  trigger.focus();
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    fireEvent.keyDown(trigger, { key });
    expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
  }
  expect(fireEvent.keyDown(trigger, { key: "Enter" })).toBe(true);
  fireEvent.keyUp(trigger, { key: "Enter" });
  fireEvent.click(trigger, { detail: 0 });
  expect(onNew).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
});

it("retains the menu, new-conversation action and focus behavior when history exists", () => {
  const onNew = vi.fn();
  const onSelect = vi.fn();
  render(
    <ConversationMenu
      history={[{ id: "one", title: "Consulta anterior" }]}
      selected="one"
      onNew={onNew}
      onSelect={onSelect}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Opciones del chat" });
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  const menu = screen.getByRole("menu", { name: "Conversaciones" });
  expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  const create = screen.getByRole("menuitem", { name: "Nueva conversación" });
  expect(screen.getByRole("heading", { name: "Conversaciones" })).toBeTruthy();
  expect(menu.lastElementChild).toBe(create);
  expect(onNew).not.toHaveBeenCalled();
  const previous = screen.getByRole("menuitem", { name: "Consulta anterior" });
  expect(document.activeElement).toBe(previous);
  expect(previous.getAttribute("aria-current")).toBe("page");
  expect(previous.hasAttribute("title")).toBe(false);
  expect(previous.closest('[data-tooltip-disabled="true"]')).not.toBeNull();
  fireEvent.keyDown(previous, { key: "ArrowDown" });
  expect(document.activeElement).toBe(create);
  fireEvent.click(previous);
  expect(onSelect).toHaveBeenCalledWith("one");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(screen.getByRole("menu", { name: "Conversaciones" })).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "Nueva conversación" }));
  expect(onNew).toHaveBeenCalledTimes(1);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("closes and removes the popup if history becomes empty, without reopening on later history", () => {
  const onNew = vi.fn();
  const history = [{ id: "one", title: "Anterior" }];
  const { rerender } = render(
    <ConversationMenu history={history} onNew={onNew} />,
  );
  const trigger = screen.getByRole("button", { name: "Opciones del chat" });
  fireEvent.click(trigger);
  expect(screen.getByRole("menu")).toBeTruthy();
  rerender(<ConversationMenu history={[]} onNew={onNew} />);
  expect(screen.queryByRole("menu", { hidden: true })).toBeNull();
  expect(trigger.hasAttribute("aria-expanded")).toBe(false);
  expect(document.activeElement).toBe(trigger);
  rerender(<ConversationMenu history={history} onNew={onNew} />);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("menu")).toBeNull();
});

it.each([1, 5, 6, 12])(
  "keeps New outside the capped history list with %i conversations",
  (count) => {
    render(
      <ConversationMenu
        history={Array.from({ length: count }, (_, index) => ({
          id: String(index),
          title: `Chat ${index}`,
        }))}
        onNew={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Opciones del chat" }));
    const menu = screen.getByRole("menu", { name: "Conversaciones" });
    const list = menu.querySelector(".history-items")!;
    expect(list.children).toHaveLength(count);
    expect(list.getAttribute("data-scrollable")).toBe(String(count > 5));
    const create = screen.getByRole("menuitem", { name: "Nueva conversación" });
    expect(list.contains(create)).toBe(false);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(create);
  },
);

it("requires confirmation and restores focus on cancel before deleting the chosen conversation", () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
  const onDelete = vi.fn();
  const onSelect = vi.fn();
  render(
    <ConversationMenu
      history={[{ id: "one", title: "Anterior" }]}
      onNew={vi.fn()}
      onSelect={onSelect}
      onDelete={onDelete}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Opciones del chat" });
  fireEvent.click(trigger);
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Eliminar conversación: Anterior" }),
  );
  expect(
    screen.getByRole("dialog", { name: "¿Eliminar conversación?" }),
  ).toBeTruthy();
  const description = screen.getByRole("dialog").querySelector("p")!;
  expect(description.querySelector(".history-delete-name")?.textContent).toBe(
    "Anterior",
  );
  expect(description.textContent).toBe(
    "Se eliminará del historial de este navegador la conversación Anterior. Esta acción no se puede deshacer.",
  );
  expect(onSelect).not.toHaveBeenCalled();
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(document.activeElement).toBe(trigger);
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Eliminar conversación: Anterior" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
  expect(onDelete).toHaveBeenCalledExactlyOnceWith("one");
});
