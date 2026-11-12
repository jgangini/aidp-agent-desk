// Thread layout adapted from assistant-ui's MIT-licensed reference, pinned in docs/licenses.
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  ThreadPrimitive,
  ComposerPrimitive,
  AuiIf,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { ArrowDown, ArrowUp, Mic, Square } from "lucide-react";
import { VoiceDock } from "./VoiceDock";
import { ChatHeader } from "./ChatHeader";
import { ChatActionsContext } from "./chatContext";
import { UserMessage, AssistantMessage } from "./ChatMessages";
import type { SwarmEngine } from "./engine";
import type { Snapshot, Conversation } from "./types";
import { createVoiceSignal, type VoiceSignal } from "./voice";
import { useChatVoiceAdapters } from "./useChatVoiceAdapters";
import { AgentPicker } from "./AgentPicker";
import { useComposerReveal, useComposerTransition } from "./useComposerReveal";
import { useSuggestions } from "./suggestions";
import { DictationInput } from "./DictationInput";
import { useChatNotice } from "./useChatNotice";
import { ChatNotice } from "./ChatNotice";
import {
  createVoiceConversation,
  type VoiceConversationOptions,
  type VoiceConversationPhase,
} from "./voiceConversation";

export function Chat({
  snapshot,
  act,
  onSend,
  onCancel,
  onRecover,
  onFeedback,
  reset,
  agentName,
  onConfigure,
  onScheduled,
  onNewScheduled,
  onUsers,
  scheduledOpen = false,
  scheduledEditing = false,
  scheduledEditorTitle,
  voice: sharedVoice,
  configuration,
  agentChoices,
  selectedAgent = "demo",
  onSelectAgent,
  history = [],
  selectedConversation,
  onSelectConversation,
  onDeleteConversation,
  onRenameConversation,
  initialDraft = "",
  onDraftChange,
  voiceTarget,
  reducedMotion = false,
}: {
  onSend?: (question: string) => Promise<string | undefined>;
  onCancel?: () => Promise<void>;
  onRecover?: (id: string, noticeId?: string) => Promise<string | undefined>;
  onFeedback?: (id: string, feedback: "positive" | "negative") => void;
  voiceTarget?: HTMLElement | null;
  reducedMotion?: boolean;
  snapshot: Snapshot;
  act: (action: (e: SwarmEngine) => void) => void;
  reset: () => void;
  agentName: string;
  onConfigure?: () => void;
  onScheduled?: () => void;
  onNewScheduled?: () => void;
  onUsers?: () => void;
  scheduledOpen?: boolean;
  scheduledEditing?: boolean;
  scheduledEditorTitle?: string;
  voice?: VoiceSignal;
  configuration?: ReactNode;
  agentChoices?: { id: string; name: string }[];
  selectedAgent?: string;
  onSelectAgent?: (id: string) => void;
  history?: { id: string; title: string }[];
  selectedConversation?: string;
  onRenameConversation?: (title: string) => void;
  onSelectConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  initialDraft?: string;
  onDraftChange?: (text: string) => void;
}) {
  const suggestions = useSuggestions(selectedAgent, selectedConversation);
  const feedback = useChatNotice(
    selectedAgent,
    selectedConversation,
    !!configuration,
  );
  const issueTurn = [...snapshot.conversations]
    .reverse()
    .find((turn) => turn.issue);
  const setError = feedback.error;
  const panel = useRef<HTMLElement>(null);
  const [ownVoice] = useState(createVoiceSignal);
  const voice = sharedVoice ?? ownVoice;
  const conversationRef = useRef<ReturnType<
    typeof createVoiceConversation
  > | null>(null);
  const [conversationPhase, setConversationPhase] =
    useState<VoiceConversationPhase>("idle");
  const pendingDemo = useRef<{
    id: string;
    resolve: (answer: string) => void;
    reject: (error: Error) => void;
  } | null>(null);
  useLayoutEffect(() => {
    conversationRef.current?.stop();
    pendingDemo.current?.reject(new Error("Cambió la conversación."));
    pendingDemo.current = null;
    voice.stop();
  }, [voice, selectedAgent, selectedConversation, !!configuration]);
  useChatPopovers(panel);
  useVoiceVisibility(voice, conversationRef);
  const running = snapshot.conversations.filter(
    (conversation) => conversation.status === "running",
  );
  const messagePrefix = selectedConversation ? `${selectedConversation}:` : "";
  const initialMessages = useInitialMessages(
    snapshot.conversations,
    selectedConversation,
    messagePrefix,
  );
  const messages = useMemo<ThreadMessageLike[]>(
    () => conversationMessages(snapshot.conversations, messagePrefix),
    [snapshot.conversations, messagePrefix],
  );
  const { adapters, conversationDictation } = useChatVoiceAdapters({
    selectedAgent,
    selectedConversation,
    configuring: !!configuration,
    voice,
    feedback,
    conversationRef,
  });
  const captureSend = useComposerTransition(
    panel,
    messages.length,
    reducedMotion,
  );
  const runtime = useExternalStoreRuntime({
    adapters,
    messages,
    convertMessage: (message) => message,
    isRunning: running.length > 0,
    ...composerActions({
      beforeSend() {
        captureSend();
        conversationRef.current?.stop();
        voice.stop();
        onDraftChange?.("");
        setError("");
      },
      stopVoice() {
        conversationRef.current?.stop();
        voice.stop();
      },
      current: running.at(-1),
      onSend,
      onCancel,
      act,
      setError,
    }),
  });
  const conversationOptions = useRef<VoiceConversationOptions | null>(null);
  conversationOptions.current = {
    listen: () => conversationDictation!.listen(),
    speak: (text) => adapters.speech!.speak(text),
    isCurrent: feedback.isCurrent,
    onError: setError,
    send: async (text) => {
      captureSend();
      voice.stop();
      setError("");
      if (onSend) return (await onSend(text)) ?? "";
      return new Promise<string>((resolve, reject) => {
        act((engine) => {
          pendingDemo.current = { id: engine.inject(text), resolve, reject };
        });
      });
    },
  };
  const [conversation] = useState(() =>
    createVoiceConversation(
      () => conversationOptions.current!,
      setConversationPhase,
    ),
  );
  conversationRef.current = conversation;
  useEffect(() => {
    const pending = pendingDemo.current;
    const turn =
      pending && snapshot.conversations.find((item) => item.id === pending.id);
    if (!pending || !turn || turn.status === "running") return;
    pendingDemo.current = null;
    if (turn.status === "completed") pending.resolve(turn.answer);
    else
      pending.reject(new Error("No se pudo completar la respuesta hablada."));
  }, [snapshot.conversations]);
  useComposerDraft(
    runtime,
    initialDraft,
    selectedConversation,
    onDraftChange,
    feedback.clearWarning,
  );
  useEffect(() => {
    if (selectedConversation && !configuration)
      panel.current
        ?.querySelector<HTMLTextAreaElement>("#chat-input")
        ?.focus({ preventScroll: true });
  }, [runtime, onDraftChange, selectedConversation]);
  useComposerReveal(
    panel,
    !messages.length && !configuration && !initialDraft,
    `${selectedAgent}:${selectedConversation ?? ""}`,
  );
  const actions = createChatActions({
    act,
    onFeedback,
    onSend,
    clear: feedback.clear,
    error: setError,
  });
  return (
    <aside ref={panel} className="chat-panel" aria-labelledby="chat-title">
      <ChatHeader
        configuring={!!configuration}
        history={history}
        selectedConversation={selectedConversation}
        onRenameConversation={onRenameConversation}
        onSelectConversation={onSelectConversation}
        onDeleteConversation={onDeleteConversation}
        reset={reset}
        busyId={
          snapshot.conversations.some((turn) => turn.status === "running")
            ? selectedConversation
            : undefined
        }
        scheduledOpen={scheduledOpen}
        scheduledEditing={scheduledEditing}
        scheduledEditorTitle={scheduledEditorTitle}
        onScheduled={onScheduled}
        onNewScheduled={onNewScheduled}
        onConfigure={onConfigure}
        onUsers={onUsers}
      />
      {configuration}
      <ChatActionsContext.Provider
        value={{
          snapshot,
          voice,
          messagePrefix,
          initialMessageIds: initialMessages.current.ids,
          ...actions,
        }}
      >
        <AssistantRuntimeProvider runtime={runtime}>
          <ThreadPrimitive.Root
            key={selectedConversation}
            className="aui-root aui-thread-root"
            aria-busy={running.length > 0}
            hidden={!!configuration}
          >
            {voiceTarget &&
              !configuration &&
              createPortal(
                <VoiceDock
                  supported={!!conversationDictation && !!adapters.speech}
                  phase={conversationPhase}
                  voice={voice}
                  playing={snapshot.playing}
                  reducedMotion={reducedMotion}
                  onStart={() => {
                    if (running.length) {
                      setError(
                        "Espera a que termine la consulta actual para hablar.",
                      );
                      return;
                    }
                    conversation.start();
                  }}
                  onStop={conversation.stop}
                />,
                voiceTarget,
              )}
            <ThreadPrimitive.Viewport
              className="aui-thread-viewport"
              turnAnchor="bottom"
            >
              <div
                className={`aui-thread-content ${messages.length ? "" : "aui-thread-empty"}`}
              >
                <div
                  className="aui-welcome-build"
                  data-empty={!messages.length}
                >
                  <AuiIf
                    condition={(state) => state.thread.messages.length === 0}
                  >
                    <div className="aui-thread-welcome-root t-stagger">
                      <h3>¿En qué puedo ayudarte hoy?</h3>
                    </div>
                  </AuiIf>
                  <div className="aui-message-group">
                    <ThreadPrimitive.Messages
                      components={{ UserMessage, AssistantMessage }}
                    />
                  </div>
                  <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer">
                    <ThreadPrimitive.ScrollToBottom
                      className="aui-scroll-bottom"
                      behavior="instant"
                      aria-label="Ir al último mensaje"
                    >
                      <ArrowDown size={16} />
                    </ThreadPrimitive.ScrollToBottom>
                    <AuiIf condition={(state) => !state.thread.isRunning}>
                      <div
                        className="aui-thread-suggestions"
                        aria-label="Sugerencias de consulta"
                        data-tooltip-disabled="true"
                      >
                        {suggestions
                          .slice(0, messages.length ? 3 : 9)
                          .map(({ title: label, query: prompt }, index) => (
                            <button
                              key={index}
                              style={
                                { "--suggestion-order": index } as CSSProperties
                              }
                              onClick={() => {
                                runtime.thread.composer.setText(prompt);
                                runtime.thread.composer.send();
                              }}
                            >
                              {label}
                            </button>
                          ))}
                      </div>
                    </AuiIf>
                    <RecoveryNotice
                      turn={issueTurn}
                      fallback={feedback.notice}
                      running={running}
                      onRecover={onRecover}
                      onRecovered={feedback.clear}
                    />
                    <ComposerPrimitive.Root className="aui-composer-root">
                      <div className="aui-composer-shell">
                        <label className="sr-only" htmlFor="chat-input">
                          Mensaje al agente
                        </label>
                        <DictationInput />
                        <div
                          className="aui-composer-actions"
                          data-tooltip-disabled="true"
                        >
                          <div className="aui-composer-tools">
                            <AgentPicker
                              choices={
                                agentChoices ?? [
                                  { id: "demo", name: agentName },
                                ]
                              }
                              selected={selectedAgent}
                              onSelect={onSelectAgent}
                            />
                          </div>
                          <div className="aui-composer-submit-tools">
                            <AuiIf
                              condition={(state) => !state.composer.dictation}
                            >
                              <ComposerPrimitive.Dictate
                                className="icon-button dictation-button"
                                aria-label="Dictar mensaje"
                                onClick={() => conversation.stop()}
                              >
                                <Mic size={17} />
                              </ComposerPrimitive.Dictate>
                            </AuiIf>
                            <AuiIf
                              condition={(state) => !!state.composer.dictation}
                            >
                              <ComposerPrimitive.StopDictation
                                className="icon-button dictation-button dictation-stop"
                                aria-label="Detener dictado"
                              >
                                <Square size={14} fill="currentColor" />
                              </ComposerPrimitive.StopDictation>
                            </AuiIf>
                            <AuiIf
                              condition={(state) => !state.thread.isRunning}
                            >
                              <ComposerPrimitive.Send
                                className="aui-composer-send"
                                aria-label="Enviar consulta"
                              >
                                <ArrowUp size={18} />
                              </ComposerPrimitive.Send>
                            </AuiIf>
                            <AuiIf
                              condition={(state) => state.thread.isRunning}
                            >
                              <ComposerPrimitive.Cancel
                                className="aui-composer-send"
                                aria-label="Detener consulta"
                              >
                                <Square size={13} fill="currentColor" />
                              </ComposerPrimitive.Cancel>
                            </AuiIf>
                          </div>
                        </div>
                      </div>
                    </ComposerPrimitive.Root>
                    <div className="aui-footer-spacer" aria-hidden="true" />
                  </ThreadPrimitive.ViewportFooter>
                </div>
              </div>
            </ThreadPrimitive.Viewport>
          </ThreadPrimitive.Root>
        </AssistantRuntimeProvider>
      </ChatActionsContext.Provider>
    </aside>
  );
}

