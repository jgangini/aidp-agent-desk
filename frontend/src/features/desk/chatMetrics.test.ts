import { expect, it } from "vitest";
import {
  contextUsage,
  responseTiming,
  tokenCount,
  formatWorkDuration,
} from "./chatMetrics";

it("formats elapsed work in compact hours, minutes and seconds without rolling hours into minutes", () => {
  expect(formatWorkDuration(0)).toBe("0s");
  expect(formatWorkDuration(59999)).toBe("59s");
  expect(formatWorkDuration(60000)).toBe("1m 0s");
  expect(formatWorkDuration(3599999)).toBe("59m 59s");
  expect(formatWorkDuration(3600000)).toBe("1h 0m 0s");
  expect(formatWorkDuration(3735000)).toBe("1h 2m 15s");
});

it("never substitutes estimated or zero tokens for unreported usage", () => {
  expect(contextUsage()).toEqual({ label: "— / —", percentage: undefined });
  expect(
    contextUsage({ inputTokens: 21000, outputTokens: 400 }).percentage,
  ).toBeUndefined();
  expect(
    contextUsage({ contextTokens: 21000, contextWindow: 1000000 }),
  ).toEqual({ label: "21k / 1M", percentage: 2.1 });
  expect(
    contextUsage({ contextTokens: 0, contextWindow: 1000 }).percentage,
  ).toBe(0);
  expect(
    contextUsage({ contextTokens: 10, contextWindow: 0 }).percentage,
  ).toBeUndefined();
  expect(tokenCount(NaN)).toBe("—");
  expect(tokenCount(-1)).toBe("—");
});
it("uses dispatcher timestamps and keeps missing first fragments unknown", () => {
  expect(
    responseTiming({
      id: "r",
      question: "q",
      answer: "",
      status: "cancelled",
      createdAt: 1000,
      completedAt: 1400,
      chunks: 0,
    }),
  ).toEqual({ total: 400, first: undefined });
});
