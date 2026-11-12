import { useMemo, type RefObject } from "react";
import { WebSpeechDictationAdapter } from "@assistant-ui/react";
import { speechAdapter, dictationAdapter } from "./voiceAdapters";
import { remoteSpeechAdapter, remoteDictationAdapter } from "./remoteVoice";
import type { VoiceSignal } from "./voice";

export function useChatVoiceAdapters({
  selectedAgent,
  selectedConversation,
  configuring,
  voice,
  feedback,
  conversationRef,
}: {
  selectedAgent: string;
  selectedConversation: string | undefined;
  configuring: boolean;
  voice: VoiceSignal;
  feedback: {
    error: (message: string) => void;
    clear: () => void;
    warning: (message: string) => void;
  };
  conversationRef: RefObject<{ stop: () => void } | null>;
}) {
  const setError = feedback.error;
  const adapters = useMemo(
    () => ({
      speech:
        selectedAgent !== "demo"
          ? remoteSpeechAdapter(selectedAgent, voice, setError, {
              onStart: feedback.clear,
              onConfigurationRequired: feedback.warning,
            })
          : "speechSynthesis" in window && "SpeechSynthesisUtterance" in window
            ? speechAdapter(voice)
            : undefined,
      dictation:
        selectedAgent !== "demo"
          ? typeof MediaRecorder !== "undefined" &&
            typeof navigator.mediaDevices?.getUserMedia === "function"
            ? remoteDictationAdapter(
                selectedAgent,
                voice,
                setError,
                undefined,
                {
                  onStart: feedback.clear,
                  onConfigurationRequired: feedback.warning,
                },
              )
            : undefined
          : WebSpeechDictationAdapter.isSupported()
            ? dictationAdapter(voice, setError)
            : undefined,
    }),
    [
      voice,
      selectedAgent,
      selectedConversation,
      configuring,
      setError,
      feedback.clear,
      feedback.warning,
    ],
  );
  const conversationDictation = useMemo(() => {
    const fail = (message: string) => {
      conversationRef.current?.stop();
      setError(message);
    };
    if (selectedAgent === "demo")
      return WebSpeechDictationAdapter.isSupported()
        ? dictationAdapter(voice, fail)
        : undefined;
    if (
      typeof MediaRecorder === "undefined" ||
      typeof navigator.mediaDevices?.getUserMedia !== "function"
    )
      return undefined;
    return remoteDictationAdapter(
      selectedAgent,
      voice,
      fail,
      undefined,
      {
        onStart: feedback.clear,
        onConfigurationRequired: (message) => {
          conversationRef.current?.stop();
          feedback.warning(message);
        },
      },
      { stopOnFinal: true },
    );
  }, [selectedAgent, voice, setError, feedback.clear, feedback.warning]);
  return { adapters, conversationDictation };
}
