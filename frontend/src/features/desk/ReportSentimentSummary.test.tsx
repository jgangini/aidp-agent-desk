import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { Sentiment } from "./reportExtensions";
import { ReportSentimentSummary } from "./ReportSentimentSummary";

afterEach(cleanup);
const group = (
  overrides: Partial<Sentiment["groups"][number]> = {},
): Sentiment["groups"][number] => ({
  source: "facebook",
  basis: "post_text",
  target: "Marca",
  aspect: null,
  population: "retained_evidence",
  eligible_count: 3,
  classified_count: 2,
  unclassified_count: 1,
  counts: { positive: 1, neutral: 0, negative: 1, mixed: 0 },
  annotations: [],
  limitations: [],
  ...overrides,
});
const sentiment = (groups: Sentiment["groups"]): Sentiment => ({
  schema_version: "1.0",
  method: {
    method_id: "target-aspect-polarity",
    version: "1.0",
    calibration_status: "not_calibrated",
  },
  status: "analyzed",
  groups,
  limitations: [],
});
it("consolidates sources into vertical bars and keeps unclassified outside percentages", () => {
  const data = sentiment([
    group(),
    group({
      source: "instagram",
      counts: { positive: 0, neutral: 1, negative: 0, mixed: 1 },
    }),
  ]);
  const before = structuredClone(data);
  const { container } = render(<ReportSentimentSummary sentiment={data} />);
  expect(
    screen.getByText(/4 clasificados de 6 elegibles · 2 sin clasificar/),
  ).toBeTruthy();
  const chart = screen.getByRole("list", {
    name: "Distribución de sentimiento de Marca",
  });
  expect(within(chart).getAllByText("1 · 25 %")).toHaveLength(4);
  expect(
    container.querySelectorAll(".sentiment-column-track > span"),
  ).toHaveLength(4);
  expect(
    (container.querySelector(".sentiment-positive") as HTMLElement).style
      .height,
  ).toBe("25%");
  expect(data).toEqual(before);
});
it("keeps different entities and text units separate", () => {
  const { container } = render(
    <ReportSentimentSummary
      sentiment={sentiment([
        group(),
        group({ source: "instagram", target: "Otra marca" }),
        group({ basis: "comment_text" }),
        group({ aspect: "Precio" }),
      ])}
    />,
  );
  expect(container.querySelectorAll("figure")).toHaveLength(4);
});
it("shows one consolidated sample summary without chart when nothing is classified", () => {
  const empty = {
    eligible_count: 1,
    classified_count: 0,
    unclassified_count: 1,
    counts: { positive: 0, negative: 0, neutral: 0, mixed: 0 },
  };
  const { container } = render(
    <ReportSentimentSummary
      sentiment={sentiment([
        group(empty),
        group({ ...empty, source: "instagram" }),
      ])}
    />,
  );
  expect(
    screen.getByText(/0 clasificados de 2 elegibles · 2 sin clasificar/),
  ).toBeTruthy();
  expect(container.querySelector("figure")).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
});
