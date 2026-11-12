import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SuggestionsEditor } from "./SuggestionsEditor";
import { sampleSuggestions, suggestionsChanged } from "./suggestions";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const item = { title: "Pregunta", query: "Consulta" };
const response = (items: unknown[], ok = true) => ({
  ok,
  json: async () => ({ items }),
});

it("samples without mutating or duplicating saved suggestions", () => {
  const items = [
    item,
    { title: "Otra", query: "Segunda" },
    { title: "Tercera", query: "Consulta tres" },
  ];
  const shuffled = sampleSuggestions(items, () => 0);
  expect(shuffled).not.toEqual(items);
  expect(new Set(shuffled).size).toBe(3);
  expect(items[0]).toBe(item);
});

it("edits and saves rows independently, including clearing all", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response([item]))
    .mockResolvedValueOnce(response([{ ...item, title: "Editada" }]))
    .mockResolvedValueOnce(response([]));
  vi.stubGlobal("fetch", fetcher);
  const listener = vi.fn();
  window.addEventListener(suggestionsChanged, listener);
  render(<SuggestionsEditor profiles={[]} selected="demo" />);
  const title = await screen.findByLabelText("Título 1");
  expect(screen.getByLabelText("Consulta 1").tagName).toBe("INPUT");
  expect(screen.queryByText(/Agrega hasta 30 consultas/)).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Agregar sugerencia" })
      .querySelector("svg.lucide-plus"),
  ).not.toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Eliminar sugerencia 1" })
      .querySelector("svg.lucide-trash-2"),
  ).not.toBeNull();
  fireEvent.change(title, { target: { value: "Editada" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await screen.findByText("Sugerencias guardadas.");
  expect(JSON.parse(fetcher.mock.calls[1][1].body).items[0].title).toBe(
    "Editada",
  );
  expect(listener).toHaveBeenCalledOnce();
  fireEvent.click(
    screen.getByRole("button", { name: "Eliminar sugerencia 1" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ items: [] });
  window.removeEventListener(suggestionsChanged, listener);
});

it("keeps edits available after a failed save and permits retry", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response([item]))
      .mockResolvedValueOnce(response([], false))
      .mockResolvedValueOnce(response([item])),
  );
  render(<SuggestionsEditor profiles={[]} selected="demo" />);
  await screen.findByLabelText("Título 1");
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("Título 1") as HTMLInputElement).disabled).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await screen.findByText("Sugerencias guardadas.");
});

it("does not publish a late save after leaving the editor", async () => {
  let finish!: (value: ReturnType<typeof response>) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response([item]))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  vi.stubGlobal("fetch", fetcher);
  const listener = vi.fn();
  window.addEventListener(suggestionsChanged, listener);
  try {
    const editor = render(<SuggestionsEditor profiles={[]} selected="demo" />);
    await screen.findByLabelText("Título 1");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    editor.unmount();
    expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true);
    await act(async () => {
      finish(response([item]));
    });
    expect(listener).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener(suggestionsChanged, listener);
  }
});
