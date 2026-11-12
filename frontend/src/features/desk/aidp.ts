import {
  acceptLiveText,
  emptyLiveText,
  retireLiveText,
  type LiveText,
} from "./liveText";
import {
  acceptContentItems,
  type ContentItem,
  type ContentItems,
} from "./contentItems";
import { eventPresentation } from "./presentation";
import { readTaskReport, type TaskReport } from "./report";
import {
  parseReference,
  type Reference,
  type Artifact,
} from "./publicManifest";
/** Browser boundary for normalized public packets. Native OCI SSE must be decoded server-side. */
type ObjectValue = Record<string, unknown>;
export interface PublicEvent extends ObjectValue {
  event_id: string;
  sequence: number;
  turn_id: string;
  type: string;
  block_id?: string | null;
  status?: string;
  evidence_ids?: string[];
}
export interface PublicResponse extends ObjectValue {
  status: string;
  resumable?: boolean;
  artifacts: Artifact[];
  references: Reference[];
}
export interface AgentView {
  requestId: string;
  cursor: number;
  liveText: LiveText;
  blocks: Map<string, PublicEvent>;
  artifacts: Map<string, Artifact>;
  references: Map<string, Reference>;
  events: Map<string, string>;
  activities: Map<string, PublicEvent>;
  contentItems?: ContentItems;
  contentHistory: Map<string, ContentItem>;
  response?: PublicResponse;
  final?: PublicResponse;
  report?: TaskReport;
  reportIssue?: string;
}
export class ReplayRequired extends Error {
  constructor(public afterSequence: number) {
    super("Recupera esta solicitud con replay antes de continuar.");
  }
}
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Objeto público no válido");
  return value as ObjectValue;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 800)
    throw new TypeError("Manifest no válido");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 100000)
    throw new TypeError("Texto no válido");
  return value;
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}
function artifact(value: unknown): Artifact {
  const item = object(value);
  text(item.artifact_id);
  list(item.evidence_ids).forEach(text);
  return item as Artifact;
}
function manifests(
  view: AgentView,
  references: unknown = [],
  artifacts: unknown = [],
) {
  for (const value of list(references)) {
    const item = parseReference(value);
    const prior = view.references.get(item.evidence_id);
    if (prior && prior.url !== item.url)
      throw new TypeError("El destino de evidencia cambió");
    view.references.set(item.evidence_id, { ...prior, ...item });
  }
  for (const value of list(artifacts)) {
    const item = artifact(value);
    view.artifacts.set(item.artifact_id, item);
  }
}
function parseEvent(view: AgentView, value: unknown): PublicEvent {
  const item = object(value);
  text(item.event_id);
  text(item.type);
  if (
    item.turn_id !== view.requestId ||
    !Number.isSafeInteger(item.sequence) ||
    Number(item.sequence) < 1
  )
    throw new TypeError("Identidad o secuencia no válida");
  if (item.block_id != null) text(item.block_id);
  if (item.evidence_ids !== undefined) list(item.evidence_ids).forEach(text);
  eventPresentation(item);
  return item as PublicEvent;
}
function rememberEvent(view: AgentView, item: PublicEvent) {
  const identity = canonical(item);
  const prior = view.events.get(item.event_id);
  if (prior !== undefined) {
    if (prior !== identity) throw new TypeError("Evento inmutable modificado");
  }
  view.events.set(item.event_id, identity);
  const activity = eventPresentation(item)?.activity;
  if (
    activity &&
    (view.activities.get(activity.activity_id)?.sequence ?? 0) <= item.sequence
  )
    view.activities.set(activity.activity_id, item);
}
function event(view: AgentView, value: unknown): boolean {
  const item = parseEvent(view, value);
  if (view.events.has(item.event_id)) {
    rememberEvent(view, item);
    return false;
  }
  if (item.sequence !== view.cursor + 1) throw new ReplayRequired(view.cursor);
  rememberEvent(view, item);
  view.cursor = Number(item.sequence);
  if (item.block_id) {
    view.blocks.set(String(item.block_id), item as PublicEvent);
    if (
      ["draft.upsert", "draft.corrected", "draft.compacted"].includes(
        String(item.type),
      )
    )
      view.liveText = retireLiveText(
        view.liveText,
        String(item.block_id),
        typeof item.block_revision === "number"
          ? item.block_revision
          : undefined,
      );
  }
  return true;
}
function response(view: AgentView, value: unknown) {
  if (!value) return;
  const item = object(value);
  text(item.status);
  if (item.resumable !== undefined && typeof item.resumable !== "boolean")
    throw new TypeError("Estado resumable no válido");
  const parsed = {
    ...item,
    artifacts: list(item.artifacts).map(artifact),
    references: list(item.references).map(parseReference),
  } as PublicResponse;
  view.response = parsed;
  view.report = undefined;
  view.reportIssue = undefined;
  if (parsed.status === "pending" || parsed.resumable) return;
  view.final = parsed;
  view.artifacts = new Map();
  manifests(view, parsed.references, parsed.artifacts);
  if (["complete", "completed", "partial"].includes(parsed.status))
    Object.assign(
      view,
      readTaskReport(
        parsed.report,
        new Map(parsed.references.map((ref) => [ref.evidence_id, ref])),
      ),
    );
}
export function createAgentView(requestId: string): AgentView {
  if (!requestId || requestId.length > 128)
    throw new TypeError("Identidad no válida");
  return {
    requestId,
    cursor: 0,
    liveText: emptyLiveText(),
    blocks: new Map(),
    artifacts: new Map(),
    references: new Map(),
    events: new Map(),
    activities: new Map(),
    contentHistory: new Map(),
  };
}
function restoreActivities(
  view: AgentView,
  snapshot: ObjectValue,
  cursor: number,
) {
  const inventory = object(
    snapshot.activities !== undefined
      ? snapshot.activities
      : snapshot.activity !== undefined
        ? snapshot.activity
        : {},
  );
  const entries = Object.entries(inventory);
  if (entries.length > 800) throw new TypeError("Demasiadas actividades");
  for (const [key, value] of entries) {
    const item = parseEvent(view, value);
    const activity = eventPresentation(item)?.activity;
    if (
      item.type !== "source.coverage" ||
      item.sequence > cursor ||
      (snapshot.activities !== undefined &&
        (!activity || key !== activity.activity_id))
    )
      throw new TypeError("Inventario de actividades no válido");
    rememberEvent(view, item);
  }
}