function composerActions({
  beforeSend,
  stopVoice,
  current,
  onSend,
  onCancel,
  act,
  setError,
}: {
  beforeSend: () => void;
  stopVoice: () => void;
  current?: Conversation;
  onSend?: (question: string) => Promise<string | undefined>;
  onCancel?: () => Promise<void>;
  act: (action: (engine: SwarmEngine) => void) => void;
  setError: (message: string) => void;
}) {
  return {
    onNew: async (message: import("@assistant-ui/react").AppendMessage) => {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      try {
        beforeSend();
        if (onSend) {
          await onSend(text);
        } else
          act((engine) => {
            engine.inject(text);
          });
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "No se pudo enviar la consulta.",
        );
        throw reason;
      }
    },
    onCancel: async () => {
      stopVoice();
      if (onCancel) await onCancel();
      else if (current) act((engine) => engine.cancel(current.id));
    },
  };
}

function useComposerDraft(
  runtime: ReturnType<typeof useExternalStoreRuntime>,
  initialDraft: string,
  selectedConversation: string | undefined,
  onDraftChange: ((text: string) => void) | undefined,
  clearWarning: () => void,
) {
  const draft = useRef({ id: selectedConversation, text: initialDraft });
  if (draft.current.id !== selectedConversation)
    draft.current = { id: selectedConversation, text: initialDraft };
  useEffect(() => {
    runtime.thread.composer.setText(draft.current.text);
    let previous = runtime.thread.composer.getState().text;
    return runtime.thread.composer.subscribe(() => {
      const text = runtime.thread.composer.getState().text;
      if (draft.current.id === selectedConversation) draft.current.text = text;
      if (text !== previous) clearWarning();
      previous = text;
      onDraftChange?.(text);
    });
  }, [runtime, onDraftChange, selectedConversation, clearWarning]);
}

