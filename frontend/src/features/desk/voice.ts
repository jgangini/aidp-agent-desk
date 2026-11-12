export type VoiceMode = "idle" | "listening" | "speaking";

/** Audio and word events own the signal; the renderer only samples it. */
export function createVoiceSignal() {
  let owner = 0;
  let mode: VoiceMode = "idle";
  let level = 0;
  let wordAt = -Infinity;
  let cleanup: (() => void) | undefined;
  const stop = () => {
    owner++;
    mode = "idle";
    level = 0;
    wordAt = -Infinity;
    const release = cleanup;
    cleanup = undefined;
    release?.();
  };
  return {
    start(next: Exclude<VoiceMode, "idle">, release: () => void) {
      stop();
      mode = next;
      cleanup = release;
      return owner;
    },
    end(token: number) {
      if (token === owner) stop();
    },
    owns(token: number) {
      return token === owner && mode !== "idle";
    },
    amplitude(token: number, value: number) {
      if (token === owner && Number.isFinite(value))
        level = Math.min(1, Math.max(0, value));
    },
    word(token: number, now: number) {
      if (token === owner) wordAt = now;
    },
    sample(now: number) {
      const elapsed = Math.max(0, now - wordAt);
      const word = mode === "speaking" ? Math.exp(-elapsed / 135) : 0;
      return { mode, level: Math.max(level, word), generation: owner };
    },
    stop,
  };
}
export type VoiceSignal = ReturnType<typeof createVoiceSignal>;

export function microphoneEnergy(samples: Uint8Array) {
  let sum = 0;
  for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return Math.min(1, Math.max(0, (rms - 0.012) * 8));
}

function dampLevel(
  previous: number,
  target: number,
  lambda: number,
  delta: number,
) {
  const next = target + (previous - target) * Math.exp(-lambda * delta);
  return next < 0.001 ? 0 : next;
}

function tintLevel(
  active: boolean,
  level: number,
  base: number,
  reduced: boolean,
  previous: number,
  delta: number,
) {
  if (reduced) return Number(active);
  return dampLevel(previous, active ? base + level * (1 - base) : 0, 12, delta);
}

type VoiceSample = ReturnType<VoiceSignal["sample"]>;
function createVoiceTint() {
  let generation: number | undefined;
  let heardListening = false;
  let heardSpeaking = false;
  let listening = 0;
  let speaking = 0;
  let colorTime = 0;
  return (
    signal: VoiceSample | undefined,
    delta: number,
    playing: boolean,
    reduced: boolean,
  ) => {
    const before = { listening, speaking, colorTime };
    if (generation !== signal?.generation) {
      generation = signal?.generation;
      heardListening = false;
      heardSpeaking = false;
    }
    heardListening =
      signal?.mode === "listening" && (heardListening || signal.level > 0.001);
    heardSpeaking =
      signal?.mode === "speaking" && (heardSpeaking || signal.level > 0.001);
    const level = signal?.level ?? 0;
    listening = tintLevel(
      heardListening,
      level,
      0.9,
      reduced,
      listening,
      delta,
    );
    speaking = tintLevel(heardSpeaking, level, 0.85, reduced, speaking, delta);
    const paletteMoves = playing && !reduced && heardSpeaking;
    if (paletteMoves) colorTime += delta;
    return {
      listening,
      speaking,
      colorTime,
      changed:
        paletteMoves ||
        before.listening !== listening ||
        before.speaking !== speaking,
    };
  };
}

/** Smooth renderer state independently of audio ownership and simulation ticks. */
export function createVoiceEnvelope(initialTime: number) {
  const tint = createVoiceTint();
  let previousTime = initialTime;
  let level = 0;
  return (
    signal: VoiceSample | undefined,
    now: number,
    playing: boolean,
    reduced: boolean,
  ) => {
    const delta = Math.min(0.1, Math.max(0, now - previousTime) / 1000);
    const previousLevel = level;
    const target = reduced ? 0 : (signal?.level ?? 0);
    if (playing)
      level = dampLevel(level, target, target > level ? 28 : 9, delta);
    previousTime = now;
    const colors = tint(signal, delta, playing, reduced);
    return {
      ...colors,
      level,
      mode: signal?.mode ?? "idle",
      changed: colors.changed || previousLevel !== level,
    };
  };
}