function restoreSnapshot(view: AgentView, packet: ObjectValue) {
  view.liveText = retireLiveText(view.liveText);
  manifests(view, packet.references, packet.artifacts);
  const replay = object(packet.replay);
  if (
    !Number.isSafeInteger(replay.cursor) ||
    Number(replay.cursor) < view.cursor
  )
    throw new TypeError("Cursor no válido");
  if (replay.snapshot) {
    const snapshot = object(replay.snapshot);
    view.blocks = new Map();
    view.artifacts = new Map();
    view.activities = new Map();
    for (const value of Object.values(object(snapshot.blocks))) {
      const item = parseEvent(view, value);
      if (
        item.turn_id !== view.requestId ||
        !item.block_id ||
        !Number.isSafeInteger(item.sequence) ||
        Number(item.sequence) > Number(replay.cursor) ||
        Number(item.sequence) < 1
      )
        throw new TypeError("Bloque de snapshot no válido");
      rememberEvent(view, item);
      view.blocks.set(String(item.block_id), item as PublicEvent);
    }
    restoreActivities(view, snapshot, Number(replay.cursor));
    manifests(view, [], Object.values(object(snapshot.artifacts)));
    view.cursor = Number(replay.cursor);
  } else {
    list(replay.events).forEach((item) => event(view, item));
    if (view.cursor !== replay.cursor) throw new ReplayRequired(view.cursor);
  }
  response(view, packet.response);
}

function acceptAgentText(view: AgentView, packet: ObjectValue) {
  view.liveText = acceptLiveText(
    view.liveText,
    packet,
    view.requestId,
    canonical(packet),
  );
  const stream = view.liveText.streams.get(String(packet.block_id));
  const durable = view.blocks.get(String(packet.block_id));
  if (
    stream &&
    durable &&
    typeof durable.block_revision === "number" &&
    durable.block_revision >= stream.revision
  )
    view.liveText = retireLiveText(
      view.liveText,
      stream.block,
      durable.block_revision,
    );
}

function reconcileAgentView(view: AgentView, packet: ObjectValue) {
  if (view.final) {
    view.liveText = retireLiveText(view.liveText);
    view.artifacts = new Map(
      view.final.artifacts.map((item) => [item.artifact_id, item]),
    );
  }
  const withdrawn = new Set(
    [...view.blocks.values()]
      .filter(
        (block) =>
          block.type === "draft.corrected" && block.status === "failed",
      )
      .flatMap((block) => block.evidence_ids ?? []),
  );
  for (const [id, item] of view.artifacts)
    if (item.evidence_ids.some((key) => withdrawn.has(key)))
      view.artifacts.delete(id);
  if (["event", "response", "snapshot"].includes(String(packet.kind))) {
    view.contentItems = acceptContentItems(
      view.contentItems,
      packet.content_items,
      view.references,
      view.contentHistory,
    ).collection;
    for (const item of view.contentItems?.items ?? [])
      view.contentHistory.set(item.item_id, item);
  }
}

export function reduceAgentPacket(
  current: AgentView,
  incoming: unknown,
): AgentView {
  const packet = object(structuredClone(incoming));
  if (packet.protocol !== "ai-market-intelligence" || packet.version !== "2.0")
    throw new TypeError("Se requiere un paquete público v2 normalizado");
  const request =
    packet.kind === "event" ? object(packet.event).turn_id : packet.request_id;
  if (request !== current.requestId)
    throw new TypeError("Paquete de otra solicitud");
  const view = {
    ...current,
    blocks: new Map(current.blocks),
    artifacts: new Map(current.artifacts),
    references: new Map(current.references),
    events: new Map(current.events),
    activities: new Map(current.activities),
    contentHistory: new Map(current.contentHistory),
  };
  if (packet.kind === "event") {
    event(view, packet.event);
    manifests(view, packet.references, packet.artifacts);
  } else if (packet.kind === "text") {
    acceptAgentText(view, packet);
  } else if (packet.kind === "response") {
    manifests(view, packet.references, packet.artifacts);
    response(view, packet.response);
  } else if (packet.kind === "snapshot") {
    restoreSnapshot(view, packet);
  } else if (packet.kind !== "heartbeat")
    throw new TypeError("Paquete privado o desconocido");
  reconcileAgentView(view, packet);
  return view;
}

/** Transport-independent NDJSON framing, including UTF-8 and JSON split across chunks. */
export async function* readPublicPackets(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
      const { value, done } = await reader.read();
      if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
      pending += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop()!;
      for (const line of lines) {
        if (line.length > 2_097_152)
          throw new TypeError("Paquete demasiado grande");
        if (line.trim()) yield JSON.parse(line);
      }
      if (pending.length > 2_097_152)
        throw new TypeError("Paquete demasiado grande");
      if (done) {
        if (pending.trim()) yield JSON.parse(pending);
        break;
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function retireAgentText(view: AgentView): AgentView {
  return view.liveText.sealed
    ? view
    : { ...view, liveText: retireLiveText(view.liveText) };
}
