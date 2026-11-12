import { record } from "../../shared/record";
import { parseReference } from "./publicManifest";
import { parsePresentation } from "./presentation";
import {
  acceptContentItems,
  parseContentItems,
  parseContentHistory,
} from "./contentItems";
import { roleLabels, sourceLabels, type Snapshot } from "./types";

type Guard = (value: unknown) => boolean;
const text: Guard = (value) => typeof value === "string";
const number: Guard = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const boolean: Guard = (value) => typeof value === "boolean";
const oneOf =
  (...values: unknown[]): Guard =>
  (value) =>
    values.includes(value);
const list =
  (guard: Guard): Guard =>
  (value) =>
    Array.isArray(value) && value.every(guard);

export const shape = (
  value: unknown,
  fields: Record<string, Guard>,
  optional: Record<string, Guard> = {},
) =>
  record(value) &&
  Object.entries(fields).every(([key, guard]) => guard(value[key])) &&
  Object.entries(optional).every(
    ([key, guard]) => value[key] === undefined || guard(value[key]),
  );
const source: Guard = (value) =>
  text(value) && Object.hasOwn(sourceLabels, value as string);
const role: Guard = (value) =>
  text(value) && Object.hasOwn(roleLabels, value as string);
export const isEvent: Guard = (value) => {
  if (
    !shape(
      value,
      {
        id: number,
        at: number,
        type: text,
        text,
        from: text,
        to: text,
      },
      { taskId: text, requestId: text, source, sourceLabel: text },
    )
  )
    return false;
  try {
    const item = value as Record<string, unknown>;
    if (item.presentation !== undefined)
      parsePresentation(item.presentation, String(item.type));
    return true;
  } catch {
    return false;
  }
};
const agent: Guard = (value) =>
  shape(
    value,
    {
      id: text,
      name: text,
      role,
      online: boolean,
      queue: list(text),
      completed: number,
      history: list(isEvent),
    },
    { current: text },
  );
const task: Guard = (value) =>
  shape(
    value,
    {
      id: text,
      requestId: text,
      title: text,
      role,
      source,
      dependencies: list(text),
      status: oneOf(
        "waiting",
        "queued",
        "running",
        "retrying",
        "completed",
        "failed",
        "cancelled",
      ),
      duration: number,
      remaining: number,
      attempts: number,
      maxAttempts: number,
      readyAt: number,
      failAttempts: number,
      output: text,
      emitted: number,
    },
    { worker: text },
  );
const reference: Guard = (value) => {
  try {
    parseReference(value);
    return true;
  } catch {
    return false;
  }
};
const artifact: Guard = (value) =>
  shape(value, { artifact_id: text, evidence_ids: list(text) });
const finding: Guard = (value) =>
  shape(
    value,
    {
      id: text,
      requestId: text,
      source,
      title: text,
      text,
      at: number,
    },
    {
      remote: boolean,
      references: list(reference),
      artifact,
      sourceLabel: text,
    },
  );
const conversation: Guard = (value) =>
  shape(
    value,
    {
      id: text,
      question: text,
      answer: text,
      createdAt: number,
      chunks: number,
      status: oneOf("running", "completed", "failed", "cancelled"),
    },
    {
      contentItems: (value) => {
        try {
          return parseContentItems(value) !== undefined;
        } catch {
          return false;
        }
      },
      contentReferences: list(reference),
      contentHistory: (value) => {
        try {
          parseContentHistory(value);
          return true;
        } catch {
          return false;
        }
      },
      issue: (value) =>
        shape(
          value,
          {
            message: text,
            kind: oneOf("warning", "error"),
            recoverable: boolean,
          },
          {
            requestId: (value) =>
              typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value),
          },
        ),
      firstChunkAt: number,
      completedAt: number,
      feedback: oneOf("positive", "negative"),
      usage: (usage) =>
        shape(
          usage,
          {},
          Object.fromEntries(
            [
              "inputTokens",
              "cachedInputTokens",
              "outputTokens",
              "reasoningTokens",
              "contextTokens",
              "contextWindow",
            ].map((key) => [key, number]),
          ),
        ),
    },
  );
export function isSnapshot(value: unknown): value is Snapshot {
  if (
    !shape(value, {
      time: number,
      playing: boolean,
      speed: oneOf(0.5, 1, 2, 4),
      agents: list(agent),
      tasks: list(task),
      events: list(isEvent),
      findings: list(finding),
      conversations: list(conversation),
      failures: number,
      revision: number,
    })
  )
    return false;
  return (value as Snapshot).conversations.every(
    (turn) =>
      !turn.contentItems ||
      !!acceptContentItems(
        undefined,
        turn.contentItems,
        new Map(
          (turn.contentReferences ?? []).map((ref) => [ref.evidence_id, ref]),
        ),
        new Map(),
      ).collection,
  );
}

/** A newer optional capability must not discard otherwise compatible messages. */
export function restoreChatSnapshot(value: unknown): Snapshot | undefined {
  if (!record(value) || !Array.isArray(value.conversations)) return undefined;
  const compatible = {
    ...value,
    conversations: value.conversations.map((turn: unknown) => {
      if (
        !record(turn) ||
        !record(turn.contentItems) ||
        turn.contentItems.schema_version === "1.0"
      )
        return turn;
      const {
        contentItems: _items,
        contentReferences: _refs,
        contentHistory: _history,
        ...legacy
      } = turn;
      return legacy;
    }),
  };
  return isSnapshot(compatible) ? compatible : undefined;
}

export function interruptedSnapshot(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    conversations: snapshot.conversations.map((turn) =>
      turn.status === "running"
        ? {
            ...turn,
            status: "failed",
            completedAt: Date.now(),
            issue: turn.issue ?? {
              message:
                "Se recargó la página durante la consulta. La ejecución en AIDP puede continuar; no se volvió a enviar.",
              kind: "warning",
              recoverable: true,
            },
          }
        : turn,
    ),
  };
}

/** Migrate only exact known transport suffixes written by older Desk versions. */
export function separateLegacyIssues(snapshot: Snapshot): Snapshot {
  const messages = [
    "network error",
    "No se pudo completar el streaming de AIDP. Recupera la misma solicitud con replay.",
    "La conexión terminó sin una respuesta final. Puedes reintentar la consulta.",
    "Se recargó la página durante la consulta. La ejecución en AIDP puede continuar; no se volvió a enviar.",
    "No se pudo confirmar la cancelación en AIDP. La ejecución puede continuar.",
  ];
  return {
    ...snapshot,
    conversations: snapshot.conversations.map((turn) => {
      if (turn.answer === "Agent invocation failed.")
        return {
          ...turn,
          answer: "",
          status: "failed" as const,
          issue: {
            message: "El agente no pudo completar esta solicitud.",
            kind: "error" as const,
            recoverable: false,
          },
        };
      if (turn.status !== "failed" || turn.issue) return turn;
      const message = messages.find(
        (message) =>
          turn.answer === message || turn.answer.endsWith("\n\n" + message),
      );
      if (!message) return turn;
      return {
        ...turn,
        answer:
          turn.answer === message
            ? ""
            : turn.answer.slice(0, -(message.length + 2)),
        issue: {
          message:
            "Se interrumpió la conexión. Puedes intentar recuperar la respuesta de esta solicitud.",
          kind: "warning" as const,
          recoverable: true,
        },
      };
    }),
  };
}
