import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readReportExtensions } from "./reportExtensions";
import { createAgentView, reduceAgentPacket } from "./aidp";
import { parseReference, type Reference } from "./publicManifest";
const fixture = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "../contracts/fixtures/reports/market-extensions.json",
    ),
    "utf8",
  ),
);
const references = new Map<string, Reference>(
  fixture.evidence.map((value: unknown) => {
    const ref = parseReference(value);
    return [ref.evidence_id, ref] as const;
  }),
);
describe("market report extensions", () => {
  it("counts rejected query attempts without inventing an empty retained sample", () => {
    const rejected = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          "../contracts/fixtures/reports/query-rejections.json",
        ),
        "utf8",
      ),
    );
    const result = readReportExtensions(rejected.extensions, new Map());
    expect(result.warnings).toEqual([]);
    const platform = result.metrics?.platforms[0];
    expect(platform?.retrieval_status).toBe("provider_failed");
    expect(platform?.query_operations).toEqual({
      started: 2,
      completed: 0,
      failed: 2,
    });
    expect(
      platform?.observations.every(
        (unit) =>
          unit.status === "not_collected" &&
          unit.retained_count === null &&
          unit.analyzed_count === null,
      ),
    ).toBe(true);
    rejected.extensions[
      "market.platform_metrics"
    ].platforms[0].query_operations.started = 0;
    expect(
      readReportExtensions(rejected.extensions, new Map()).metrics,
    ).toBeUndefined();
  });
  it("accepts the packaged producer's synthetic complete response across the real consumer boundary", () => {
    const response = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          "../contracts/fixtures/reports/market-producer-response.json",
        ),
        "utf8",
      ),
    );
    const view = reduceAgentPacket(createAgentView("producer-test"), {
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "response",
      request_id: "producer-test",
      response,
    });
    expect(view.reportIssue).toBeUndefined();
    expect(view.report).toBeDefined();
    const extensions = readReportExtensions(
      response.report.extensions,
      new Map(
        response.references.map((r: unknown) => {
          const ref = parseReference(r);
          return [ref.evidence_id, ref];
        }),
      ),
    );
    expect(extensions.warnings).toEqual([]);
    expect(extensions.metrics).toBeDefined();
    expect(extensions.sentiment).toBeDefined();
  });
  it("keeps post sentiment separate from comment sentiment and preserves the sample", () => {
    const result = readReportExtensions(fixture.extensions, references);
    expect(result.warnings).toEqual([]);
    expect(
      result.metrics?.platforms[0].observations.map((o) => o.retained_count),
    ).toEqual([1, 1]);
    expect(
      result.sentiment?.groups.map((g) => [
        g.basis,
        g.counts.positive,
        g.counts.negative,
      ]),
    ).toEqual([
      ["post_text", 1, 0],
      ["comment_text", 0, 1],
    ]);
  });
  it.each([
    (f: typeof fixture) => {
      f.extensions[
        "market.platform_metrics"
      ].platforms[0].observations[0].retained_count = 50;
    },
    (f: typeof fixture) => {
      f.extensions["market.platform_metrics"].platforms[0].observations.push(
        f.extensions["market.platform_metrics"].platforms[0].observations[0],
      );
    },
    (f: typeof fixture) => {
      f.extensions[
        "market.platform_metrics"
      ].platforms[0].observations[0].evidence_ids = ["missing"];
    },
    (f: typeof fixture) => {
      f.extensions[
        "market.platform_metrics"
      ].platforms[0].query_operations.completed = 99;
    },
  ])("rejects misleading metrics and dependent sentiment", (mutate) => {
    const value = structuredClone(fixture);
    mutate(value);
    const result = readReportExtensions(value.extensions, references);
    expect(result.metrics).toBeUndefined();
    expect(result.sentiment).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it.each([
    (f: typeof fixture) => {
      f.extensions["market.sentiment"].groups[0].counts.positive = 9;
    },
    (f: typeof fixture) => {
      f.extensions["market.sentiment"].groups[0].basis = "comment_text";
    },
    (f: typeof fixture) => {
      f.extensions[
        "market.sentiment"
      ].groups[0].annotations[0].supporting_text = null;
    },
    (f: typeof fixture) => {
      f.extensions["market.sentiment"].groups[0].eligible_count = 50;
    },
    (f: typeof fixture) => {
      f.extensions["market.sentiment"].status = "insufficient";
    },
  ])(
    "rejects unsupported sentiment totals, evidence or denominators",
    (mutate) => {
      const value = structuredClone(fixture);
      mutate(value);
      const result = readReportExtensions(value.extensions, references);
      expect(result.metrics).toBeDefined();
      expect(result.sentiment).toBeUndefined();
      expect(result.warnings.length).toBeGreaterThan(0);
    },
  );
  it("ignores unknown versions and domains", () => {
    expect(
      readReportExtensions(
        {
          government: { schema_version: "1.0" },
          "market.sentiment": { schema_version: "2.0" },
        },
        new Map(),
      ),
    ).toEqual({ warnings: [] });
  });

  it("rejects oversized collections before Zod traverses their items", () => {
    const value = structuredClone(fixture.extensions);
    let itemReads = 0;
    const oversized = Array.from({ length: 801 }, () => {
      const item = {};
      Object.defineProperty(item, "unit", {
        enumerable: true,
        get() {
          itemReads++;
          throw new Error("Oversized collection items must not be parsed");
        },
      });
      return item;
    });
    value["market.platform_metrics"].platforms[0].observations = oversized;
    const result = readReportExtensions(value, references);
    expect(result.metrics).toBeUndefined();
    expect(result.sentiment).toBeUndefined();
    expect(itemReads).toBe(0);
    expect(result.warnings).toContain(
      "La extensión market.platform_metrics supera los límites de estructura admitidos.",
    );
  });

  it.each(["depth", "keys", "nodes", "cycle"])(
    "bounds untrusted extension %s without crashing",
    (kind) => {
      const value = structuredClone(fixture.extensions);
      const extension = value["market.platform_metrics"];
      if (kind === "depth") {
        let nested: unknown = "leaf";
        for (let depth = 0; depth < 13; depth++) nested = [nested];
        extension.extra = nested;
      } else if (kind === "keys") {
        extension.extra = Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => [`key-${index}`, null]),
        );
      } else if (kind === "nodes") {
        extension.extra = Array.from({ length: 30 }, () =>
          Array.from({ length: 800 }, () => null),
        );
      } else {
        extension.extra = extension;
      }
      const result = readReportExtensions(value, references);
      expect(result.metrics).toBeUndefined();
      expect(result.warnings).toContain(
        "La extensión market.platform_metrics supera los límites de estructura admitidos.",
      );
    },
  );

  it("retains the evidence-unit check after splitting validators", () => {
    const mismatched = new Map(references);
    const postId =
      fixture.extensions["market.platform_metrics"].platforms[0].observations[0]
        .evidence_ids[0];
    const reference = mismatched.get(postId)!;
    mismatched.set(postId, { ...reference, content_basis: "comment_text" });
    const result = readReportExtensions(fixture.extensions, mismatched);
    expect(result.metrics).toBeUndefined();
    expect(result.sentiment).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
