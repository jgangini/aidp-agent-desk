import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AgentPicker } from "./AgentPicker";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const choices = [
  { id: "demo", name: "Demo" },
  { id: "remote", name: "Publicado" },
];

it("keeps keyboard selection, selected check and focus with a manual popover", () => {
  const select = vi.fn();
  const { container } = render(
    <AgentPicker choices={choices} selected="demo" onSelect={select} />,
  );
  const trigger = screen.getByRole("combobox", { name: "Elegir agente" });
  fireEvent.keyDown(trigger, { key: "End" });
  const menu = screen.getByRole("listbox", { name: "Agentes disponibles" });
  expect(menu.getAttribute("popover")).toBe("manual");
  expect(menu.style.getPropertyValue("position-anchor")).toBe(
    trigger.style.getPropertyValue("anchor-name"),
  );
  expect(
    screen.getByRole("option", { name: "Demo" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    container.querySelector('[aria-selected="true"] svg.lucide-check'),
  ).not.toBeNull();
  expect(trigger.getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("option", { name: "Publicado" }).id,
  );
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(select).toHaveBeenCalledWith("remote");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("closes with Escape, outside pointer and focus leaving the picker", () => {
  render(<AgentPicker choices={choices} selected="demo" />);
  const trigger = screen.getByRole("combobox", { name: "Elegir agente" });
  fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  fireEvent.blur(trigger, { relatedTarget: document.body });
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("fits all three options above a bottom trigger and returns below when there is room", () => {
  const { container } = render(
    <AgentPicker
      choices={[...choices, { id: "test", name: "Prueba" }]}
      selected="demo"
    />,
  );
  const trigger = screen.getByRole("combobox", { name: "Elegir agente" });
  const popup = container.querySelector<HTMLDivElement>(".agent-picker-menu")!;
  Object.defineProperty(popup, "scrollHeight", { value: 150 });
  const bounds = vi.spyOn(trigger, "getBoundingClientRect");
  bounds.mockReturnValue({
    top: innerHeight - 50,
    bottom: innerHeight - 20,
    left: 20,
  } as DOMRect);

  fireEvent.click(trigger);

  expect(popup.dataset.placement).toBe("above");
  expect(popup.style.getPropertyValue("--agent-picker-bottom")).toBe("56px");
  expect(
    Number.parseFloat(popup.style.getPropertyValue("--agent-picker-height")),
  ).toBeGreaterThan(152);
  expect(screen.getAllByRole("option")).toHaveLength(3);

  bounds.mockReturnValue({ top: 60, bottom: 90, left: 20 } as DOMRect);
  fireEvent.resize(window);

  expect(popup.dataset.placement).toBe("below");
  expect(popup.style.getPropertyValue("--agent-picker-top")).toBe("96px");
});
