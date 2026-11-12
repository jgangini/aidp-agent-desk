import type { Reference } from "./publicManifest";
export function reportReferenceLabel(reference: Reference) {
  const title = [reference.title, reference.source_title].find(
    (value) =>
      typeof value === "string" &&
      value.trim() &&
      value.trim() !== reference.evidence_id &&
      !/^[a-f0-9]{24,}$/i.test(value.trim()),
  );
  return typeof title === "string"
    ? title.trim()
    : new URL(reference.url).hostname.replace(/^www\./, "");
}
