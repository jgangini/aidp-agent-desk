import { apiFetch as fetch } from "../../shared/identity";
import type {
  DictationAdapter,
  SpeechSynthesisAdapter,
} from "@assistant-ui/react";
import { deskHeaders } from "./deskHttp";
import { microphoneEnergy, type VoiceSignal } from "./voice";
import { liveCapture, type RealtimeSession } from "./realtimeVoice";
import { streamingAudio } from "./streamingAudio";
import { profileIdentity } from "./agentTarget";

export function pcmWave(channels: Float32Array[], sampleRate: number): Blob {
  const length = channels[0]?.length ?? 0;
  const bytes = new ArrayBuffer(44 + length * 2);
  const data = new DataView(bytes);
  const word = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++)
      data.setUint8(offset + i, text.charCodeAt(i));
  };
  word(0, "RIFF");
  data.setUint32(4, 36 + length * 2, true);
  word(8, "WAVE");
  word(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, sampleRate, true);
  data.setUint32(28, sampleRate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  word(36, "data");
  data.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const value = Math.max(
      -1,
      Math.min(
        1,
        channels.reduce((sum, channel) => sum + channel[i], 0) /
          channels.length,
      ),
    );
    data.setInt16(
      44 + i * 2,
      Math.round(value * (value < 0 ? 32768 : 32767)),
      true,
    );
  }
  return new Blob([bytes], { type: "audio/wav" });
}
async function recordingWave(recording: Blob) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(
      await recording.arrayBuffer(),
    );
    return pcmWave(
      Array.from({ length: decoded.numberOfChannels }, (_, index) =>
        decoded.getChannelData(index),
      ),
      decoded.sampleRate,
    );
  } finally {
    await context.close();
  }
}

class AudioConfigurationError extends Error {}

interface AudioFeedback {
  onStart?: () => void;
  onConfigurationRequired?: (message: string) => void;
}

function reportFailure(
  error: unknown,
  fallback: string,
  onError: (message: string) => void,
  feedback?: AudioFeedback,
) {
  const message = error instanceof Error ? error.message : fallback;
  if (
    error instanceof AudioConfigurationError &&
    feedback?.onConfigurationRequired
  )
    feedback.onConfigurationRequired(message);
  else onError(message);
}

async function checked(response: Response) {
  if (response.ok) return response;
  const data = await response.json().catch(() => ({}));
  const Failure =
    response.status === 422 &&
    response.headers.get("X-Agent-Desk-Notice") === "audio-configuration"
      ? AudioConfigurationError
      : Error;
  throw new Failure(
    typeof data.detail === "string"
      ? data.detail
      : `El servicio de audio falló (HTTP ${response.status}).`,
  );
}
function analyse(
  context: AudioContext,
  source: AudioNode,
  voice: VoiceSignal,
  token: number,
) {
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  let frame = 0;
  const tick = () => {
    if (!voice.owns(token)) return;
    analyser.getByteTimeDomainData(samples);
    voice.amplitude(token, microphoneEnergy(samples));
    frame = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(frame);
    source.disconnect();
    void context.close().catch(() => {});
  };
}

export function remoteSpeechAdapter(
  profileId: string,
  voice: VoiceSignal,
  onError: (message: string) => void,
  feedback?: AudioFeedback,
): SpeechSynthesisAdapter {
  profileId = profileIdentity(profileId);
  return {
    speak(text) {
      feedback?.onStart?.();
      const subscribers = new Set<() => void>();
      const controller = new AbortController();
      let audio: HTMLAudioElement | undefined;
      let url = "";
      let release: (() => void) | undefined;
      const result: SpeechSynthesisAdapter.Utterance = {
        status: { type: "starting" },
        cancel: () => finish("cancelled"),
        subscribe(callback) {
          subscribers.add(callback);
          return () => {
            subscribers.delete(callback);
          };
        },
      };
      const cleanup = () => {
        controller.abort();
        audio?.pause();
        release?.();
        if (url) URL.revokeObjectURL(url);
      };
      const finish = (reason: "finished" | "cancelled" | "error") => {
        if (result.status.type === "ended") return;
        result.status = { type: "ended", reason };
        cleanup();
        voice.end(token);
        subscribers.forEach((callback) => callback());
      };
      const token = voice.start("speaking", () => finish("cancelled"));
      void fetch("/api/desk/audio/speech", {
        method: "POST",
        headers: { ...deskHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: profileId, text }),
        signal: controller.signal,
      })
        .then(checked)
        .then(async (response) => {
          if (!voice.owns(token)) return;
          audio = new Audio();
          const playback = await streamingAudio(
            response,
            audio,
            controller.signal,
          );
          url = playback.url;
          void playback.done.catch((error) => {
            if (controller.signal.aborted) return;
            onError(
              error instanceof Error
                ? error.message
                : "No se pudo recibir el audio.",
            );
            finish("error");
          });
          audio.addEventListener("ended", () => finish("finished"));
          audio.addEventListener("error", () => {
            if (controller.signal.aborted || !voice.owns(token)) return;
            onError("No se pudo reproducir el audio del agente.");
            finish("error");
          });
          if ("AudioContext" in window) {
            const context = new AudioContext();
            const source = context.createMediaElementSource(audio);
            source.connect(context.destination);
            release = analyse(context, source, voice, token);
            await context.resume();
          }
          if (!voice.owns(token)) {
            cleanup();
            return;
          }
          await audio.play();
          if (!voice.owns(token)) return;
          result.status = { type: "running" };
          subscribers.forEach((callback) => callback());
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          reportFailure(
            error,
            "No se pudo generar la voz del agente.",
            onError,
            feedback,
          );
          finish("error");
        });
      return result;
    },
  };
}