function createChatActions({
  act,
  onFeedback,
  onSend,
  clear,
  error,
}: {
  act: (action: (engine: SwarmEngine) => void) => void;
  onFeedback?: (id: string, value: "positive" | "negative") => void;
  onSend?: (question: string) => Promise<string | undefined>;
  clear: () => void;
  error: (message: string) => void;
}) {
  return {
    onFeedback:
      onFeedback ??
      ((id, value) => act((engine) => engine.setFeedback(id, value))),
    onRegenerate: onSend
      ? (_id: string, question: string) => {
          clear();
          void onSend(question).catch((reason) =>
            error(
              reason instanceof Error
                ? reason.message
                : "No se pudo reintentar.",
            ),
          );
        }
      : (id: string) => act((engine) => engine.regenerate(id)),
  };
}

function RecoveryNotice({
  turn,
  fallback,
  running,
  onRecover,
  onRecovered,
}: {
  turn?: Conversation;
  fallback: ReturnType<typeof useChatNotice>["notice"];
  running: Conversation[];
  onRecover?: (id: string) => Promise<string | undefined>;
  onRecovered: () => void;
}) {
  return (
    <ChatNotice
      notice={turn?.issue ?? fallback}
      recovering={running.some(
        (item) => item.id === (turn?.issue?.requestId ?? turn?.id),
      )}
      busy={running.length > 0}
      onRecover={
        turn?.issue?.recoverable && onRecover
          ? async () => {
              await onRecover(turn.id);
              onRecovered();
            }
          : undefined
      }
    />
  );
}

