import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScheduledPanel } from "./ScheduledPanel";
import { loadScheduledTasks } from "./scheduledTasks";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => localStorage.clear());
function create(name = "Noticias") {
  fireEvent.click(screen.getByRole("button", { name: "Nueva tarea" }));
  fireEvent.change(screen.getByLabelText("Nombre de la tarea"), {
    target: { value: name },
  });
  fireEvent.change(screen.getByLabelText("Instrucciones"), {
    target: { value: "Investiga las noticias y cita las fuentes." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
}
it("creates, persists, edits and pauses/resumes a task without executing it", () => {
  render(<ScheduledPanel onClose={() => {}} />);
  create();
  expect(loadScheduledTasks().store.tasks[0]).toMatchObject({
    id: "0001",
    name: "Noticias",
    status: "active",
  });
  fireEvent.click(screen.getByRole("button", { name: "Editar Noticias" }));
  fireEvent.change(screen.getByLabelText("Nombre de la tarea"), {
    target: { value: "Noticias actualizadas" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Pausar Noticias actualizadas" }),
  );
  fireEvent.click(screen.getByRole("tab", { name: "En pausa" }));
  expect(
    screen.getByRole("heading", { name: "Noticias actualizadas" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Activar Noticias actualizadas" }),
  );
  expect(loadScheduledTasks().store.tasks[0].status).toBe("active");
  expect(loadScheduledTasks().store.nextId).toBe(2);
});
it("deletes with undo and keeps monotonic IDs after deletion", () => {
  render(<ScheduledPanel onClose={() => {}} />);
  create();
  fireEvent.click(screen.getByRole("button", { name: "Eliminar Noticias" }));
  expect(loadScheduledTasks().store.tasks).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
  expect(loadScheduledTasks().store.tasks).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Eliminar Noticias" }));
  create("Otra tarea");
  expect(loadScheduledTasks().store.tasks[0].id).toBe("0002");
});
it("restores tasks without recommendations, empty messages or fake report actions", () => {
  const view = render(<ScheduledPanel onClose={() => {}} />);
  expect(screen.queryByText("Tareas del agente")).toBeNull();
  expect(screen.queryByText("Recomendadas")).toBeNull();
  expect(
    screen.queryByText("Todavía no tienes tareas programadas."),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Nueva tarea" }).querySelector("svg"),
  ).toBeNull();
  create("Informe semanal");
  expect(screen.queryByRole("button", { name: "Ver informes" })).toBeNull();
  view.unmount();
  render(<ScheduledPanel onClose={() => {}} />);
  expect(screen.getByRole("heading", { name: "Informe semanal" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Completadas" }));
  expect(screen.getByRole("tabpanel").textContent).toBe("");
  expect(
    document.querySelector(".config-step-pill")?.getAttribute("style"),
  ).toContain("200%");
});
it("keeps the form on save failure and does not overwrite corrupt data", () => {
  const view = render(<ScheduledPanel onClose={() => {}} />);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  create();
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.getByLabelText("Nombre de la tarea")).toHaveProperty(
    "value",
    "Noticias",
  );
  vi.restoreAllMocks();
  view.unmount();
  localStorage.setItem("agent-desk.scheduled-tasks", "broken");
  render(<ScheduledPanel onClose={() => {}} />);
  expect(screen.getByRole("button", { name: "Nueva tarea" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(localStorage.getItem("agent-desk.scheduled-tasks")).toBe("broken");
});
it("supports keyboard tabs and Escape backs out of form before closing panel", () => {
  const onClose = vi.fn();
  render(<ScheduledPanel onClose={onClose} />);
  fireEvent.keyDown(screen.getByRole("tab", { name: "Activadas" }), {
    key: "ArrowRight",
  });
  expect(
    screen.getByRole("tab", { name: "En pausa" }).getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Nueva tarea" }));
  fireEvent.keyDown(document.getElementById("scheduled-panel")!, {
    key: "Escape",
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Nueva tarea" })).toBeTruthy();
  fireEvent.keyDown(document.getElementById("scheduled-panel")!, {
    key: "Escape",
  });
  expect(onClose).toHaveBeenCalledOnce();
});

it("counts instruction characters and blocks saving above 500 without truncating an existing draft", () => {
  const onEditingChange = vi.fn();
  render(
    <ScheduledPanel onClose={() => {}} onEditingChange={onEditingChange} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Nueva tarea" }));
  expect(onEditingChange).toHaveBeenLastCalledWith(true);
  expect(screen.queryByLabelText("Notificar al finalizar")).toBeNull();
  expect(
    document.querySelector(".scheduled-intro,.scheduled-stage-note"),
  ).toBeNull();
  fireEvent.change(screen.getByLabelText("Nombre de la tarea"), {
    target: { value: "Investigación" },
  });
  const input = screen.getByLabelText("Instrucciones");
  const tooLong = "x".repeat(501);
  fireEvent.change(input, { target: { value: tooLong } });
  expect(screen.getByText("501 / 500 caracteres")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  expect(screen.getByRole("alert").textContent).toContain("500 caracteres");
  expect(input).toHaveProperty("value", tooLong);
  expect(loadScheduledTasks().store.tasks).toHaveLength(0);
  fireEvent.change(input, {
    target: { value: "x".repeat(500) },
  });
  expect(screen.getByText("500 / 500 caracteres")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  expect(loadScheduledTasks().store.tasks).toHaveLength(1);
  expect(onEditingChange).toHaveBeenLastCalledWith(false);
});