class DictationCapture {
  private starts = new Set<() => void>();
  private ends = new Set<(result: DictationAdapter.Result) => void>();
  private speeches = new Set<(result: DictationAdapter.Result) => void>();
  private controller = new AbortController();
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private live?: Awaited<ReturnType<typeof liveCapture>>;
  private transport?: RealtimeSession | { mode: "batch" };
  private transcript = "";
  private interim = "";
  private release?: () => void;
  private recordingTimer?: ReturnType<typeof setTimeout>;
  private chunks: Blob[] = [];
  private resolveStop!: () => void;
  private stopped = new Promise<void>((resolve) => {
    this.resolveStop = resolve;
  });
  private token: number;
  readonly session: DictationAdapter.Session;

  constructor(
    private profileId: string,
    private voice: VoiceSignal,
    private onError: (message: string) => void,
    private onFinal?: (text: string) => void,
    private feedback?: AudioFeedback,
    private options?: { stopOnFinal?: boolean },
  ) {
    this.session = {
      status: { type: "starting" },
      stop: this.stop,
      cancel: this.cancel,
      onSpeechStart: (callback) => this.subscribe(this.starts, callback),
      onSpeechEnd: (callback) => this.subscribe(this.ends, callback),
      onSpeech: (callback) => this.subscribe(this.speeches, callback),
    };
    this.token = voice.start("listening", () => {
      if (this.session.status.type !== "ended") this.cancel();
    });
  }

  private subscribe<T>(subscribers: Set<T>, callback: T) {
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  }

