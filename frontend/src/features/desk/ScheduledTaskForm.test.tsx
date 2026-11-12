import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScheduledTaskForm } from "./ScheduledTaskForm";
import type { ScheduledTask } from "./scheduledTasks";

afterEach(cleanup);
function setup(overrides: Partial<ScheduledTask> = {}, error?: string) {
  const task: ScheduledTask = {
    id: "0001",
    name: "Informe",
    instructions: "Revisar resultados.",
    agentId: "demo",
    agentName: "Demo",
    notify: false,
    repeat: "once",
    startDate: "2026-11-10",
    time: "09:00",
    timeZone: "America/Lima",
    days: [],
    monthDay: 10,
    interval: 1,
    unit: "days",
    endDate: "",
    status: "active",
    createdAt: "2026-11-09T12:00:00.000Z",
    ...overrides,
  };
  const onSave = vi.fn();
  render(
    <ScheduledTaskForm
      task={task}
      agents={[
        { id: "demo", name: "Demo" },
        { id: "test:profile", name: "Agente TEST" },
      ]}
      onSave={onSave}
      error={error}
    />,
  );
  const change = (name: string, value: string) =>
    fireEvent.change(screen.getByLabelText(name), { target: { value } });
  const save = () =>
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  return { task, onSave, change, save };
}

it("submits edited metadata and explicit selected agent without mutating the original task", () => {
  const { task, change, save, onSave } = setup({ notify: true });
  change("Nombre de la tarea", "Resumen diario");
  change("Instrucciones", "Consultar las fuentes seleccionadas.");
  change("Agent Flow", "test:profile");
  change("Hora", "10:30");
  change("Zona horaria", "UTC");
  expect(screen.queryByLabelText("Notificar al finalizar")).toBeNull();
  save();
  expect(onSave).toHaveBeenCalledExactlyOnceWith({
    ...task,
    name: "Resumen diario",
    instructions: "Consultar las fuentes seleccionadas.",
    agentId: "test:profile",
    agentName: "Agente TEST",
    time: "10:30",
    timeZone: "UTC",
    notify: true,
  });
  expect(task.name).toBe("Informe");
  expect(task.days).toEqual([]);
});

it("shows a localized validation error without invoking save and exposes incoming save errors", () => {
  const { change, save, onSave } = setup({}, "No se pudo guardar.");
  expect(screen.getByRole("alert").textContent).toContain("No se pudo guardar");
  change("Nombre de la tarea", " ");
  save();
  expect(screen.getByRole("alert").textContent).toContain("120 caracteres");
  expect(onSave).not.toHaveBeenCalled();
  change("Nombre de la tarea", "Nombre válido");
  change("Zona horaria", "Unknown/Zone");
  save();
  expect(screen.getByRole("alert").textContent).toContain(
    "zona horaria válida",
  );
  expect(onSave).not.toHaveBeenCalled();
});

it("provides valid weekday defaults and switches weekly choices to one radio day", () => {
  const { change, save, onSave } = setup();
  change("Repetir", "weekdays");
  expect(screen.getByLabelText("Lunes").getAttribute("type")).toBe("checkbox");
  for (const day of ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"])
    expect((screen.getByLabelText(day) as HTMLInputElement).checked).toBe(true);
  change("Repetir", "weekly");
  expect(screen.getByLabelText("Lunes").getAttribute("type")).toBe("radio");
  fireEvent.click(screen.getByLabelText("Domingo"));
  save();
  expect(onSave.mock.calls[0][0]).toMatchObject({
    repeat: "weekly",
    days: [0],
  });
});

it("shows only recurrence-specific controls and preserves custom interval and end date data", () => {
  const { change, save, onSave } = setup();
  expect(screen.queryByLabelText("Finalizar")).toBeNull();
  change("Repetir", "monthly");
  change("Día del mes", "31");
  expect(screen.queryByLabelText("Cada")).toBeNull();
  change("Repetir", "custom");
  expect(screen.queryByLabelText("Día del mes")).toBeNull();
  change("Cada", "3");
  change("Unidad", "hours");
  change("Finalizar", "date");
  change("Fecha de fin", "2026-12-01");
  save();
  expect(onSave.mock.calls[0][0]).toMatchObject({
    repeat: "custom",
    interval: 3,
    unit: "hours",
    monthDay: 31,
    endDate: "2026-12-01",
  });
  change("Finalizar", "never");
  expect(screen.queryByLabelText("Fecha de fin")).toBeNull();
  change("Repetir", "once");
  save();
  expect(onSave.mock.lastCall?.[0]).toMatchObject({
    repeat: "once",
    endDate: "",
  });
});

it("does not silently change a selected end-date mode to never when its date is cleared", () => {
  const { change, save, onSave } = setup({ repeat: "daily" });
  change("Finalizar", "date");
  change("Fecha de fin", "");
  expect(screen.getByLabelText("Fecha de fin")).toBeTruthy();
  save();
  expect(screen.getByRole("alert").textContent).toContain(
    "fecha de fin válida",
  );
  expect(onSave).not.toHaveBeenCalled();
});

it("retains an unavailable captured agent until an explicit choice", () => {
  const { save, onSave } = setup({
    agentId: "test:removed",
    agentName: "Agente anterior",
  });
  expect(
    screen.getByRole("option", { name: "Agente anterior (no disponible)" }),
  ).toBeTruthy();
  save();
  expect(onSave.mock.calls[0][0]).toMatchObject({
    agentId: "test:removed",
    agentName: "Agente anterior",
  });
});
