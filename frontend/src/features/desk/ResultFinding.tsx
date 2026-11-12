import type { Conversation, Finding } from "./types";
import { sourceLabels } from "./types";
import { ToolIcon } from "./ToolIcon";
import { sourceWork } from "./scenario";
import { SourcePosts } from "./SourcePosts";
import { MentionText } from "./MentionText";
import { MarkdownText } from "./MarkdownText";
import { searchable } from "./useResultsFilter";

export function ResultFinding({
  finding,
  query,
  expanded,
  onToggle,
  conversations,
}: {
  finding: Finding;
  query: string;
  expanded: boolean;
  onToggle: (finding: Finding) => void;
  conversations: Conversation[];
}) {
  return (
    <article
      className={`finding t-resize finding-${finding.source}`}
      key={finding.id}
      data-finding-id={finding.id}
      data-expanded={expanded}
    >
      <div className="finding-skeleton" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="finding-content">
        <header>
          <span>
            <ToolIcon source={finding.source} />
            <MentionText
              text={finding.sourceLabel ?? sourceLabels[finding.source]}
              query={query}
            />
          </span>
        </header>
        {![
          finding.sourceLabel ?? finding.source,
          sourceLabels[finding.source],
        ].some(
          (label) => searchable(label) === searchable(finding.title.trim()),
        ) && (
          <h2>
            <MentionText text={finding.title} query={query} />
          </h2>
        )}
        {finding.text && (
          <div
            role="button"
            tabIndex={0}
            className="finding-summary"
            aria-expanded={expanded}
            data-tooltip-disabled="true"
            onClick={() => onToggle(finding)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggle(finding);
              }
            }}
          >
            <MarkdownText
              text={finding.text}
              query={query}
              live={false}
              compact
              links={false}
            />
          </div>
        )}
        {finding.artifact && <ArtifactData artifact={finding.artifact} />}
        {finding.references &&
          !finding.artifact &&
          !(finding.source === "analysis" && !finding.remote) && (
            <SourcePosts
              references={finding.references}
              query={query}
              contentItems={
                conversations.find((turn) => turn.id === finding.requestId)
                  ?.contentItems?.items
              }
            />
          )}
        {finding.source === "analysis" && !finding.remote && <DemoChart />}
        <footer>
          {finding.requestId}{" "}
          <span>{finding.remote ? "Agent Flow" : "Simulado"}</span>
        </footer>
      </div>
    </article>
  );
}
function ArtifactData({
  artifact,
}: {
  artifact: import("./publicManifest").Artifact;
}) {
  const rows = Array.isArray(artifact.rows)
    ? artifact.rows.filter(
        (row): row is Record<string, unknown> =>
          !!row && typeof row === "object" && !Array.isArray(row),
      )
    : [];
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value: unknown) =>
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  if (!rows.length) return null;
  const bars =
    artifact.kind === "bar" &&
    rows.every(
      (row) =>
        typeof row.source === "string" &&
        typeof row.value === "number" &&
        Number.isFinite(row.value) &&
        row.value >= 0,
    );
  const maximum = bars
    ? Math.max(1, ...rows.map((row) => row.value as number))
    : 1;
  const table = (
    <table className={bars ? "sr-only" : "agent-artifact-table"}>
      <caption className={bars ? undefined : "sr-only"}>
        {typeof artifact.title === "string"
          ? artifact.title
          : "Datos del agente"}
      </caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {columns.map((column) => (
              <td key={column}>{cell(row[column])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  if (!bars) return table;
  return (
    <figure className="agent-bar-chart">
      <div aria-hidden="true">
        {rows.map((row, index) => (
          <div className="agent-bar-row" key={index}>
            <span>
              {Object.hasOwn(sourceLabels, String(row.source))
                ? sourceLabels[row.source as keyof typeof sourceLabels]
                : String(row.source)}
            </span>
            <span className="agent-bar-track">
              <i style={{ width: `${(Number(row.value) / maximum) * 100}%` }} />
            </span>
            <strong>{String(row.value)}</strong>
          </div>
        ))}
      </div>
      {table}
    </figure>
  );
}
function DemoChart() {
  return (
    <figure className="demo-chart">
      <figcaption>
        Unidades procesadas por fuente <span>Ejemplo ficticio</span>
      </figcaption>
      <div aria-hidden="true">
        {sourceWork.map(({ source, units: count }) => (
          <div className="bar-row" key={source}>
            <span>{sourceLabels[source]}</span>
            <div>
              <i style={{ transform: `scaleX(${count / 35})` }} />
            </div>
            <strong>{count}</strong>
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>Comparación ilustrativa de unidades procesadas</caption>
        <thead>
          <tr>
            <th>Fuente</th>
            <th>Unidades</th>
          </tr>
        </thead>
        <tbody>
          {sourceWork.map(({ source, units }) => (
            <tr key={source}>
              <td>{sourceLabels[source]}</td>
              <td>{units}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
