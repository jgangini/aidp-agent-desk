import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ScheduledDateField } from "./ScheduledDateField";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps native date editing and renders leap days without a timezone conversion", () => {
  const change = vi.fn();
  render(
    <ScheduledDateField
      label="Fecha de inicio"
      value="2028-02-29"
      onChange={change}
    />,
  );
  const input = screen.getByLabelText("Fecha de inicio");
  expect(input.getAttribute("type")).toBe("date");
  expect(
    screen
      .getByRole("button", { name: /martes, 29 de febrero de 2028/i })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.change(input, { target: { value: "2028-03-01" } });
  expect(change).toHaveBeenCalledWith("2028-03-01");
});

it("honors the minimum, navigates months and clears through the calendar", () => {
  const change = vi.fn();
  render(
    <ScheduledDateField
      label="Fecha de fin"
      value="2028-02-29"
      min="2028-02-20"
      onChange={change}
    />,
  );
  const earlier = screen.getByRole("button", {
    name: /sábado, 19 de febrero de 2028/i,
  });
  expect((earlier as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(earlier);
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Mes siguiente" }));
  fireEvent.click(
    screen.getByRole("button", { name: /miércoles, 1 de marzo de 2028/i }),
  );
  expect(change).toHaveBeenCalledWith("2028-03-01");
  fireEvent.click(screen.getByRole("button", { name: "Borrar" }));
  expect(change).toHaveBeenLastCalledWith("");
});

it("stops calendar Escape before the scheduled panel cancels its draft", () => {
  const parent = vi.fn();
  render(
    <div onKeyDown={parent}>
      <ScheduledDateField label="Fecha" value="2028-02-29" onChange={vi.fn()} />
    </div>,
  );
  const popup = screen.getByRole("dialog", { name: "Calendario: Fecha" });
  const hide = vi.fn();
  Object.defineProperty(popup, "hidePopover", { value: hide });
  fireEvent.keyDown(
    screen.getByRole("button", { name: /martes, 29 de febrero de 2028/i }),
    { key: "Escape" },
  );
  expect(parent).not.toHaveBeenCalled();
  expect(hide).toHaveBeenCalled();
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Abrir calendario: Fecha" }),
  );
});

it("moves keyboard focus across a month boundary without selecting a date", async () => {
  const change = vi.fn();
  render(
    <ScheduledDateField label="Fecha" value="2028-02-29" onChange={change} />,
  );
  const selected = screen.getByRole("button", {
    name: /martes, 29 de febrero de 2028/i,
  });
  fireEvent.keyDown(selected, { key: "ArrowRight" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /miércoles, 1 de marzo de 2028/i }),
    ),
  );
  expect(change).not.toHaveBeenCalled();
});
