// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { pcmWave, remoteDictationAdapter } from "./remoteVoice";
import { liveCapture } from "./realtimeVoice";
import { createVoiceSignal } from "./voice";

vi.mock("./realtimeVoice", () => ({ liveCapture: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("server audio recording format", () => {
  it("encodes stereo capture as bounded mono PCM16 WAV supported by OCI Gemini", async () => {
    const blob = pcmWave(
      [new Float32Array([-1, 0, 1, 2]), new Float32Array([-1, 0, 1, 2])],
      16000,
    );
    const data = new DataView(await blob.arrayBuffer());
    expect(blob.type).toBe("audio/wav");
    expect(data.getUint16(22, true)).toBe(1);
    expect(data.getUint32(24, true)).toBe(16000);
    expect(data.getUint16(34, true)).toBe(16);
    expect(data.getInt16(44, true)).toBe(-32768);
    expect(data.getInt16(48, true)).toBe(32767);
    expect(data.getInt16(50, true)).toBe(32767);
  });
});

describe("live dictation delivery", () => {
  async function listen(profile = "profile", options?: { stopOnFinal?: boolean; resume?: Promise<void> }) {
    const stop = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn();
    vi.mocked(liveCapture).mockResolvedValue({ stop, cancel });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ mode: "realtime" }))),
    );
    const trackStop = vi.fn();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }),
      },
    });
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const contextClose = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "AudioContext",
      class {
        createMediaStreamSource() {
          return { connect() {}, disconnect() {} };
        }
        createAnalyser() {
          return {
            fftSize: 512,
            getByteTimeDomainData: (data: Uint8Array) => data.fill(128),
          };
        }
        resume() {
          return options?.resume ?? Promise.resolve();
        }
        close() {
          return contextClose();
        }
      },
    );
    const onError = vi.fn();
    const onFinal = vi.fn();
    const session = remoteDictationAdapter(
      profile,
      createVoiceSignal(),
      onError,
      onFinal,
      undefined,
      options,
    ).listen();
    const onSpeech = vi.fn();
    const onEnd = vi.fn();
    session.onSpeech(onSpeech);
    session.onSpeechEnd(onEnd);
    await vi.waitFor(() => expect(vi.mocked(liveCapture)).toHaveBeenCalled());
    if (!options?.resume)
      await vi.waitFor(() => expect(session.status.type).toBe("running"));
    const emit = vi.mocked(liveCapture).mock.calls[0][2];
    return { session, emit, onSpeech, onEnd, onFinal, onError, trackStop, contextClose, stop, cancel };
  }

  it("stops capture immediately, commits the visible partial, and ignores repeated stops", async () => {
    const { session, emit, onSpeech, onEnd, onFinal, trackStop, contextClose, stop, cancel } = await listen();
    stop.mockImplementation(() => new Promise(() => {}));
    emit({ transcript: "Palabras visibles", isFinal: false });
    await session.stop();
    expect(session.status.type).toBe("ended");
    expect(trackStop).toHaveBeenCalled();
    expect(contextClose).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    expect(onSpeech).toHaveBeenLastCalledWith({ transcript: "Palabras visibles", isFinal: true });
    await session.stop();
    emit({ transcript: "Respuesta tardía", isFinal: true });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledExactlyOnceWith("Palabras visibles");
  });

  it.each(["stop", "cancel"] as const)("does not restart capture after %s while the analyser is resuming", async (action) => {
    let resume!: () => void;
    const pending = new Promise<void>((resolve) => { resume = resolve; });
    const { session, trackStop, contextClose, onFinal } = await listen("profile", { resume: pending });
    const onStart = vi.fn();
    session.onSpeechStart(onStart);
    await session[action]();
    resume();
    await Promise.resolve();
    expect(session.status.type).toBe("ended");
    expect(trackStop).toHaveBeenCalled();
    expect(contextClose).toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
  });

  it("ends one conversational turn only on a nonempty final result", async () => {
    const { session, emit, onEnd, onFinal, trackStop } = await listen("profile", { stopOnFinal: true });
    emit({ transcript: "", isFinal: true });
    emit({ transcript: "Consulta", isFinal: false });
    expect(session.status.type).toBe("running");
    emit({ transcript: "Consulta final", isFinal: true });
    emit({ transcript: "Duplicado", isFinal: true });
    await session.stop();
    expect(trackStop).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledExactlyOnceWith("Consulta final");
  });

  it("uses the saved audio profile when the conversation targets TEST", async () => {
    const { session } = await listen("test:profile");
    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(options?.body as string)).toEqual({
      profile_id: "profile",
    });
    await session.cancel();
  });

  it("delivers partial revisions immediately and commits each final phrase only once", async () => {
    const { session, emit, onSpeech, onEnd, onFinal, onError } = await listen();
    emit({ transcript: "Hola", isFinal: false });
    expect(onSpeech).toHaveBeenLastCalledWith({
      transcript: "Hola",
      isFinal: false,
    });
    emit({ transcript: "Hola mundo", isFinal: false });
    emit({ transcript: "Hola mundo.", isFinal: true });
    emit({ transcript: "Otra", isFinal: false });
    expect(onSpeech).toHaveBeenLastCalledWith({
      transcript: "Otra",
      isFinal: false,
    });
    emit({ transcript: "Otra frase.", isFinal: true });
    expect(onSpeech).toHaveBeenLastCalledWith({
      transcript: "Otra frase.",
      isFinal: true,
    });
    expect(onFinal).not.toHaveBeenCalled();
    await session.stop();
    expect(onSpeech).toHaveBeenCalledTimes(5);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith({
      transcript: "Hola mundo. Otra frase.",
      isFinal: true,
    });
    expect(onFinal).toHaveBeenCalledExactlyOnceWith("Hola mundo. Otra frase.");
    expect(onError).not.toHaveBeenCalled();
  });

  it("forwards final-only provider results without inventing partial words", async () => {
    const { session, emit, onSpeech, onFinal } = await listen();
    expect(onSpeech).not.toHaveBeenCalled();
    emit({ transcript: "Frase completa.", isFinal: true });
    expect(onSpeech).toHaveBeenCalledExactlyOnceWith({
      transcript: "Frase completa.",
      isFinal: true,
    });
    await session.stop();
    expect(onSpeech).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledExactlyOnceWith("Frase completa.");
  });
});

