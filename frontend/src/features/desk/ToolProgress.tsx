import { useContext, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { ChevronRight } from "lucide-react";
import { ChatActionsContext } from "./chatContext";
import {
  sourceLabels,
  type SimEvent,
  type Finding,
  type Snapshot,
} from "./types";
import { ToolIcon } from "./ToolIcon";
import { formatWorkDuration } from "./chatMetrics";
import { MarkdownText } from "./MarkdownText";

/** Explicit identities coexist with the source-based legacy adapter. */
export function progressEvents(
  events: SimEvent[],
  requestId: string,
  running: boolean,
) {
  const latest = new Map<string, SimEvent>();
  for (const event of events) {
    if (event.requestId !== requestId) continue;
    if (event.presentation?.purpose === "progress") {
      latest.set(
        `activity:${event.presentation.activity?.activity_id ?? event.sourceLabel ?? event.source}`,
        event,
      );
    } else if (
      !event.presentation &&
      running &&
      event.source &&
      (event.source !== "desk" || !!event.sourceLabel)
    ) {
      latest.set(`legacy:${sourceIdentity(event)}`, event);
    }
  }
  return [...latest.values()].filter(
    (event) =>
      event.text &&
      (event.presentation?.purpose === "progress" ||
        ["source.coverage", "source.streaming"].includes(event.type)),
  );
}

function progressLabel(type: string, text: string) {
  if (type !== "source.coverage") return text;
  if (text === "La fuente no devolvió evidencia utilizable en esta consulta.")
    return "No se encontraron resultados...";
  if (text.startsWith("Consultando la fuente seleccionada"))
    return "Consultando fuentes...";
  if (
    text ===
    "Información recuperada de la fuente; pendiente de análisis y verificación."
  )
    return "Analizando resultados...";
  return text;
}

function sourceIdentity(item: Pick<SimEvent, "source" | "sourceLabel">) {
  return item.sourceLabel ?? item.source ?? "desk";
}

function turnProgress(snapshot: Snapshot, requestId: string, running: boolean) {
  const outputs = snapshot.findings.filter(
    (finding) =>
      finding.requestId === requestId &&
      !!finding.text.trim() &&
      finding.source !== "analysis" &&
      (finding.source !== "desk" || !!finding.sourceLabel),
  );
  const activity = progressEvents(snapshot.events, requestId, running);
  const visibleOutputs = outputs.filter(
    (finding) =>
      !activity.some(
        (event) =>
          event.type === "source.streaming" &&
          sourceIdentity(event) === sourceIdentity(finding),
      ),
  );
  return { outputs, activity, visibleOutputs };
}

/** Public task activity, never generated reasoning or a second simulation clock. */
export function ToolProgress() {
  const { snapshot, messagePrefix = "" } = useContext(ChatActionsContext)!;
  const [existingFindings] = useState(
    () => new Set(snapshot.findings.map((finding) => finding.id)),
  );
  const id = useAuiState((state) => state.message.id);
  const conversation = snapshot.conversations.find(
    (item) => `${messagePrefix}${item.id}-assistant` === id,
  );
  if (!conversation) return null;
  const { outputs, activity, visibleOutputs } = turnProgress(
    snapshot,
    conversation.id,
    conversation.status === "running",
  );
  const groups = groupProgress(activity, visibleOutputs);
  if (!outputs.length && !activity.length && conversation.status !== "running")
    return null;
  const thinking =
    conversation.status === "running" &&
    !activity.length &&
    !conversation.answer &&
    !snapshot.findings.some((finding) => finding.requestId === conversation.id);
  const duration = formatWorkDuration(
    (conversation.completedAt ?? snapshot.time) - conversation.createdAt,
  );
  const analysisTasks = snapshot.tasks.filter(
    (task) => task.requestId === conversation.id && task.source === "analysis",
  );
  const working = analysisTasks.find((task) => task.status === "running");
  const label = thinking ? "thinking" : `Worked for ${duration}`;
  const analysisStarted = analysisTasks.some((task) =>
    ["running", "completed"].includes(task.status),
  );
  return (
    <>
      <details
        className="tool-progress"
        open={
          conversation.status === "running" &&
          !analysisStarted &&
          !conversation.answer
        }
      >
        <summary
          data-tooltip-disabled="true"
          aria-label={label}
          aria-live={thinking ? "polite" : undefined}
        >
          <ChevronRight size={12} aria-hidden="true" />
          <span
            className={`t-shimmer${thinking ? " thinking-indicator" : ""}`}
            data-text={label}
            data-running={conversation.status === "running"}
            data-playing={snapshot.playing}
            aria-hidden="true"
          >
            {label}
          </span>
        </summary>
        <ol>
          {[...groups].map(([key, group]) => (
            <li key={key}>
              <ToolIcon source={group.source ?? "desk"} size={14} />
              <div>
                <div className="tool-progress-label">
                  <strong>{group.label}</strong>
                </div>
                {group.events.map((event) => (
                  <ProgressActivity
                    key={`${event.presentation ? "typed" : "legacy"}-${event.presentation?.activity?.activity_id ?? sourceIdentity(event)}`}
                    event={event}
                    running={conversation.status === "running"}
                  />
                ))}
                {group.findings.map((finding) => (
                  <div key={finding.id} data-tool-status="completed">
                    <MarkdownText
                      text={finding.text}
                      live={conversation.status === "running"}
                      animateInitial={!existingFindings.has(finding.id)}
                      compact
                    />
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </details>
      {working && (
        <div
          className="tool-progress-analysis"
          role="status"
          aria-label="Analizando resultados"
        >
          <div
            className="t-matrix"
            data-playing={snapshot.playing}
            aria-hidden="true"
          >
            {Array.from({ length: 16 }, (_, index) => (
              <i
                key={index}
                style={{ animationDelay: `${(index % 4) * 120}ms` }}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function ProgressActivity({
  event,
  running,
}: {
  event: SimEvent;
  running: boolean;
}) {
  return (
    <div
      data-activity-id={event.presentation?.activity?.activity_id}
      data-tool-status={
        !running &&
        ["running", "pending"].includes(
          event.presentation?.activity?.state ?? "running",
        )
          ? "interrupted"
          : (event.presentation?.activity?.state ?? "running")
      }
    >
      <MarkdownText
        text={
          event.presentation
            ? event.text
            : progressLabel(event.type, event.text)
        }
        live={running}
        compact
      />
    </div>
  );
}

function groupProgress(activity: SimEvent[], visibleOutputs: Finding[]) {
  const groups = new Map<
    string,
    {
      source: SimEvent["source"];
      label: string;
      events: SimEvent[];
      findings: Finding[];
    }
  >();
  for (const item of [...activity, ...visibleOutputs]) {
    const key = sourceIdentity(item);
    if (!groups.has(key))
      groups.set(key, {
        source: item.source,
        label: item.sourceLabel ?? sourceLabels[item.source ?? "desk"],
        events: [],
        findings: [],
      });
  }
  for (const event of activity)
    groups.get(sourceIdentity(event))!.events.push(event);
  for (const finding of visibleOutputs)
    groups.get(sourceIdentity(finding))!.findings.push(finding);
  return groups;
}