function useChatPopovers(panel: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const menus = () =>
      panel.current?.querySelectorAll<HTMLDetailsElement>(
        ".chat-popover[open]",
      ) ?? [];
    const dismissOutside = (event: PointerEvent) => {
      for (const menu of menus())
        if (!menu.contains(event.target as Node)) menu.open = false;
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      for (const menu of menus()) {
        menu.open = false;
        menu.querySelector<HTMLElement>("summary")?.focus();
        event.preventDefault();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, []);
}

function conversationMessages(
  conversations: Conversation[],
  messagePrefix: string,
): ThreadMessageLike[] {
  return conversations.flatMap((conversation) =>
    (
      [
        {
          id: `${messagePrefix}${conversation.id}-user`,
          role: "user",
          content: conversation.question,
        },
        {
          id: `${messagePrefix}${conversation.id}-assistant`,
          role: "assistant",
          content:
            conversation.answer ||
            (conversation.status === "running"
              ? ""
              : conversation.status === "cancelled"
                ? "Consulta cancelada. Puedes enviar otra."
                : "No se pudo completar la consulta."),
          status:
            conversation.status === "running"
              ? { type: "running" }
              : conversation.status === "completed"
                ? { type: "complete", reason: "stop" }
                : {
                    type: "incomplete",
                    reason:
                      conversation.status === "cancelled"
                        ? "cancelled"
                        : "error",
                  },
        },
      ] satisfies ThreadMessageLike[]
    ).filter(
      (message) =>
        !(
          message.role === "assistant" &&
          !conversation.answer &&
          conversation.status === "failed"
        ),
    ),
  );
}

function useVoiceVisibility(
  voice: VoiceSignal,
  conversationRef: RefObject<ReturnType<typeof createVoiceConversation> | null>,
) {
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        conversationRef.current?.stop();
        voice.stop();
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      conversationRef.current?.stop();
      voice.stop();
    };
  }, [voice, conversationRef]);
}

function useInitialMessages(
  conversations: Conversation[],
  selectedConversation: string | undefined,
  messagePrefix: string,
) {
  const initialMessages = useRef({
    conversation: selectedConversation,
    ids: new Set(
      conversations.map((turn) => `${messagePrefix}${turn.id}-assistant`),
    ),
  });
  if (initialMessages.current.conversation !== selectedConversation)
    initialMessages.current = {
      conversation: selectedConversation,
      ids: new Set(
        conversations.map((turn) => `${messagePrefix}${turn.id}-assistant`),
      ),
    };
  return initialMessages;
}
