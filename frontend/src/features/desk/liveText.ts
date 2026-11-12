type Packet = Record<string, unknown>;
export interface TextStream {
  id: string;
  block: string;
  revision: number;
  source: string | null;
  sources: string[];
  index: number;
  phase: "start" | "delta" | "end";
  text: string;
  characters: number;
}
export interface LiveText {
  streams: Map<string, TextStream>;
  retired: Set<string>;
  seen: Map<string, string>;
  sealed: boolean;
}
export const emptyLiveText = (): LiveText => ({
  streams: new Map(),
  retired: new Set(),
  seen: new Map(),
  sealed: false,
});
const short = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

function parseTextIdentity(packet: Packet, requestId: string) {
  const {
    stream_id: id,
    block_id: block,
    block_revision: revision,
    delta_index: index,
  } = packet;
  if (
    packet.request_id !== requestId ||
    packet.turn_id !== requestId ||
    typeof id !== "string" ||
    !/^[a-f0-9]{32}$/i.test(id) ||
    !short(block) ||
    !Number.isSafeInteger(revision) ||
    Number(revision) < 0 ||
    !Number.isSafeInteger(index) ||
    Number(index) < 0 ||
    Number(index) >= 1024
  )
    throw new TypeError("Fragmento público no válido");
  return { id, block, revision: Number(revision), index: Number(index) };
}

function parseTextFragment(packet: Packet, requestId: string) {
  const identity = parseTextIdentity(packet, requestId);
  const { phase, text, source_key: source, source_keys: sources } = packet;
  if (
    typeof phase !== "string" ||
    !["start", "delta", "end", "discard"].includes(phase) ||
    packet.status !== "provisional" ||
    typeof text !== "string" ||
    (source !== null && !short(source)) ||
    !Array.isArray(sources) ||
    sources.length > 8 ||
    !sources.every(short)
  )
    throw new TypeError("Fragmento público no válido");
  const characters = Array.from(text).length;
  if (
    (phase === "delta" ? characters < 1 || characters > 2048 : text !== "") ||
    (phase === "start" && identity.index !== 0)
  )
    throw new TypeError("Contenido de fragmento no válido");
  return {
    ...identity,
    phase: phase as "start" | "delta" | "end" | "discard",
    text,
    source,
    sources,
    characters,
  };
}

export function acceptLiveText(
  current: LiveText,
  packet: Packet,
  requestId: string,
  signature: string,
): LiveText {
  const {
    id,
    block,
    revision,
    index,
    phase,
    text,
    source,
    sources,
    characters,
  } = parseTextFragment(packet, requestId);
  const key = `${id}:${index}`;
  const prior = current.seen.get(key);
  if (prior !== undefined) {
    if (prior !== signature)
      throw new TypeError("Fragmento inmutable modificado");
    return current;
  }
  if (current.seen.size >= 1024)
    throw new TypeError("Demasiados fragmentos públicos");
  const next: LiveText = {
    ...current,
    streams: new Map(current.streams),
    retired: new Set(current.retired),
    seen: new Map(current.seen),
  };
  next.seen.set(key, signature);
  if (next.sealed || next.retired.has(id)) return next;
  return applyTextFragment(next, {
    id,
    block,
    revision,
    index,
    phase,
    text,
    source,
    sources,
    characters,
  });
}

function startTextStream(
  next: LiveText,
  fragment: TextFragment,
  active: TextStream | undefined,
) {
  const { id, block, revision, source, sources } = fragment;
  if ([...next.streams.values()].some((stream) => stream.id === id))
    throw new TypeError("Identidad de stream modificada");
  if (active) {
    if (Number(revision) < active.revision)
      throw new TypeError("Revisión de texto anterior");
    next.retired.add(active.id);
  }
  next.streams.set(block, {
    id,
    block,
    revision: Number(revision),
    source,
    sources,
    index: 0,
    phase: "start",
    text: "",
    characters: 0,
  });
}

type TextFragment = ReturnType<typeof parseTextFragment>;

function applyTextFragment(next: LiveText, fragment: TextFragment): LiveText {
  const {
    id,
    block,
    revision,
    index,
    phase,
    text,
    source,
    sources,
    characters,
  } = fragment;
  const active = next.streams.get(block);
  if (phase === "start") {
    startTextStream(next, fragment, active);
    return next;
  }
  if (
    !active ||
    active.id !== id ||
    active.revision !== revision ||
    active.source !== source ||
    JSON.stringify(active.sources) !== JSON.stringify(sources)
  )
    throw new TypeError("Stream de texto no iniciado o incompatible");
  if (index !== active.index + 1)
    throw new TypeError("Fragmento de texto fuera de orden");
  if (phase === "discard") {
    next.retired.add(id);
    next.streams.delete(block);
    return next;
  }
  if (active.phase === "end")
    throw new TypeError("Stream de texto ya terminado");
  if (active.characters + characters > 20000)
    throw new TypeError("Texto provisional demasiado grande");
  next.streams.set(block, {
    ...active,
    index: Number(index),
    phase: phase as "delta" | "end",
    text: active.text + text,
    characters: active.characters + characters,
  });
  return next;
}

export function retireLiveText(
  current: LiveText,
  block?: string,
  revision?: number,
): LiveText {
  const next = {
    ...current,
    streams: new Map(current.streams),
    retired: new Set(current.retired),
  };
  for (const [key, stream] of next.streams) {
    if (
      block !== undefined &&
      (key !== block || (revision !== undefined && revision < stream.revision))
    )
      continue;
    next.retired.add(stream.id);
    next.streams.delete(key);
  }
  if (block === undefined) next.sealed = true;
  return next;
}