describe("structured audio configuration feedback", () => {
  it.each([
    { status: 422, tagged: true, warning: true },
    { status: 422, tagged: false, warning: false },
    { status: 502, tagged: true, warning: false },
  ])(
    "classifies status $status tagged $tagged without matching the message",
    async ({ status, tagged, warning }) => {
      const start = vi.fn();
      const onError = vi.fn();
      const required = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ detail: "Same localized message" }), {
            status,
            headers: tagged
              ? { "X-Agent-Desk-Notice": "audio-configuration" }
              : {},
          }),
        ),
      );
      const session = remoteDictationAdapter(
        "profile",
        createVoiceSignal(),
        onError,
        undefined,
        { onStart: start, onConfigurationRequired: required },
      ).listen();
      expect(start).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(session.status.type).toBe("ended"));
      expect(required).toHaveBeenCalledTimes(warning ? 1 : 0);
      expect(onError).toHaveBeenCalledTimes(warning ? 0 : 1);
    },
  );

  it("does not report a response from a cancelled voice attempt", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const onError = vi.fn();
    const required = vi.fn();
    const session = remoteDictationAdapter(
      "profile",
      createVoiceSignal(),
      onError,
      undefined,
      { onConfigurationRequired: required },
    ).listen();
    session.cancel();
    resolve(
      new Response(JSON.stringify({ detail: "Late configuration warning" }), {
        status: 422,
        headers: { "X-Agent-Desk-Notice": "audio-configuration" },
      }),
    );
    await new Promise((done) => setTimeout(done, 10));
    expect(required).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

it("classifies a TTS precondition as configuration feedback and starts a fresh attempt", async () => {
  const { remoteSpeechAdapter } = await import("./remoteVoice");
  const onError = vi.fn();
  const onStart = vi.fn();
  const required = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Configure the voice" }), {
        status: 422,
        headers: { "X-Agent-Desk-Notice": "audio-configuration" },
      }),
    ),
  );
  const utterance = remoteSpeechAdapter(
    "profile",
    createVoiceSignal(),
    onError,
    { onStart, onConfigurationRequired: required },
  ).speak("Hola");
  expect(onStart).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(utterance.status.type).toBe("ended"));
  expect(required).toHaveBeenCalledExactlyOnceWith("Configure the voice");
  expect(onError).not.toHaveBeenCalled();
});
