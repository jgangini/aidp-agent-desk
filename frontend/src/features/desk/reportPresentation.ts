import { z } from "zod";
import type { ReportSectionDefinition } from "./report";

const schema = z
  .object({
    schema_version: z.literal("1.0"),
    rows: z
      .array(
        z
          .object({
            section_ids: z.array(z.string().min(1).max(128)).min(1).max(2),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict();
export type ReportPresentation = z.infer<typeof schema>;
export function defaultPresentation(
  sections: ReportSectionDefinition[],
): ReportPresentation {
  return {
    schema_version: "1.0",
    rows: sections.map((section) => ({ section_ids: [section.section_id] })),
  };
}
export function readPresentation(
  value: unknown,
  sections: ReportSectionDefinition[],
): ReportPresentation | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return null;
  const ids = parsed.data.rows.flatMap((row) => row.section_ids);
  const expected = new Set(sections.map((section) => section.section_id));
  return ids.length === expected.size &&
    new Set(ids).size === ids.length &&
    ids.every((id) => expected.has(id))
    ? parsed.data
    : null;
}
export function reorderPresentation(
  layout: ReportPresentation,
  from: number,
  to: number,
): ReportPresentation {
  const ids = layout.rows.flatMap((row) => row.section_ids);
  if (from < 0 || to < 0 || from >= ids.length || to >= ids.length)
    return layout;
  const [id] = ids.splice(from, 1);
  ids.splice(to, 0, id);
  let cursor = 0;
  return {
    ...layout,
    rows: layout.rows.map((row) => ({
      section_ids: row.section_ids.map(() => ids[cursor++]),
    })),
  };
}
export function groupPresentation(
  layout: ReportPresentation,
  source: string,
  target: string,
): ReportPresentation {
  if (source === target) return layout;
  const targetRow = layout.rows.find((row) => row.section_ids.includes(target));
  if (
    !targetRow ||
    targetRow.section_ids.length === 2 ||
    !layout.rows.some((row) => row.section_ids.includes(source))
  )
    return layout;
  return {
    ...layout,
    rows: layout.rows
      .map((row) => ({
        section_ids: row.section_ids.filter((id) => id !== source),
      }))
      .filter((row) => row.section_ids.length)
      .map((row) =>
        row.section_ids.includes(target)
          ? { section_ids: [target, source] }
          : row,
      ),
  };
}
export function detachPresentation(
  layout: ReportPresentation,
  id: string,
): ReportPresentation {
  return {
    ...layout,
    rows: layout.rows.flatMap((row) =>
      row.section_ids.includes(id)
        ? row.section_ids.map((section) => ({ section_ids: [section] }))
        : [row],
    ),
  };
}
