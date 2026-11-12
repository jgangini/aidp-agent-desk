import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reportMarkdown } from "./reportDownload";
import type { TaskRun } from "./scheduledApi";
it("exports the selected report's state, interval, source and limitations", () => {
  const response = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "../contracts/fixtures/reports/market-abundant.json",
      ),
      "utf8",
    ),
  );
  const run = {
    id: response.report.task_run_id,
    taskId: response.report.task_id,
    status: "partial",
    taskVersion: 3,
    response,
  } as TaskRun;
  const text = reportMarkdown(run);
  expect(text).toContain("Estado: Parcial");
  expect(text).toContain("Versión de tarea: 3");
  expect(text).toContain(response.report.period.start);
  expect(text).toContain("final exclusivo");
  expect(text).toContain(response.report.limitations[0]);
  expect(text).toContain(response.references[0].url);
});
it("does not download an interrupted operation as a factual report", () => {
  expect(() =>
    reportMarkdown({
      id: "run",
      taskId: "task",
      status: "interrupted",
      response: { markdown: "Not accepted" },
    } as TaskRun),
  ).toThrow("descargable");
});
