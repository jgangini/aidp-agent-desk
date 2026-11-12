import { record } from "../../shared/record";
import { useEffect, useRef, useState } from "react";
import {
  emptyRemoteSnapshot,
  confirmRemoteCancellation,
  projectRemoteView,
  answerMarkdown,
  streamRemoteTurn,
  RemoteTurnFailure,
  type RemoteRequest,
} from "./remoteAgent";
import type { AgentView } from "./aidp";
import type { Snapshot, TurnIssue } from "./types";
import { readChatStorage, writeChatStorage } from "./chatStorage";
import {
  restoreChatSnapshot,
  interruptedSnapshot,
  separateLegacyIssues,
} from "./snapshot";

function restoreRemoteSessions(): Record<string, Snapshot> {
  const saved = readChatStorage("remote-chats");
  if (!record(saved)) return {};
  return Object.fromEntries(
    Object.entries(saved).flatMap(([id, value]) => {
      const snapshot = restoreChatSnapshot(value);
      return snapshot
        ? [[id, interruptedSnapshot(separateLegacyIssues(snapshot))]]
        : [];
    }),
  );
}

function replayProjection(
  snapshot: Snapshot,
  view: AgentView,
  request: RemoteRequest,
): Snapshot {
  const projected = projectRemoteView(snapshot, view);
  if (request.action !== "replay" || view.response || view.blocks.size)
    return projected;
  return {
    ...projected,
    findings: snapshot.findings,
    events: projected.events.some(
      (event) => event.requestId === request.request_id,
    )
      ? projected.events
      : snapshot.events,
    conversations: projected.conversations.map((turn) =>
      turn.id === request.request_id
        ? {
            ...turn,
            answer:
              snapshot.conversations.find((previous) => previous.id === turn.id)
                ?.answer ?? turn.answer,
          }
        : turn,
    ),
  };
}

function failureIssue(
  error: unknown,
  requestId: string,
  turnId: string,
): TurnIssue {
  const pending =
    error instanceof RemoteTurnFailure && error.code === "pending";
  const recoverable =
    !(error instanceof RemoteTurnFailure) ||
    ![
      "gateway_rejected",
      "unsupported_transport",
      "unsupported_output",
      "native_execution_error",
      "request_mismatch",
      "request_rejected",
    ].includes(error.code);
  const message =
    pending ||
    (error instanceof RemoteTurnFailure &&
      ["test_unavailable", "agent_incomplete"].includes(error.code))
      ? error.message
      : recoverable
        ? "Se interrumpió la conexión. Puedes intentar recuperar la respuesta de esta solicitud."
        : error instanceof Error
          ? error.message
          : "No se pudo conectar con Agent Flow.";

  return {
    message,
    kind:
      recoverable &&
      !(error instanceof RemoteTurnFailure && error.code === "agent_incomplete")
        ? "warning"
        : "error",
    recoverable,
    requestId: pending
      ? error.pendingRequestId
      : turnId !== requestId
        ? requestId
        : undefined,
  };
}

