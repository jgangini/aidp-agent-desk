import { apiFetch as fetch } from "../../shared/identity";
import {
  createAgentView,
  readPublicPackets,
  reduceAgentPacket,
  retireAgentText,
  ReplayRequired,
  type AgentView,
  type PublicEvent,
} from "./aidp";
import type { Reference } from "./publicManifest";
import { deskHeaders } from "./deskHttp";
import type { Conversation, Finding, Snapshot, Source } from "./types";
import { profileIdentity } from "./agentTarget";
import {
  acceptContentItems,
  type ContentItem,
  type ContentItems,
} from "./contentItems";
import { isPublicationParent } from "./publications";
import { eventPresentation } from "./presentation";

function publicationReferences(
  ids: string[] | undefined,
  references: Reference[],
  items: ContentItem[],
) {
  const selected = new Set(ids);
  for (const comment of references.filter((reference) =>
    selected.has(reference.evidence_id),
  )) {
    for (const parent of references.filter((reference) =>
      isPublicationParent(reference, comment),
    ))
      selected.add(parent.evidence_id);
  }
  for (const item of items) {
    if (
      selected.has(item.primary_evidence_id) ||
      item.comments_analysis?.evidence_ids.some((id) => selected.has(id))
    ) {
      selected.add(item.primary_evidence_id);
      item.comments_analysis?.evidence_ids.forEach((id) => selected.add(id));
    }
  }
  const parents = references.filter((reference) =>
    selected.has(reference.evidence_id),
  );
  for (const comment of references) {
    if (parents.some((parent) => isPublicationParent(parent, comment)))
      selected.add(comment.evidence_id);
  }
  return references.filter((reference) => selected.has(reference.evidence_id));
}

function reviewedContent(turn: Conversation, view: AgentView) {
  if (!view.contentItems) return {};
  const history = new Map(
    [...(turn.contentHistory ?? []), ...(turn.contentItems?.items ?? [])].map(
      (item) => [item.item_id, item],
    ),
  );
  const savedReferences = new Map(
    (turn.contentReferences ?? []).map((reference) => [
      reference.evidence_id,
      reference,
    ]),
  );
  const stableDestinations = [...view.references.values()].every(
    (reference) => {
      const prior = savedReferences.get(reference.evidence_id);
      return (
        !prior ||
        (prior.url === reference.url &&
          prior.requested_url === reference.requested_url)
      );
    },
  );
  const review = stableDestinations
    ? acceptContentItems(
        turn.contentItems,
        view.contentItems,
        view.references,
        history,
      )
    : { collection: turn.contentItems, accepted: false };
  const collection = review.collection;
  for (const item of collection?.items ?? []) history.set(item.item_id, item);
  return collection
    ? {
        contentItems: collection,
        contentHistory: [...history.values()].filter(
          (item) =>
            !collection.items.some((active) => active.item_id === item.item_id),
        ),
        contentReferences: review.accepted
          ? [...view.references.values()]
          : turn.contentReferences,
      }
    : {};
}

