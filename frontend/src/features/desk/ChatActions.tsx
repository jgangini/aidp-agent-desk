import { useContext, useState } from "react";
import { ActionBarPrimitive, AuiIf, useAuiState } from "@assistant-ui/react";
import {
  Check,
  Copy,
  Download,
  MoreHorizontal,
  RefreshCw,
  Square,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";
import { responseTiming } from "./chatMetrics";
import { ChatActionsContext } from "./chatContext";

export function ResponseActions() {
  const {
    snapshot,
    voice,
    messagePrefix = "",
    onFeedback,
    onRegenerate,
  } = useContext(ChatActionsContext)!;
  const messageId = useAuiState((state) => state.message.id);
  const isLast = useAuiState((state) => state.message.isLast);
  const conversation = snapshot.conversations.find(
    (item) => `${messagePrefix}${item.id}-assistant` === messageId,
  );
  const speaking = useAuiState(
    (state) =>
      state.message.speech?.status.type === "running" ||
      state.message.speech?.status.type === "starting",
  );
  const [error, setError] = useState("");
  if (!conversation) return null;
  const timing = responseTiming(conversation);
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([conversation.answer], { type: "text/markdown;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "agent-desk-respuesta.md";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="never"
        className="aui-action-bar t-panel-slide"
        data-open={isLast}
      >
        <ActionBarPrimitive.Copy
          className="aui-copy"
          aria-label="Copiar respuesta"
          title="Copiar respuesta"
        >
          <AuiIf condition={(state) => !state.message.isCopied}>
            <Copy size={15} />
          </AuiIf>
          <AuiIf condition={(state) => state.message.isCopied}>
            <Check size={15} />
          </AuiIf>
        </ActionBarPrimitive.Copy>
        <button
          className="aui-copy"
          aria-label="Respuesta útil"
          title="Útil · valoración local"
          aria-pressed={conversation.feedback === "positive"}
          onClick={() => onFeedback(conversation.id, "positive")}
        >
          <ThumbsUp size={15} />
        </button>
        <button
          className="aui-copy"
          aria-label="Respuesta no útil"
          title="No útil · valoración local"
          aria-pressed={conversation.feedback === "negative"}
          onClick={() => onFeedback(conversation.id, "negative")}
        >
          <ThumbsDown size={15} />
        </button>
        {speaking ? (
          <ActionBarPrimitive.StopSpeaking
            className="aui-copy"
            aria-label="Detener lectura"
            title="Detener lectura"
          >
            <Square size={14} />
          </ActionBarPrimitive.StopSpeaking>
        ) : (
          <ActionBarPrimitive.Speak
            className="aui-copy"
            aria-label="Leer respuesta"
            title={
              "speechSynthesis" in window
                ? "Leer respuesta"
                : "Lectura no disponible en este navegador"
            }
          >
            <Volume2 size={15} />
          </ActionBarPrimitive.Speak>
        )}
        <button
          className="aui-copy"
          aria-label="Regenerar respuesta"
          title="Regenerar respuesta"
          disabled={snapshot.conversations.some(
            (item) => item.status === "running",
          )}
          onClick={() => {
            try {
              voice?.stop();
              onRegenerate(conversation.id, conversation.question);
              setError("");
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : "No se pudo regenerar.",
              );
            }
          }}
        >
          <RefreshCw size={15} />
        </button>
        <details className="chat-popover response-more" name="chat-popovers">
          <summary
            className="aui-copy"
            aria-label="Más acciones de respuesta"
            title="Más acciones"
          >
            <MoreHorizontal size={15} />
          </summary>
          <div className="chat-popover-content">
            <button onClick={download}>
              <Download size={14} /> Export as Markdown
            </button>
          </div>
        </details>
        <span className="response-timing" data-tooltip-disabled="true">
          {timing.total === undefined
            ? "—"
            : `${(timing.total / 1000).toFixed(2)}s`}
        </span>
      </ActionBarPrimitive.Root>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