export function useRemoteAgent(
  profileId: string,
  sessionId: string,
  onTitle: (title: string) => void,
) {
  const [sessions, setSessions] = useState(restoreRemoteSessions);
  const deletedSessions = useRef(new Set<string>());
  useEffect(() => {
    writeChatStorage("remote-chats", sessions);
  }, [sessions]);
  const active = useRef<
    | { request: RemoteRequest; controller: AbortController; view?: AgentView }
    | undefined
  >(undefined);
  const update = (id: string, change: (snapshot: Snapshot) => Snapshot) =>
    setSessions((items) =>
      deletedSessions.current.has(id)
        ? items
        : {
            ...items,
            [id]: change(items[id] ?? emptyRemoteSnapshot()),
          },
    );
  const cancel = async () => {
    const current = active.current;
    if (!current) return;
    active.current = undefined;
    current.controller.abort();
    const timeout = AbortSignal.timeout(30000);
    try {
      await confirmRemoteCancellation(
        {
          ...current.request,
          after_sequence: current.view?.cursor ?? 0,
        },
        timeout,
      );
      update(current.request.session_id, (snapshot) => ({
        ...snapshot,
        conversations: snapshot.conversations.map((turn) =>
          turn.id === current.request.request_id ||
          turn.issue?.requestId === current.request.request_id
            ? {
                ...turn,
                status: "cancelled",
                issue: undefined,
                completedAt: Date.now(),
              }
            : turn,
        ),
      }));
    } catch {
      update(current.request.session_id, (snapshot) => ({
        ...snapshot,
        failures: snapshot.failures + 1,
        conversations: snapshot.conversations.map((turn) =>
          turn.id === current.request.request_id
            ? {
                ...turn,
                status: "failed",
                completedAt: Date.now(),
                issue: {
                  message:
                    "No se pudo confirmar la cancelación en AIDP. La ejecución puede continuar.",
                  kind: "warning",
                  recoverable: true,
                },
              }
            : turn,
        ),
      }));
    }
  };
  useEffect(
    () => () => {
      void cancel();
    },
    [profileId, sessionId],
  );
  const run = async (request: RemoteRequest, recoveringId?: string) => {
    const current = {
      request,
      controller: new AbortController(),
      view: undefined as AgentView | undefined,
    };
    active.current = current;
    try {
      const final = await streamRemoteTurn(
        request,
        current.controller.signal,
        (view) => {
          current.view = view;
          update(request.session_id, (snapshot) => {
            return replayProjection(snapshot, view, request);
          });
        },
      );
      update(request.session_id, (snapshot) => ({
        ...snapshot,
        conversations: snapshot.conversations.map((turn) =>
          turn.id === request.request_id || turn.id === recoveringId
            ? {
                ...turn,
                issue:
                  final.final?.status === "failed"
                    ? {
                        message: "El agente no pudo completar esta solicitud.",
                        kind: "error",
                        recoverable: false,
                      }
                    : undefined,
              }
            : turn,
        ),
      }));
      return answerMarkdown(final.final);
    } catch (error) {
      if (!current.controller.signal.aborted) {
        update(request.session_id, (snapshot) => ({
          ...snapshot,
          failures: snapshot.failures + 1,
          conversations: snapshot.conversations.map((turn) =>
            turn.id === request.request_id || turn.id === recoveringId
              ? {
                  ...turn,
                  status: "failed",
                  issue: failureIssue(error, request.request_id, turn.id),
                  completedAt: Date.now(),
                }
              : turn,
          ),
        }));
        throw error;
      }
      return "";
    } finally {
      if (active.current === current) active.current = undefined;
    }
  };
  const send = async (question: string) => {
    if (active.current)
      throw new Error("Espera a que termine la consulta actual.");
    if (profileId === "demo")
      throw new Error("Selecciona un Agent Flow para conectarte.");
    const request: RemoteRequest = {
      profile_id: profileId,
      session_id: sessionId,
      request_id: crypto.randomUUID(),
      question,
    };
    onTitle(question);
    update(sessionId, (snapshot) => ({
      ...snapshot,
      conversations: [
        ...snapshot.conversations,
        {
          id: request.request_id,
          question,
          answer: "",
          createdAt: Date.now(),
          chunks: 0,
          status: "running",
        },
      ],
    }));
    return run(request);
  };
  const recover = async (id: string, noticeId?: string) => {
    if (active.current)
      throw new Error("Espera a que termine la consulta actual.");
    const issueTurn = sessions[sessionId]?.conversations.find(
      (turn) => turn.id === id,
    );
    if (!issueTurn?.issue?.recoverable) return;
    const requestId = issueTurn.issue.requestId ?? id;
    const target = sessions[sessionId]?.conversations.find(
      (turn) => turn.id === requestId,
    );
    if (!target) {
      update(sessionId, (snapshot) => ({
        ...snapshot,
        conversations: snapshot.conversations.map((turn) =>
          turn.id === id
            ? {
                ...turn,
                issue: {
                  message:
                    "No se encontró la solicitud original en esta conversación.",
                  kind: "error",
                  recoverable: false,
                },
              }
            : turn,
        ),
      }));
      return;
    }
    update(sessionId, (snapshot) => ({
      ...snapshot,
      conversations: snapshot.conversations.map((turn) =>
        turn.id === target.id
          ? {
              ...turn,
              status: "running",
              issue: undefined,
              completedAt: undefined,
            }
          : turn,
      ),
    }));
    return run(
      {
        profile_id: profileId,
        session_id: sessionId,
        request_id: target.id,
        question: target.question,
        action: "replay",
        after_sequence: 0,
      },
      noticeId ?? id,
    );
  };

  const snapshot = sessions[sessionId] ?? emptyRemoteSnapshot();
  const running = snapshot.conversations.some(
    (turn) => turn.status === "running",
  );
  const clock = useRemoteClock(running);

  return {
    snapshot: running
      ? { ...snapshot, time: Math.max(snapshot.time, clock) }
      : snapshot,
    send,
    recover,
    cancel,
    deleteConversation: (id: string) => {
      if (active.current?.request.session_id === id) return false;
      deletedSessions.current.add(id);
      setSessions((items) => {
        const next = { ...items };
        delete next[id];
        return next;
      });
      return true;
    },
    feedback: (id: string, feedback: "positive" | "negative") =>
      update(sessionId, (snapshot) => ({
        ...snapshot,
        conversations: snapshot.conversations.map((turn) =>
          turn.id === id ? { ...turn, feedback } : turn,
        ),
      })),
  };
}

function useRemoteClock(running: boolean) {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return clock;
}
