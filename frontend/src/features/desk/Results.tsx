import { useId, useRef } from "react";
import { Search, X } from "lucide-react";
import type { Conversation, Finding } from "./types";
import { ResultFinding } from "./ResultFinding";
import { useResultsFilter } from "./useResultsFilter";
import { useResultsLayout, useResultsArrival } from "./useResultsLayout";
import { useResultsSearch } from "./useResultsSearch";
import "./RemoteResults.css";

export function Results({
  findings,
  reducedMotion,
  conversations = [],
}: {
  findings: Finding[];
  reducedMotion: boolean;
  conversations?: Conversation[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const descriptionID = useId();
  const search = useResultsFilter(findings);
  const { query, filter, visible } = search;
  const visibleIDs = JSON.stringify(visible.map((finding) => finding.id));
  const layout = useResultsLayout(
    root,
    visibleIDs,
    search.expanded,
    query,
    reducedMotion,
  );
  const changeQuery = (next: string) => {
    layout.captureFilter(next !== query);
    search.changeQuery(next);
  };
  const toggleSummary = (finding: Finding) => {
    layout.captureExpansion(finding.id);
    search.toggleSummary(finding);
  };
  useResultsArrival(root, findings, reducedMotion);
  const searchInput = useResultsSearch(root, query, reducedMotion, changeQuery);
  return (
    <div ref={root} className="results-panel">
      <header className="results-titlebar">
        <h1 id="results-title" className="sr-only">
          Resultados
        </h1>
        <div
          className={`results-search${searchInput.clearEcho ? " is-clearing" : ""}`}
        >
          <Search size={16} aria-hidden="true" />
          <input
            ref={searchInput.input}
            type="text"
            aria-label="Filtrar resultados"
            aria-describedby={descriptionID}
            placeholder={`Resultados (${findings.length})`}
            value={query}
            onChange={(event) => {
              searchInput.type(event.target.value);
            }}
          />
          <span id={descriptionID} className="sr-only">
            Mostrando {visible.length} de {findings.length} resultados
          </span>
          {searchInput.clearEcho && (
            <>
              <span
                key={searchInput.clearEcho.id}
                className="results-clear-echo"
                aria-hidden="true"
              >
                {searchInput.clearEcho.text}
              </span>
              <span className="results-clear-placeholder" aria-hidden="true">
                Resultados ({findings.length})
              </span>
              <span className="results-clear-glow" aria-hidden="true" />
            </>
          )}
          {query && (
            <button
              type="button"
              onClick={searchInput.clear}
              aria-label="Limpiar filtro"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>
      {filter && !visible.length && (
        <p className="results-no-match" role="status">
          Sin coincidencias
        </p>
      )}
      {visible.length > 0 && (
        <div className="findings">
          {visible.map((finding) => (
            <ResultFinding
              key={finding.id}
              finding={finding}
              query={query}
              expanded={search.isExpanded(finding)}
              onToggle={toggleSummary}
              conversations={conversations}
            />
          ))}
        </div>
      )}
    </div>
  );
}
