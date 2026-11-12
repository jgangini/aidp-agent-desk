import { expect, it } from "vitest";
import {
  readPresentation,
  defaultPresentation,
  groupPresentation,
  detachPresentation,
} from "./reportPresentation";
const sections = ["a", "b", "c"].map((section_id) => ({
  section_id,
  title: section_id,
  visibility: "always" as const,
}));
it("requires exactly the template section set and at most two cells per row", () => {
  const layout = defaultPresentation(sections);
  expect(readPresentation(layout, sections)).toEqual(layout);
  expect(
    readPresentation(
      { ...layout, rows: [{ section_ids: ["a", "b", "c"] }] },
      sections,
    ),
  ).toBeNull();
  expect(
    readPresentation(
      {
        ...layout,
        rows: [{ section_ids: ["a", "a"] }, { section_ids: ["c"] }],
      },
      sections,
    ),
  ).toBeNull();
  expect(
    readPresentation(
      {
        ...layout,
        rows: [{ section_ids: ["a", "b"] }, { section_ids: ["unknown"] }],
      },
      sections,
    ),
  ).toBeNull();
});
it("preserves every section while grouping and detaching, and refuses a third column", () => {
  const original = defaultPresentation(sections);
  const grouped = groupPresentation(original, "b", "a");
  expect(grouped.rows).toEqual([
    { section_ids: ["a", "b"] },
    { section_ids: ["c"] },
  ]);
  expect(groupPresentation(grouped, "c", "a")).toBe(grouped);
  expect(detachPresentation(grouped, "a")).toEqual(original);
});
