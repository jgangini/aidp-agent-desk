import type {
  DictationAdapter,
  SpeechSynthesisAdapter,
} from "@assistant-ui/react";

export type VoiceConversationPhase =
  "idle" | "listening" | "waiting" | "speaking";
export interface VoiceConversationOptions {
  listen: () => DictationAdapter.Session;
  speak: (text: string) => SpeechSynthesisAdapter.Utterance;
  send: (text: string) => Promise<string>;
  isCurrent: () => boolean;
  onError: (message: string) => void;
}

function monitorCapture(
  capture: DictationAdapter.Session,
  owns: () => boolean,
  current: () => boolean,
  stop: () => void,
  fail: (error: Error) => void,
) {
  return setInterval(() => {
    if (!owns()) {
      if (current()) stop();
      return;
    }
    if (capture.status.type !== "ended") return;
    if (capture.status.reason === "error")
      fail(new Error("No se pudo continuar la captura de voz."));
    else stop();
  }, 50);
}

function monitorPlayback(
  playback: SpeechSynthesisAdapter.Utterance,
  owns: () => boolean,
  ended: () => void,
) {
  let finished = false;
  let unsubscribe = () => {};
  const update = () => {
    if (finished || !owns() || playback.status.type !== "ended") return;
    finished = true;
    unsubscribe();
    ended();
  };
  unsubscribe = playback.subscribe(update);
  if (finished) unsubscribe();
  else update();
  return finished ? undefined : unsubscribe;
}

class VoiceConversationController {
  private generation = 0;
  private currentPhase: VoiceConversationPhase = "idle";
  private recording: DictationAdapter.Session | undefined = undefined;
  private utterance: SpeechSynthesisAdapter.Utterance | undefined = undefined;
  private removeSpeechEnd: (() => void) | undefined = undefined;
  private removePlayback: (() => void) | undefined = undefined;
  private captureMonitor: ReturnType<typeof setInterval> | undefined =
    undefined;
  private stopMonitoring = () => {
    clearInterval(this.captureMonitor);
    this.captureMonitor = undefined;
  };
  private change = (next: VoiceConversationPhase) => {
    this.currentPhase = next;
    this.onPhase(next);
  };
  private owns = (id: number) =>
    id === this.generation &&
    this.currentPhase !== "idle" &&
    this.options().isCurrent();
  stop = () => {
    this.generation++;
    this.stopMonitoring();
    this.removeSpeechEnd?.();
    this.removeSpeechEnd = undefined;
    this.removePlayback?.();
    this.removePlayback = undefined;
    const capture = this.recording;
    this.recording = undefined;
    const playback = this.utterance;
    this.utterance = undefined;
    this.change("idle");
    capture?.cancel();
    playback?.cancel();
  };
  private fail = (id: number, error: unknown) => {
    if (!this.owns(id)) return;
    this.stop();
    this.options().onError(
      error instanceof Error
        ? error.message
        : "No se pudo continuar la conversación por voz.",
    );
  };
  private listen = (id: number) => {
    if (id !== this.generation || !this.options().isCurrent()) return;
    this.change("listening");
    try {
      this.recording = this.options().listen();
      this.removeSpeechEnd = this.recording.onSpeechEnd((result) => {
        if (!this.owns(id) || this.currentPhase !== "listening") return;
        const text = result.transcript.trim();
        this.stopMonitoring();
        this.removeSpeechEnd?.();
        this.removeSpeechEnd = undefined;
        this.recording = undefined;
        if (!text) {
          this.stop();
          return;
        }
        this.change("waiting");
        void this.respond(id, text);
      });
      const capture = this.recording;
      if (this.currentPhase === "listening" && capture)
        this.captureMonitor = monitorCapture(
          capture,
          () => this.owns(id),
          () => id === this.generation,
          this.stop,
          (error) => this.fail(id, error),
        );
    } catch (error) {
      this.fail(id, error);
    }
  };
  private respond = async (id: number, text: string) => {
    try {
      const answer = await this.options().send(text);
      if (!this.owns(id)) return;
      if (!answer.trim()) {
        this.stop();
        return;
      }
      this.change("speaking");
      const playback = this.options().speak(answer);
      this.utterance = playback;
      this.removePlayback = monitorPlayback(
        playback,
        () => this.owns(id),
        () => {
          this.removePlayback = undefined;
          this.utterance = undefined;
          if (
            playback.status.type === "ended" &&
            playback.status.reason === "finished"
          )
            this.listen(id);
          else this.stop();
        },
      );
    } catch (error) {
      this.fail(id, error);
    }
  };
  constructor(
    private options: () => VoiceConversationOptions,
    private onPhase: (phase: VoiceConversationPhase) => void,
  ) {}
  get phase() {
    return this.currentPhase;
  }
  start = () => {
    this.stop();
    this.listen(this.generation);
  };
}

/** One spoken turn at a time; stopping invalidates all pending audio and replies. */
export function createVoiceConversation(
  options: () => VoiceConversationOptions,
  onPhase: (phase: VoiceConversationPhase) => void,
) {
  return new VoiceConversationController(options, onPhase);
}
