import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReportTemplateEditor } from "./ReportTemplateEditor";
import { taskRequest, type TaskRun } from "./scheduledApi";

vi.mock("./scheduledApi", async (original) => ({
  ...(await original<typeof import("./scheduledApi")>()),
  taskRequest: vi.fn(),
}));
const government = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../contracts/fixtures/reports/government.json"),
    "utf8",
  ),
);
const producer = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "../contracts/fixtures/reports/market-producer-response.json",
    ),
    "utf8",
  ),
);
const market = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "../contracts/fixtures/reports/market-extensions.json",
    ),
    "utf8",
  ),
);

beforeEach(() => {
  vi.mocked(taskRequest).mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(cleanup);

function open(response = government, previewRun?: TaskRun | null) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  vi.mocked(taskRequest).mockResolvedValueOnce({
    template: structuredClone(response.report.template),
    version: 3,
  });
  const view = render(
    <ReportTemplateEditor
      taskId={response.report.task_id}
      onClose={onClose}
      onSaved={onSaved}
      previewRun={previewRun}
    />,
  );
  return { ...view, onClose, onSaved };
}
function run(response: typeof government): TaskRun {
  return {
    id: response.report.task_run_id,
    taskId: response.report.task_id,
    taskVersion: 1,
    status: "completed",
    trigger: "scheduled",
    createdAt: "2026-11-11T15:00:00Z",
    response,
  };
}
async function titles() {
  return await screen.findAllByRole<HTMLInputElement>("textbox", {
    name: "Título de sección",
  });
}

it("saves button-reordered titles and visibility with the original expected version", async () => {
  const { onClose, onSaved } = open();
  vi.mocked(taskRequest).mockResolvedValueOnce({ version: 4 });
  const fields = await titles();
  fireEvent.click(
    screen.getByRole("button", { name: `Bajar ${fields[0].value}` }),
  );
  expect((await titles()).map((input) => input.value)).toEqual(
    government.report.template.sections
      .map((s: { title: string }) => s.title)
      .reverse(),
  );
  expect(screen.getByText(/movida a la posición 2/)).toBeTruthy();
  fireEvent.change((await titles())[0], {
    target: { value: "Actuaciones verificadas" },
  });
  fireEvent.change(
    screen.getAllByRole("combobox", { name: "Visibilidad" })[0],
    { target: { value: "always" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(4));
  const saved = vi.mocked(taskRequest).mock.calls[1];
  expect(saved[0]).toBe(`/${government.report.task_id}/template`);
  expect(saved[1]).toBe("PUT");
  expect(saved[2]).toEqual({
    expectedVersion: 3,
    presentation: {
      schema_version: "1.0",
      rows: [
        { section_ids: [government.report.template.sections[1].section_id] },
        { section_ids: [government.report.template.sections[0].section_id] },
      ],
    },
    template: {
      ...government.report.template,
      sections: [
        {
          ...government.report.template.sections[1],
          title: "Actuaciones verificadas",
          visibility: "always",
        },
        government.report.template.sections[0],
      ],
    },
  });
  expect(onClose).toHaveBeenCalledOnce();
});

it("drags only from the dedicated grip and keeps text fields selectable", async () => {
  open();
  const fields = await titles();
  expect(fields[0].closest("li")?.hasAttribute("draggable")).toBe(false);
  const transfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
  const handle = screen.getByRole("button", {
    name: `Arrastrar ${fields[0].value}`,
  });
  expect(handle.getAttribute("draggable")).toBe("true");
  const destination = fields[1].closest(".report-format-block")!;
  fireEvent.dragStart(handle, { dataTransfer: transfer });
  fireEvent.dragOver(destination, { dataTransfer: transfer });
  expect(destination.getAttribute("data-drop-target")).toBe("true");
  fireEvent.drop(destination, { dataTransfer: transfer });
  expect((await titles())[0].value).toBe(
    government.report.template.sections[1].title,
  );
  expect(transfer.setData).toHaveBeenCalledWith(
    "text/plain",
    government.report.template.sections[0].section_id,
  );
  expect(screen.getByText(/movida a la posición 2/)).toBeTruthy();
});

it("edits inline and saves mouse-grouped sections as two columns without changing report data", async () => {
  const response = structuredClone(government);
  const { container } = open(response, run(response));
  vi.mocked(taskRequest).mockResolvedValueOnce({ version: 4 });
  const fields = await titles();
  expect(screen.queryByRole("dialog")).toBeNull();
  const transfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
  fireEvent.dragStart(
    screen.getByRole("button", { name: `Arrastrar ${fields[1].value}` }),
    { dataTransfer: transfer },
  );
  const target = screen.getByRole("group", {
    name: `Columna junto a ${fields[0].value}`,
  });
  fireEvent.dragOver(target, { dataTransfer: transfer });
  fireEvent.drop(target, { dataTransfer: transfer });
  expect(
    container.querySelectorAll('.report-format-row[data-columns="2"]'),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  await waitFor(() => expect(taskRequest).toHaveBeenCalledTimes(2));
  expect(vi.mocked(taskRequest).mock.calls[1][2]).toMatchObject({
    presentation: {
      schema_version: "1.0",
      rows: [
        {
          section_ids: government.report.template.sections.map(
            (s: { section_id: string }) => s.section_id,
          ),
        },
      ],
    },
  });
  expect(response).toEqual(government);
});

it("can group and separate columns using buttons without a mouse", async () => {
  const { container } = open();
  const fields = await titles();
  fireEvent.click(
    screen.getByRole("button", {
      name: `Agrupar ${fields[1].value} con anterior`,
    }),
  );
  expect(
    container.querySelectorAll('.report-format-row[data-columns="2"]'),
  ).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: `Separar ${fields[1].value}` }),
  );
  expect(
    container.querySelectorAll('.report-format-row[data-columns="2"]'),
  ).toHaveLength(0);
  expect(await titles()).toHaveLength(2);
});

it("supports keyboard moves on the grip without requiring drag", async () => {
  open();
  const fields = await titles();
  fireEvent.keyDown(
    screen.getByRole("button", { name: `Arrastrar ${fields[0].value}` }),
    { key: "ArrowDown" },
  );
  expect((await titles())[0].value).toBe(
    government.report.template.sections[1].title,
  );
});

it("keeps focus on the same section through repeated keyboard moves", async () => {
  open(producer, run(producer));
  const fields = await titles();
  const title = fields[0].value;
  const grip = () => screen.getByRole("button", { name: `Arrastrar ${title}` });
  grip().focus();
  fireEvent.keyDown(grip(), { key: "ArrowDown" });
  expect(document.activeElement).toBe(grip());
  fireEvent.keyDown(grip(), { key: "ArrowDown" });
  expect(document.activeElement).toBe(grip());
  expect((await titles())[2].value).toBe(title);
});

it("cancels without persisting and shows a truthful empty preview", async () => {
  const { onClose, container } = open();
  await titles();
  expect(
    screen.getByText(
      "No hay un informe aceptado disponible para esta vista previa.",
    ),
  ).toBeTruthy();
  expect(container.querySelector(".report-format-page img")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(taskRequest).toHaveBeenCalledTimes(1);
});

it("retains version-conflict feedback and the editable draft", async () => {
  const { onClose } = open();
  vi.mocked(taskRequest).mockRejectedValueOnce(
    new Error("La tarea cambió; recarga antes de ajustar el informe."),
  );
  const fields = await titles();
  fireEvent.change(fields[0], { target: { value: "Mi resumen" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "La tarea cambió; recarga antes de ajustar el informe.",
  );
  expect((await titles())[0].value).toBe("Mi resumen");
  expect(onClose).not.toHaveBeenCalled();
});

it("previews accepted text, tables and evidence images with draft ordering", async () => {
  const response = structuredClone(government);
  response.report.sections[0].markdown =
    "Texto verificado.\n\n| Tema | Estado |\n| --- | --- |\n| Presupuesto | Revisado |";
  response.references[0].media = [
    {
      url: "https://example.com/evidence.png",
      kind: "image",
      delivery: "direct",
      role: "attachment",
    },
  ];
  open(response, run(response));
  const fields = await titles();
  const page = await screen.findByRole("article", {
    name: "Vista previa del informe con datos guardados",
  });
  await waitFor(() =>
    expect(within(page).getByText("Texto verificado.")).toBeTruthy(),
  );
  expect(within(page).getByRole("table")).toBeTruthy();
  expect(within(page).getByRole("img").getAttribute("src")).toBe(
    "https://example.com/evidence.png",
  );
  fireEvent.change(fields[0], { target: { value: "Nuevo encabezado" } });
  await waitFor(() =>
    expect(
      within(page).getByRole("heading", { name: "Nuevo encabezado" }),
    ).toBeTruthy(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Bajar Nuevo encabezado" }),
  );
  await waitFor(() =>
    expect(within(page).getAllByRole("heading")[1].textContent).toBe(
      response.report.template.sections[1].title,
    ),
  );
});

it("uses validated producer metrics and sentiment in the preview", async () => {
  const { container } = open(producer, run(producer));
  await titles();
  await waitFor(() =>
    expect(container.querySelector(".report-coverage-chart")).toBeTruthy(),
  );
  expect(container.querySelector(".report-sentiment-chart")).toBeNull();
  expect(
    screen.getByText("Evidencia insuficiente para clasificar sentimiento."),
  ).toBeTruthy();
});

it("previews classified sentiment using only the validated fixture counts", async () => {
  const response = structuredClone(producer);
  response.references = market.evidence;
  response.report.extensions = market.extensions;
  response.report.sections = response.report.sections.map(
    (section: { evidence_ids: string[] }) => ({
      ...section,
      evidence_ids: [],
    }),
  );
  const { container } = open(response, run(response));
  await titles();
  await waitFor(() =>
    expect(container.querySelector(".report-sentiment-chart")).toBeTruthy(),
  );
  expect(
    container.querySelector(".sentiment-positive")?.getAttribute("style"),
  ).toContain("100%");
  expect(
    container.querySelector(".sentiment-negative")?.getAttribute("style"),
  ).toContain("0%");
});
