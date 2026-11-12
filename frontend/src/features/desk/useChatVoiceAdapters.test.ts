import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { remoteSpeechAdapter, remoteDictationAdapter } from "./remoteVoice";
import { useChatNotice } from "./useChatNotice";
import { useChatVoiceAdapters } from "./useChatVoiceAdapters";
import { createVoiceSignal } from "./voice";

vi.mock("./remoteVoice", () => ({
  remoteSpeechAdapter: vi.fn(),
  remoteDictationAdapter: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", class {});
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: vi.fn() },
  });
  vi.mocked(remoteSpeechAdapter).mockImplementation(() => ({ speak: vi.fn() }));
  vi.mocked(remoteDictationAdapter).mockImplementation(() => ({
    listen: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

function setup() {
  const voice = createVoiceSignal();
  const conversationRef = { current: { stop: vi.fn() } };
  const hook = renderHook(
    ({ conversation, configuring }) => {
      const feedback = useChatNotice("remote", conversation, configuring);
      return {
        ...useChatVoiceAdapters({
          selectedAgent: "remote",
          selectedConversation: conversation,
          configuring,
          voice,
          feedback,
          conversationRef,
        }),
        notice: feedback.notice,
      };
    },
    { initialProps: { conversation: "first", configuring: false } },
  );
  return { ...hook, conversationRef };
}

it("refreshes adapters on conversation and configuration changes without leaking old feedback", () => {
  const hook = setup();
  const first = hook.result.current.adapters;
  const firstWarning = vi.mocked(remoteSpeechAdapter).mock.calls.at(-1)![3]!
    .onConfigurationRequired!;
  hook.rerender({ conversation: "first", configuring: false });
  expect(hook.result.current.adapters).toBe(first);

  hook.rerender({ conversation: "second", configuring: false });
  expect(hook.result.current.adapters).not.toBe(first);
  act(() => firstWarning("Old conversation"));
  expect(hook.result.current.notice).toBeUndefined();

  const second = hook.result.current.adapters;
  const secondWarning = vi.mocked(remoteSpeechAdapter).mock.calls.at(-1)![3]!
    .onConfigurationRequired!;
  act(() => secondWarning("Current conversation"));
  expect(hook.result.current.notice?.message).toBe("Current conversation");

  hook.rerender({ conversation: "second", configuring: true });
  expect(hook.result.current.adapters).not.toBe(second);
  expect(hook.result.current.notice).toBeUndefined();
  act(() => secondWarning("Old configuration"));
  expect(hook.result.current.notice).toBeUndefined();
  const currentWarning = vi.mocked(remoteSpeechAdapter).mock.calls.at(-1)![3]!
    .onConfigurationRequired!;
  act(() => currentWarning("Current configuration"));
  expect(hook.result.current.notice?.message).toBe("Current configuration");
});

it("stops the current conversation for conversational audio failures and configuration feedback", () => {
  const hook = setup();
  const currentStop = vi.fn();
  const previousStop = hook.conversationRef.current.stop;
  hook.conversationRef.current = { stop: currentStop };
  const conversational = vi.mocked(remoteDictationAdapter).mock.calls.at(-1)!;
  expect(conversational[5]).toEqual({ stopOnFinal: true });

  act(() => conversational[2]("Capture failed"));
  expect(currentStop).toHaveBeenCalledOnce();
  expect(previousStop).not.toHaveBeenCalled();
  expect(hook.result.current.notice).toEqual({
    kind: "error",
    message: "Capture failed",
  });

  act(() => conversational[4]!.onConfigurationRequired!("Configure audio"));
  expect(currentStop).toHaveBeenCalledTimes(2);
  expect(hook.result.current.notice).toEqual({
    kind: "warning",
    message: "Configure audio",
  });
});
