import { describe, expect, it } from "vitest";
import Ajv2020 from "@redocly/ajv/dist/2020";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAgentView, reduceAgentPacket } from "./aidp";
import { parseTaskReport, type TaskReport } from "./report";

const load = (path: string) =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), "../contracts", path), "utf8"),
  );
const schema = load("report-v1.schema.json");
type Fixture = {
  status: string;
  markdown: string;
  references: { evidence_id: string; url: string }[];
  artifacts: unknown[];
  report: TaskReport;
};
const empty: Fixture = load("fixtures/reports/market-empty.json");
const abundant: Fixture = load("fixtures/reports/market-abundant.json");
const government: Fixture = load("fixtures/reports/government.json");

const references = (
  fixture: { references: { evidence_id: string; url: string }[] } = abundant,
) => new Map(fixture.references.map((ref) => [ref.evidence_id, ref]));
const packet = (response: unknown) => ({
  protocol: "ai-market-intelligence",
  version: "2.0",
  kind: "response",
  request_id: "request",
  response,
});

describe("report capability", () => {
  it.each([empty, abundant, government])(
    "accepts a domain-independent report with matching evidence",
    (fixture) => {
      const ajv = new Ajv2020({ strict: true });
      ajv.addFormat("date-time", (value: string) =>
        Number.isFinite(Date.parse(value)),
      );
      const validate = ajv.compile(schema);
      expect(validate(fixture.report), JSON.stringify(validate.errors)).toBe(
        true,
      );
      const report = parseTaskReport(fixture.report, references(fixture));
      expect(report?.sections).toEqual(fixture.report.sections);
      expect(report?.title).toBe(fixture.report.title);
    },
  );

  it("preserves the template from an empty run to an abundant run", () => {
    expect(empty.report.template).toEqual(abundant.report.template);
    expect(
      parseTaskReport(empty.report, references(empty))?.sections,
    ).toHaveLength(1);
    expect(
      parseTaskReport(abundant.report, references())?.sections.length,
    ).toBeGreaterThan(1);
  });

  it.each([
    (r: typeof abundant.report) => {
      r.sections[0].evidence_ids = ["missing"];
    },
    (r: typeof abundant.report) => {
      r.sections.push(r.sections[0]);
    },
    (r: typeof abundant.report) => {
      r.sections.reverse();
    },
    (r: typeof abundant.report) => {
      r.sections.shift();
    },
    (r: typeof abundant.report) => {
      r.sections[0].section_id = "undeclared";
    },
    (r: typeof abundant.report) => {
      r.template.sections.push(r.template.sections[0]);
    },
    (r: typeof abundant.report) => {
      r.period!.end = r.period!.start;
    },
    (r: typeof abundant.report) => {
      r.period!.start = "2026-02-30T14:00:00Z";
    },
    (r: typeof abundant.report) => {
      r.period!.time_zone = "Not/AZone";
    },
    (r: typeof abundant.report) => {
      r.period!.start = "2026-11-10T24:00:00Z";
    },
    (r: typeof abundant.report) => {
      r.period!.start = `2026-11-10T14:00:00.${"0".repeat(50)}Z`;
    },
    (r: typeof abundant.report) => {
      r.sections[0].markdown = " ";
    },
    (r: typeof abundant.report) => {
      Object.assign(r.template, { script: "untrusted" });
    },
  ])(
    "rejects inconsistent evidence, template or period and preserves Markdown",
    (mutate) => {
      const response = structuredClone(abundant);
      mutate(response.report);
      expect(() => parseTaskReport(response.report, references())).toThrow();
      const view = reduceAgentPacket(
        createAgentView("request"),
        packet(response),
      );
      expect(view.report).toBeUndefined();
      expect(view.reportIssue).toContain("Markdown");
      expect(view.final?.markdown).toBe(abundant.markdown);
    },
  );

  it("projects only terminal accepted reports and drops opaque extensions", () => {
    const response = {
      ...abundant,
      report: {
        ...abundant.report,
        extensions: { future: { html: "<script>" } },
      },
    };
    const view = reduceAgentPacket(
      createAgentView("request"),
      packet(response),
    );
    expect(view.report?.template).toEqual(abundant.report.template);
    expect(view.report).not.toHaveProperty("extensions");
    const pending = reduceAgentPacket(
      view,
      packet({ ...response, status: "pending" }),
    );
    expect(pending.report).toBeUndefined();
    const failed = reduceAgentPacket(
      view,
      packet({ ...response, status: "failed" }),
    );
    expect(failed.report).toBeUndefined();
  });

  it("falls back for absent and future versions without a false warning", () => {
    for (const report of [undefined, { schema_version: "2.0" }]) {
      const view = reduceAgentPacket(
        createAgentView("request"),
        packet({ ...government, report }),
      );
      expect(view.report).toBeUndefined();
      expect(view.reportIssue).toBeUndefined();
      expect(view.final?.markdown).toBe(government.markdown);
    }
  });

  it("does not use provisional references to validate final report evidence", () => {
    const view = createAgentView("request");
    for (const ref of abundant.references)
      view.references.set(ref.evidence_id, ref);
    const final = reduceAgentPacket(
      view,
      packet({ ...abundant, references: [] }),
    );
    expect(final.report).toBeUndefined();
    expect(final.reportIssue).toBeDefined();
  });

  it("preserves the original request and inclusive period without changing timestamps", () => {
    const report = {
      ...abundant.report,
      source_request_id: "original-research",
      period: { ...abundant.report.period!, bounds: "[start,end]" as const },
    };
    const parsed = parseTaskReport(report, references());
    expect(parsed?.source_request_id).toBe("original-research");
    expect(parsed?.period).toEqual(report.period);
  });
});
