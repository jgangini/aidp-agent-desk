import {
  WebSpeechDictationAdapter,
  type DictationAdapter,
  type SpeechSynthesisAdapter,
} from "@assistant-ui/react";
import { microphoneEnergy, type VoiceSignal } from "./voice";

export function speechAdapter(voice: VoiceSignal): SpeechSynthesisAdapter {
  return {
    speak(text) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "es-PE";
      const subscribers = new Set<() => void>();
      const notify = () => subscribers.forEach((callback) => callback());
      const finish = (reason: "finished" | "cancelled" | "error") => {
        if (result.status.type === "ended") return;
        result.status = { type: "ended", reason };
        voice.end(token);
        notify();
      };
      const token = voice.start("speaking", () => {
        window.speechSynthesis.cancel();
        if (result.status.type !== "ended") {
          result.status = { type: "ended", reason: "cancelled" };
          notify();
        }
      });
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
      utterance.addEventListener("start", () => {
        if (!voice.owns(token) || result.status.type === "ended") return;
        result.status = { type: "running" };
        notify();
      });
      utterance.addEventListener("boundary", (event) => {
        if (event.name === "word") voice.word(token, performance.now());
      });
      utterance.addEventListener("end", () => finish("finished"));
      utterance.addEventListener("error", () => finish("error"));
      window.speechSynthesis.speak(utterance);
      return result;
    },
  };
}

/** A second native microphone stream feeds only a local analyser, never an output node. */
function analyseMicrophone(
  voice: VoiceSignal,
  token: number,
  done: () => boolean,
  onError: (message: string) => void,
) {
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let frame = 0;
  let disposed = false;
  const release = () => {
    disposed = true;
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== "closed")
      void context.close().catch(() => {});
  };
  void navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then(async (input) => {
      stream = input;
      if (disposed || !voice.owns(token) || done()) {
        release();
        return;
      }
      context = new AudioContext();
      const source = context.createMediaStreamSource(input);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      await context.resume();
      if (disposed || !voice.owns(token) || done()) {
        release();
        return;
      }
      const samples = new Uint8Array(analyser.fftSize);
      const sample = () => {
        if (!voice.owns(token) || done()) {
          release();
          voice.end(token);
          return;
        }
        analyser.getByteTimeDomainData(samples);
        voice.amplitude(token, microphoneEnergy(samples));
        frame = requestAnimationFrame(sample);
      };
      sample();
    })
    .catch(() => {
      release();
      if (voice.owns(token))
        onError(
          "No se pudo analizar el micrófono. Revisa su permiso para activar la respuesta visual a tu voz.",
        );
    });
  return release;
}

export function dictationAdapter(
  voice: VoiceSignal,
  onError: (message: string) => void,
): DictationAdapter {
  const native = new WebSpeechDictationAdapter({
    language: "es-PE",
    continuous: false,
  });
  return {
    listen() {
      const session = native.listen();
      let release: (() => void) | undefined;
      let frame = 0;
      const token = voice.start("listening", () => {
        release?.();
        cancelAnimationFrame(frame);
        document.removeEventListener("visibilitychange", visibility);
        if (session.status.type !== "ended") session.cancel();
      });
      const visibility = () => {
        if (document.hidden) voice.end(token);
      };
      document.addEventListener("visibilitychange", visibility);
      const watch = () => {
        if (session.status.type === "ended") {
          voice.end(token);
          return;
        }
        frame = requestAnimationFrame(watch);
      };
      frame = requestAnimationFrame(watch);
      if (
        typeof navigator.mediaDevices?.getUserMedia === "function" &&
        "AudioContext" in window
      ) {
        release = analyseMicrophone(
          voice,
          token,
          () => session.status.type === "ended",
          onError,
        );
      }
      const stop = session.stop;
      const cancel = session.cancel;
      return {
        ...session,
        get status() {
          return session.status;
        },
        onSpeechEnd: (callback) =>
          session.onSpeechEnd((result) => {
            release?.();
            voice.end(token);
            callback(result);
          }),
        stop: async () => {
          release?.();
          await stop();
          voice.end(token);
        },
        cancel: () => {
          voice.end(token);
          cancel();
        },
      };
    },
  };
}
