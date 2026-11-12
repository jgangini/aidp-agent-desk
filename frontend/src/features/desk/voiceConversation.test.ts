import { expect, it, vi } from "vitest";
import type {
  DictationAdapter,
  SpeechSynthesisAdapter,
} from "@assistant-ui/react";
import { createVoiceConversation } from "./voiceConversation";

function setup(completion?: "before-subscribe" | "during-subscribe") {
  const captures: {
    session: DictationAdapter.Session;
    final: (text: string) => void;
  }[] = [];
  const playback: {
    utterance: SpeechSynthesisAdapter.Utterance;
    end: (reason: "finished" | "cancelled" | "error") => void;
  }[] = [];
  const send = vi
    .fn<(text: string) => Promise<string>>()
    .mockResolvedValue("Respuesta hablada");
  const error = vi.fn();
  const phase = vi.fn();
  let current = true;
  const conversation = createVoiceConversation(
    () => ({
      send,
      onError: error,
      isCurrent: () => current,
      listen: () => {
        const callbacks = new Set<(result: DictationAdapter.Result) => void>();
        const session: DictationAdapter.Session = {
          status: { type: "running" },
          stop: vi.fn(async () => {}),
          cancel: vi.fn(),
          onSpeechStart: () => () => {},
          onSpeech: () => () => {},
          onSpeechEnd: (callback) => {
            callbacks.add(callback);
            return () => {
              callbacks.delete(callback);
            };
          },
        };
        captures.push({
          session,
          final: (text) =>
            callbacks.forEach((callback) =>
              callback({ transcript: text, isFinal: true }),
            ),
        });
        return session;
      },
      speak: () => {
        const subscribers = new Set<() => void>();
        const utterance: SpeechSynthesisAdapter.Utterance = {
          status:
            completion === "before-subscribe"
              ? { type: "ended", reason: "finished" }
              : { type: "running" },
          cancel: vi.fn(),
          subscribe: (callback) => {
            subscribers.add(callback);
            if (completion === "during-subscribe") {
              utterance.status = { type: "ended", reason: "finished" };
              callback();
            }
            return () => {
              subscribers.delete(callback);
            };
          },
        };
        playback.push({
          utterance,
          end: (reason) => {
            utterance.status = { type: "ended", reason };
            subscribers.forEach((callback) => callback());
          },
        });
        return utterance;
      },
    }),
    phase,
  );
  return {
    conversation,
    captures,
    playback,
    send,
    error,
    phase,
    invalidate: () => {
      current = false;
    },
  };
}

it.each(["before-subscribe", "during-subscribe"] as const)(
  "releases synchronous playback completion %s exactly once",
  async (completion) => {
    const state = setup(completion);
    try {
      state.conversation.start();
      state.captures[0].final("Pregunta");
      await vi.waitFor(() => expect(state.captures).toHaveLength(2));
      expect(state.conversation.phase).toBe("listening");
      state.playback[0].end("finished");
      expect(state.captures).toHaveLength(2);
      expect(state.error).not.toHaveBeenCalled();
    } finally {
      state.conversation.stop();
    }
  },
);

it("sends one complete spoken turn, waits for TTS to finish, then listens again", async () => {
  const state = setup();
  state.conversation.start();
  state.captures[0].final("Primera pregunta");
  state.captures[0].final("Duplicado");
  await vi.waitFor(() => expect(state.playback).toHaveLength(1));
  expect(state.send).toHaveBeenCalledExactlyOnceWith("Primera pregunta");
  expect(state.conversation.phase).toBe("speaking");
  expect(state.captures).toHaveLength(1);
  state.playback[0].end("finished");
  expect(state.captures).toHaveLength(2);
  expect(state.conversation.phase).toBe("listening");
  state.conversation.stop();
});

it("stops listening without submitting a pending utterance", () => {
  const state = setup();
  state.conversation.start();
  state.conversation.stop();
  state.captures[0].final("No enviar");
  expect(state.captures[0].session.cancel).toHaveBeenCalledOnce();
  expect(state.send).not.toHaveBeenCalled();
  expect(state.conversation.phase).toBe("idle");
});

it("leaves listening when another audio action cancels capture without a final transcript", () => {
  vi.useFakeTimers();
  const state = setup();
  try {
    state.conversation.start();
    state.captures[0].session.status = { type: "ended", reason: "cancelled" };
    vi.advanceTimersByTime(50);
    expect(state.conversation.phase).toBe("idle");
    expect(state.send).not.toHaveBeenCalled();
    expect(state.captures).toHaveLength(1);
  } finally {
    state.conversation.stop();
    vi.useRealTimers();
  }
});

it("ignores a late agent response after stopping or changing context", async () => {
  const state = setup();
  let reply!: (text: string) => void;
  state.send.mockImplementation(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  state.conversation.start();
  state.captures[0].final("Pregunta");
  expect(state.conversation.phase).toBe("waiting");
  state.conversation.stop();
  reply("Respuesta tardía");
  await Promise.resolve();
  expect(state.playback).toHaveLength(0);
  state.conversation.start();
  state.invalidate();
  state.captures[1].final("Contexto viejo");
  expect(state.send).toHaveBeenCalledTimes(1);
  state.conversation.stop();
});

it.each(["cancelled", "error"] as const)(
  "does not restart capture after playback ends with %s",
  async (reason) => {
    const state = setup();
    state.conversation.start();
    state.captures[0].final("Pregunta");
    await vi.waitFor(() => expect(state.playback).toHaveLength(1));
    state.playback[0].end(reason);
    expect(state.conversation.phase).toBe("idle");
    expect(state.captures).toHaveLength(1);
  },
);

it("cancels playback on stop and reports send errors without restarting", async () => {
  const state = setup();
  state.conversation.start();
  state.captures[0].final("Pregunta");
  await vi.waitFor(() => expect(state.playback).toHaveLength(1));
  state.conversation.stop();
  state.playback[0].end("finished");
  expect(state.playback[0].utterance.cancel).toHaveBeenCalledOnce();
  expect(state.captures).toHaveLength(1);
  state.send.mockRejectedValue(new Error("Fallo controlado"));
  state.conversation.start();
  state.captures[1].final("Otra pregunta");
  await vi.waitFor(() =>
    expect(state.error).toHaveBeenCalledWith("Fallo controlado"),
  );
  expect(state.conversation.phase).toBe("idle");
});
