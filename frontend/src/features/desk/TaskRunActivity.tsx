import { Check, CircleDot, Clock3, TriangleAlert } from "lucide-react";
import { MarkdownText } from "./MarkdownText";
import type { TaskRun } from "./scheduledApi";

const labels = {
  running: "En curso",
  pending: "Pendiente",
  completed: "Completada",
  failed: "Fallida",
};
const icons = {
  running: CircleDot,
  pending: Clock3,
  completed: Check,
  failed: TriangleAlert,
};

export function TaskRunActivity({
  activity,
}: {
  activity: TaskRun["activity"];
}) {
  if (!activity?.length) return null;
  return (
    <ol className="task-run-activity" aria-label="Actividad del agente">
      {activity.map((entry) => {
        const Icon = icons[entry.state];
        return (
          <li key={entry.id} data-activity-state={entry.state}>
            <Icon size={16} aria-hidden="true" />
            <div>
              {entry.source && <strong>{entry.source}</strong>}
              <span className="sr-only">{labels[entry.state]}: </span>
              <MarkdownText text={entry.text} live={false} compact />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
