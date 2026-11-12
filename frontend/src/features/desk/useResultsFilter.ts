import { useState } from "react";
import type { Finding } from "./types";
import { sourceLabels } from "./types";

export function searchable(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
}

export function useResultsFilter(findings: Finding[]) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [searchFolded, setSearchFolded] = useState<{
    query: string;
    ids: ReadonlySet<string>;
  }>({ query: "", ids: new Set() });
  const filter = searchable(query.trim());
  const visible = findings.filter((finding) =>
    [
      finding.sourceLabel ?? sourceLabels[finding.source],
      finding.title,
      finding.text,
    ].some((text) => searchable(text).includes(filter)),
  );
  const textMatches = (finding: Finding) =>
    !!filter && searchable(finding.text).includes(filter);
  const isExpanded = (finding: Finding) =>
    textMatches(finding)
      ? !(searchFolded.query === filter && searchFolded.ids.has(finding.id))
      : expanded.has(finding.id);
  const changeQuery = (next: string) => {
    if (next !== query)
      setSearchFolded({
        query: searchable(next.trim()),
        ids: new Set<string>(),
      });
    setQuery(next);
  };
  const toggleSummary = (finding: Finding) => {
    const id = finding.id;
    const wasOpen = isExpanded(finding);
    setExpanded((current) => {
      const next = new Set(current);
      if (wasOpen) next.delete(id);
      else next.add(id);
      return next;
    });
    if (textMatches(finding))
      setSearchFolded((current) => {
        const ids = new Set(current.query === filter ? current.ids : []);
        if (wasOpen) ids.add(id);
        else ids.delete(id);
        return { query: filter, ids };
      });
  };
  return {
    query,
    filter,
    visible,
    expanded,
    isExpanded,
    changeQuery,
    toggleSummary,
  };
}
