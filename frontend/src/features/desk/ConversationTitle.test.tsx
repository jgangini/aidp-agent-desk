import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConversationTitle } from "./ConversationTitle";

afterEach(cleanup);
it("edits a trimmed name, rejects empty names and cancels without saving", () => {
  const rename = vi.fn();
  const { rerender } = render(
    <ConversationTitle title="Nombre original" onRename={rename} />,
  );
  const edit = screen.getByRole("button", {
    name: "Editar nombre de la conversación",
  });
  expect(edit.querySelector("svg.lucide-pencil")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Nombre original" }));
  const input = screen.getByRole("textbox", {
    name: "Nombre de la conversación",
  });
  expect(document.activeElement).toBe(input);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(edit.querySelector(".t-icon-swap")?.getAttribute("data-state")).toBe(
    "b",
  );
  fireEvent.change(input, { target: { value: "   " } });
  expect(
    (
      screen.getByRole("button", {
        name: "Guardar nombre",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.submit(input.closest("form")!);
  expect(rename).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "  Investigación D1  " } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar nombre" }));
  expect(rename).toHaveBeenCalledExactlyOnceWith("Investigación D1");
  rerender(<ConversationTitle title="Investigación D1" onRename={rename} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Editar nombre de la conversación" }),
  );
  const changed = screen.getByRole("textbox", {
    name: "Nombre de la conversación",
  });
  fireEvent.change(changed, { target: { value: "Descartar cambio" } });
  fireEvent.keyDown(changed, { key: "Escape" });
  expect(
    screen.getByRole("heading", { name: "Investigación D1" }),
  ).toBeTruthy();
  expect(rename).toHaveBeenCalledTimes(1);
});