export function emptyRemoteSnapshot(): Snapshot {
  return {
    time: Date.now(),
    playing: true,
    speed: 1,
    agents: [],
    tasks: [],
    events: [],
    findings: [],
    conversations: [],
    failures: 0,
    revision: 0,
  };
}
const sources = new Set<Source>([
  "web",
  "facebook",
  "instagram",
  "youtube",
  "x",
  "yahoo_finance",
  "analysis",
  "desk",
]);
function source(value: unknown): Source {
  return sources.has(value as Source) ? (value as Source) : "desk";
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function answerMarkdown(response: AgentView["response"]): string {
  const failure = response?.failure;
  if (
    response?.status === "failed" &&
    failure &&
    typeof failure === "object" &&
    !Array.isArray(failure) &&
    ["stage", "error_type"].every((key) => {
      const value = (failure as Record<string, unknown>)[key];
      return typeof value === "string" && !!value.trim() && value.length <= 128;
    })
  )
    return "";
  return string(response?.markdown);
}

function resultFindings(
  view: AgentView,
  blocks: PublicEvent[],
  references: Reference[],
  contentItems: ContentItems | undefined,
  now: number,
): Finding[] {
  const findings: Finding[] = blocks
    .filter(
      (block) =>
        block.block_id !== "consolidated" &&
        (eventPresentation(block)
          ? eventPresentation(block)?.purpose === "result"
          : ["draft.upsert", "draft.corrected", "source.coverage"].includes(
              block.type,
            )) &&
        block.status !== "failed" &&
        block.status !== "cancelled" &&
        string(block.text),
    )
    .map((block) => ({
      id: `${view.requestId}:${block.block_id}`,
      requestId: view.requestId,
      source: source(
        block.source_key ??
          (Array.isArray(block.source_keys) ? block.source_keys[0] : undefined),
      ),
      ...(typeof block.source_key === "string" &&
      !sources.has(block.source_key as Source)
        ? { sourceLabel: block.source_key }
        : {}),
      title:
        string(block.title) ||
        string(block.source_key) ||
        "Resultado del agente",
      text: string(block.text),
      at: now,
      references: publicationReferences(
        block.evidence_ids,
        references,
        contentItems?.items ?? [],
      ),
      remote: true,
    }));
  for (const artifact of view.artifacts.values()) {
    findings.push({
      id: `${view.requestId}:artifact:${artifact.artifact_id}`,
      requestId: view.requestId,
      source: "analysis",
      title: string(artifact.title) || "Datos del agente",
      text: string(artifact.caption),
      at: now,
      references: references.filter((reference) =>
        artifact.evidence_ids.includes(reference.evidence_id),
      ),
      artifact,
      remote: true,
    });
  }
  if (
    references.length &&
    !findings.some((finding) => finding.references?.length)
  ) {
    findings.push({
      id: `${view.requestId}:references`,
      requestId: view.requestId,
      source: contentItems ? "desk" : "web",
      ...(contentItems ? { sourceLabel: "Fuentes" } : {}),
      title: "Fuentes de la respuesta",
      text: "",
      at: now,
      references,
      remote: true,
    });
  }
  return findings;
}

/** Project only published public blocks and manifests; never infer tool calls. */
export function projectRemoteView(
  snapshot: Snapshot,
  view: AgentView,
  now = Date.now(),
): Snapshot {
  const turn = snapshot.conversations.find(
    (item) => item.id === view.requestId,
  );
  const content = turn ? reviewedContent(turn, view) : {};
  const contentItems =
    content.contentItems ?? turn?.contentItems ?? view.contentItems;
  const blocks = [...view.blocks.values()].sort(
    (a, b) => a.sequence - b.sequence,
  );
  const publicEvents = [...view.events.values()].map(
    (identity) => JSON.parse(identity) as PublicEvent,
  );
  const coverage = [
    ...publicEvents.filter(
      (event) =>
        event.type === "source.coverage" &&
        !event.block_id &&
        !eventPresentation(event)?.activity,
    ),
    ...view.activities.values(),
  ];
  const references = content.contentReferences ?? [...view.references.values()];
  const findings = resultFindings(view, blocks, references, contentItems, now);
  const terminal = view.final;
  const overlays = [...view.liveText.streams.values()].filter(
    (stream) => stream.text,
  );
  const markdown = answerMarkdown(terminal);
  const draftTexts = new Map(
    blocks
      .filter(
        (block) =>
          [
            "draft.upsert",
            "draft.corrected",
            "draft.compacted",
            "clarification.required",
          ].includes(block.type) && block.status !== "failed",
      )
      .map((block) => [String(block.block_id), string(block.text)]),
  );
  for (const overlay of overlays) draftTexts.set(overlay.block, overlay.text);
  const streamed =
    view.liveText.streams.get("consolidated")?.text ||
    draftTexts.get("consolidated");
  const answer =
    markdown ||
    string(
      publicEvents.filter((event) => event.type === "run.completed").at(-1)
        ?.text,
    ) ||
    streamed ||
    blocks
      .filter(
        (block) =>
          block.type === "clarification.required" && block.status !== "failed",
      )
      .map((block) => string(block.text))
      .filter(Boolean)
      .join("\n\n");
  const status: Conversation["status"] = !terminal
    ? "running"
    : terminal.status === "failed"
      ? "failed"
      : terminal.status === "cancelled"
        ? "cancelled"
        : "completed";
  return {
    ...snapshot,
    time: now,
    revision: snapshot.revision + 1,
    findings: [
      ...snapshot.findings.filter(
        (finding) => finding.requestId !== view.requestId,
      ),
      ...findings,
    ],
    conversations: snapshot.conversations.map((turn) =>
      turn.id !== view.requestId
        ? turn
        : {
            ...turn,
            ...content,
            answer,
            status,
            chunks: view.events.size,
            firstChunkAt: turn.firstChunkAt ?? (answer ? now : undefined),
            completedAt: terminal ? now : undefined,
          },
    ),
    events: [
      ...snapshot.events.filter((event) => event.requestId !== view.requestId),
      ...[...blocks, ...coverage]
        .sort((a, b) => a.sequence - b.sequence)
        .map((block) => ({
          id: block.sequence,
          at: now,
          type: block.type,
          text: string(block.text),
          from: "agent",
          to: "desk",
          requestId: view.requestId,
          source: source(block.source_key),
          ...(typeof block.source_key === "string" &&
          !sources.has(block.source_key as Source)
            ? { sourceLabel: block.source_key }
            : {}),
          ...(eventPresentation(block)
            ? { presentation: eventPresentation(block) }
            : {}),
        })),
      ...overlays
        .filter((stream) => stream.block !== "consolidated" && stream.source)
        .map((stream, index) => ({
          id: view.cursor + index + 1,
          at: now,
          type: "source.streaming",
          text: stream.text,
          from: "agent",
          to: "desk",
          requestId: view.requestId,
          source: source(stream.source),
          ...(typeof stream.source === "string" &&
          !sources.has(stream.source as Source)
            ? { sourceLabel: stream.source }
            : {}),
        })),
    ],
  };
}

export interface RemoteRequest {
  profile_id: string;
  session_id: string;
  request_id: string;
  question: string;
  action?: "research" | "replay" | "cancel";
  after_sequence?: number;
}
function httpFailure(
  status: number,
  detail: unknown,
  existingRequest: boolean,
) {
  const message =
    typeof detail === "string"
      ? detail
      : status === 422
        ? "La consulta no es válida. Usa entre 1 y 500 caracteres y una conexión guardada."
        : `No se pudo conectar con Agent Flow (HTTP ${status}).`;
  return new RemoteTurnFailure(
    message,
    !existingRequest && status >= 400 && status < 500
      ? "request_rejected"
      : "stream_interrupted",
  );
}
export async function openRemoteStream(
  request: RemoteRequest,
  signal?: AbortSignal,
  existingRequest = request.action === "replay" || request.action === "cancel",
) {
  const response = await fetch("/api/desk/stream", {
    method: "POST",
    headers: { ...deskHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(
      request.profile_id.startsWith("test:")
        ? {
            ...request,
            profile_id: profileIdentity(request.profile_id),
            surface: "TEST",
          }
        : request,
    ),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw httpFailure(response.status, body.detail, existingRequest);
  }
  if (!response.body)
    throw new Error("Agent Flow no entregó un flujo de respuesta.");
  return response.body;
}
export class RemoteTurnFailure extends Error {
  constructor(
    message: string,
    readonly code = "stream_interrupted",
    readonly pendingRequestId?: string,
  ) {
    super(message);
  }
}
function unfinishedTurn(view: AgentView) {
  if (view.response?.status === "failed" && view.response.resumable)
    return new RemoteTurnFailure(
      "El agente detuvo la investigación. Puedes recuperar esta misma solicitud.",
      "agent_incomplete",
    );
  const pendingId = view.response?.pending_request_id;
  if (view.response?.status !== "pending")
    return new RemoteTurnFailure(
      "La conexión terminó sin una respuesta final. Puedes reintentar la consulta.",
    );
  const foreign = pendingId !== undefined && pendingId !== view.requestId;
  return new RemoteTurnFailure(
    foreign
      ? "Hay una solicitud anterior pendiente en esta conversación. Recupérala o cancélala antes de enviar otra consulta."
      : "La captura sigue pendiente. Puedes recuperar esta misma solicitud.",
    "pending",
    typeof pendingId === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(pendingId)
      ? pendingId
      : undefined,
  );
}
function canContinueTest(
  request: RemoteRequest,
  view: AgentView,
  replayedSnapshot: boolean,
  continuations: number,
) {
  if (
    view.final ||
    !request.profile_id.startsWith("test:") ||
    continuations >= 2
  )
    return false;
  if (view.response?.status === "pending") {
    const pendingId = view.response.pending_request_id;
    return (
      view.response.continuation_safe === true &&
      (pendingId === undefined || pendingId === request.request_id)
    );
  }
  return (
    request.action === "replay" &&
    replayedSnapshot &&
    !view.response &&
    continuations === 0
  );
}
export async function streamRemoteTurn(
  request: RemoteRequest,
  signal: AbortSignal,
  update: (view: AgentView) => void,
) {
  let view = createAgentView(request.request_id);
  let replayCount = 0;
  let continuations = 0;
  let command = request;
  let acceptedStream = request.action === "replay";
  while (true) {
    try {
      const body = await openRemoteStream(command, signal, acceptedStream);
      acceptedStream = true;
      let replayedSnapshot = false;
      for await (const incoming of readPublicPackets(body, signal)) {
        const packet = incoming as Record<string, unknown>;
        if (packet.kind === "transport_error")
          throw new RemoteTurnFailure(
            string(packet.message) || "El transporte de Agent Flow falló.",
            string(packet.code),
          );
        view = reduceAgentPacket(view, incoming);
        replayedSnapshot ||=
          command.action === "replay" && packet.kind === "snapshot";
        update(view);
      }
      if (canContinueTest(request, view, replayedSnapshot, continuations)) {
        // Native replay only reads saved output; the identical question resumes its durable work.
        continuations++;
        command = { ...request, action: "research", after_sequence: undefined };
        view = retireAgentText(view);
        view = {
          ...view,
          liveText: { ...view.liveText, sealed: false },
          response: undefined,
        };
        update(view);
        continue;
      }
      if (!view.final) throw unfinishedTurn(view);
      return view;
    } catch (error) {
      const hadOverlay = view.liveText.streams.size > 0;
      view = retireAgentText(view);
      if (hadOverlay) update(view);
      if (error instanceof ReplayRequired && replayCount++ < 2) {
        command = { ...request, action: "replay", after_sequence: view.cursor };
        continue;
      }
      throw error;
    }
  }
}

export async function confirmRemoteCancellation(
  request: RemoteRequest,
  signal: AbortSignal,
) {
  const body = await openRemoteStream({ ...request, action: "cancel" }, signal);
  let confirmed = false;
  for await (const incoming of readPublicPackets(body, signal)) {
    const packet = incoming as Record<string, unknown>;
    if (packet.kind === "transport_error")
      throw new Error(string(packet.message) || "Cancelación no confirmada.");
    if (
      packet.protocol === "ai-market-intelligence" &&
      packet.version === "2.0" &&
      packet.kind === "response" &&
      packet.request_id === request.request_id &&
      (packet.response as Record<string, unknown> | undefined)?.status ===
        "cancelled"
    )
      confirmed = true;
  }
  if (!confirmed)
    throw new Error("AIDP no confirmó la cancelación de esta solicitud.");
}
