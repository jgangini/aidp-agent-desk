import { afterEach, expect, it, vi } from "vitest";
import {
  createVoiceSignal,
  createVoiceEnvelope,
  microphoneEnergy,
} from "./voice";
import { dictationAdapter, speechAdapter } from "./voiceAdapters";

afterEach(() => vi.unstubAllGlobals());

it("reacts only to measured energy or word events and rejects stale owners", () => {
  const voice = createVoiceSignal();
  const release = vi.fn();
  const first = voice.start("speaking", release);
  expect(voice.sample(0).level).toBe(0);
  voice.word(first, 1000);
  expect(voice.sample(1000).level).toBe(1);
  expect(voice.sample(1500).level).toBeLessThan(0.03);
  const second = voice.start("listening", vi.fn());
  expect(release).toHaveBeenCalledOnce();
  voice.amplitude(first, 1);
  voice.end(first);
  expect(voice.sample(1600)).toEqual({
    mode: "listening",
    level: 0,
    generation: second,
  });
  voice.amplitude(second, 0.6);
  expect(voice.sample(1700).level).toBe(0.6);
  voice.stop();
  expect(voice.sample(1800)).toEqual({
    mode: "idle",
    level: 0,
    generation: second + 1,
  });
  expect(microphoneEnergy(new Uint8Array(512).fill(128))).toBe(0);
  expect(microphoneEnergy(new Uint8Array(512).fill(145))).toBeGreaterThan(0.5);
});

it("uses real synthesis boundary events without inventing beats before they arrive", () => {
  class Utterance extends EventTarget {
    constructor(public text: string) {
      super();
    }
  }
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  const synth = { speak: vi.fn(), cancel: vi.fn() };
  vi.stubGlobal("speechSynthesis", synth);
  const voice = createVoiceSignal();
  const result = speechAdapter(voice).speak("Uno dos");
  expect(voice.sample(performance.now()).level).toBe(0);
  const utterance = synth.speak.mock.calls[0][0] as Utterance;
  utterance.dispatchEvent(
    Object.assign(new Event("boundary"), { name: "word" }),
  );
  expect(voice.sample(performance.now()).level).toBeGreaterThan(0.9);
  result.cancel();
  expect(synth.cancel).toHaveBeenCalled();
  expect(voice.sample(performance.now()).mode).toBe("idle");
  utterance.dispatchEvent(new Event("start"));
  expect(result.status).toEqual({ type: "ended", reason: "cancelled" });
  utterance.dispatchEvent(
    Object.assign(new Event("boundary"), { name: "word" }),
  );
  expect(voice.sample(performance.now()).level).toBe(0);
});

it("stops microphone tracks when a permission promise resolves after cancellation", async () => {
  class Recognition extends EventTarget {
    lang = "";
    continuous = false;
    interimResults = false;
    start() {}
    stop() {}
    abort() {}
  }
  vi.stubGlobal("SpeechRecognition", Recognition);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  let resolve!: (stream: MediaStream) => void;
  const getUserMedia = vi.fn(
    () =>
      new Promise<MediaStream>((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  const Context = vi.fn();
  vi.stubGlobal("AudioContext", Context);
  const voice = createVoiceSignal();
  const session = dictationAdapter(voice, vi.fn()).listen();
  expect(getUserMedia).toHaveBeenCalledOnce();
  session.cancel();
  const stop = vi.fn();
  resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await Promise.resolve();
  await Promise.resolve();
  expect(stop).toHaveBeenCalledOnce();
  expect(Context).not.toHaveBeenCalled();
  expect(voice.sample(1000).mode).toBe("idle");
});

it("releases active microphone resources when the page is hidden even if animation frames stop", async () => {
  class Recognition extends EventTarget {
    lang = "";
    continuous = false;
    interimResults = false;
    start() {}
    stop() {}
    abort() {}
  }
  vi.stubGlobal("SpeechRecognition", Recognition);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const stop = vi.fn();
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [{ stop }] }),
    },
  });
  const close = vi.fn(async () => {});
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      close = close;
      resume = async () => {};
      createMediaStreamSource() {
        return { connect: vi.fn() };
      }
      createAnalyser() {
        return {
          fftSize: 512,
          getByteTimeDomainData: (samples: Uint8Array) => samples.fill(128),
        };
      }
    },
  );
  const voice = createVoiceSignal();
  dictationAdapter(voice, vi.fn()).listen();
  await Promise.resolve();
  await Promise.resolve();
  expect(stop).not.toHaveBeenCalled();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  try {
    document.dispatchEvent(new Event("visibilitychange"));
  } finally {
    hidden.mockRestore();
  }
  expect(stop).toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
  expect(voice.sample(1000).mode).toBe("idle");
});

it("keeps audio activation independent from silent sessions, pause and reduced motion", () => {
  const envelope = createVoiceEnvelope(0);
  const silent = { mode: "listening" as const, level: 0, generation: 1 };
  expect(envelope(silent, 100, true, false).listening).toBe(0);
  const heard = envelope({ ...silent, level: 0.5 }, 200, true, false);
  expect(heard.listening).toBeGreaterThan(0);
  expect(heard.level).toBeGreaterThan(0);
  const paused = envelope(
    { mode: "speaking", level: 1, generation: 2 },
    300,
    false,
    false,
  );
  expect(paused.level).toBe(heard.level);
  expect(paused.colorTime).toBe(0);
  const speaking = envelope(
    { mode: "speaking", level: 1, generation: 2 },
    400,
    true,
    false,
  );
  expect(speaking.colorTime).toBeGreaterThan(0);
  const reduced = envelope(
    { mode: "speaking", level: 1, generation: 2 },
    500,
    true,
    true,
  );
  expect(reduced.speaking).toBe(1);
  expect(reduced.listening).toBe(0);
  expect(reduced.colorTime).toBe(speaking.colorTime);
  const restarted = envelope({ ...silent, generation: 3 }, 600, true, true);
  expect(restarted.listening).toBe(0);
  expect(restarted.speaking).toBe(0);
});