  private cleanup() {
    clearTimeout(this.recordingTimer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.release?.();
    this.release = undefined;
    this.live?.cancel();
  }

  private end(reason: "stopped" | "cancelled" | "error") {
    if (this.session.status.type === "ended") return;
    this.session.status = { type: "ended", reason };
    this.controller.abort();
    this.cleanup();
    this.voice.end(this.token);
    this.resolveStop();
  }

  private stop = async () => {
    if (this.session.status.type === "ended") return;
    if (this.live || this.transport?.mode === "realtime") {
      if (this.interim) {
        const result = { transcript: this.interim, isFinal: true };
        this.transcript = [this.transcript, this.interim]
          .filter(Boolean)
          .join(" ");
        this.interim = "";
        this.speeches.forEach((callback) => callback(result));
      }
      const result = { transcript: this.transcript, isFinal: true };
      this.end("stopped");
      this.ends.forEach((callback) => callback(result));
      if (this.transcript) this.onFinal?.(this.transcript);
    } else if (this.recorder?.state === "recording") {
      this.recorder.stop();
      this.stream?.getTracks().forEach((track) => track.stop());
      this.release?.();
      this.release = undefined;
    } else {
      this.controller.abort();
      this.end("cancelled");
    }
    await this.stopped;
  };

  private cancel = () => {
    this.controller.abort();
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.end("cancelled");
  };

  private publishLive = (result: DictationAdapter.Result) => {
    if (this.controller.signal.aborted || this.session.status.type === "ended")
      return;
    if (result.isFinal) {
      this.interim = "";
      this.transcript = [this.transcript, result.transcript]
        .filter(Boolean)
        .join(" ");
    } else this.interim = result.transcript;
    this.speeches.forEach((callback) => callback(result));
    if (this.options?.stopOnFinal && result.isFinal && result.transcript.trim())
      void this.stop();
  };

  private failCapture = (error: Error) => {
    if (this.controller.signal.aborted || !this.voice.owns(this.token)) return;
    this.onError(error.message);
    this.end("error");
  };

  private async analyseInput(input: MediaStream) {
    const context = new AudioContext();
    this.release = analyse(
      context,
      context.createMediaStreamSource(input),
      this.voice,
      this.token,
    );
    await context.resume();
  }

  private markRunning() {
    this.recordingTimer = setTimeout(() => {
      void this.stop();
    }, 60000);
    this.session.status = { type: "running" };
    this.starts.forEach((callback) => callback());
  }

  private async captureLive(transport: RealtimeSession, input: MediaStream) {
    this.live = await liveCapture(
      transport,
      input,
      this.publishLive,
      this.failCapture,
      this.controller.signal,
    );
    if (
      this.controller.signal.aborted ||
      this.session.status.type === "ended"
    ) {
      this.cleanup();
      return;
    }
    await this.analyseInput(input);
    if (this.controller.signal.aborted) {
      this.cleanup();
      return;
    }
    this.markRunning();
  }

  private transcribe = async () => {
    this.cleanup();
    if (this.controller.signal.aborted) return;
    try {
      const form = new FormData();
      form.set("profile_id", this.profileId);
      const wave = await recordingWave(
        new Blob(this.chunks, {
          type: this.recorder?.mimeType || "audio/webm",
        }),
      );
      if (this.controller.signal.aborted)
        throw new DOMException("Aborted", "AbortError");
      form.set("audio", wave, "recording.wav");
      const response = await checked(
        await fetch("/api/desk/audio/transcribe", {
          method: "POST",
          headers: deskHeaders,
          body: form,
          signal: this.controller.signal,
        }),
      );
      const data = await response.json();
      if (this.controller.signal.aborted) return;
      const transcript = typeof data.text === "string" ? data.text.trim() : "";
      if (!transcript)
        throw new Error("No se detectaron palabras en la grabación.");
      const result = { transcript, isFinal: true };
      this.speeches.forEach((callback) => callback(result));
      this.end("stopped");
      this.ends.forEach((callback) => callback(result));
      this.onFinal?.(transcript);
    } catch (error) {
      if (this.controller.signal.aborted) return;
      reportFailure(
        error,
        "No se pudo transcribir el audio.",
        this.onError,
        this.feedback,
      );
      this.end("error");
    }
  };

  private async captureBatch(input: MediaStream) {
    this.recorder = new MediaRecorder(input);
    this.recorder.addEventListener("error", () =>
      this.failCapture(new Error("La grabación del micrófono falló.")),
    );
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) this.chunks.push(event.data);
    });
    this.recorder.addEventListener("stop", () => {
      void this.transcribe();
    });
    if ("AudioContext" in window) await this.analyseInput(input);
    if (
      this.controller.signal.aborted ||
      this.session.status.type === "ended"
    ) {
      this.cleanup();
      return;
    }
    this.recorder.start();
    this.markRunning();
  }

  async start() {
    try {
      const response = await checked(
        await fetch("/api/desk/audio/realtime-session", {
          method: "POST",
          headers: { ...deskHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ profile_id: this.profileId }),
          signal: this.controller.signal,
        }),
      );
      this.transport = await response.json();
      if (this.controller.signal.aborted)
        throw new DOMException("Aborted", "AbortError");
      const input = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.stream = input;
      if (this.controller.signal.aborted) {
        this.cleanup();
        return;
      }
      if (this.transport?.mode === "realtime")
        await this.captureLive(this.transport, input);
      else await this.captureBatch(input);
    } catch (error) {
      if (this.controller.signal.aborted) return;
      reportFailure(
        error,
        "No se pudo abrir el micrófono.",
        this.onError,
        this.feedback,
      );
      this.end("error");
    }
  }
}

export function remoteDictationAdapter(
  profileId: string,
  voice: VoiceSignal,
  onError: (message: string) => void,
  onFinal?: (text: string) => void,
  feedback?: AudioFeedback,
  options?: { stopOnFinal?: boolean },
): DictationAdapter {
  profileId = profileIdentity(profileId);
  return {
    listen() {
      feedback?.onStart?.();
      const capture = new DictationCapture(
        profileId,
        voice,
        onError,
        onFinal,
        feedback,
        options,
      );
      void capture.start();
      return capture.session;
    },
  };
}
