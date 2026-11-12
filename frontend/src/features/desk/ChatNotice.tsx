import { useSyncExternalStore } from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { hasChatStorageFailure, subscribeChatStorage } from "./chatStorage";

import "./ChatNotice.css";

export function ChatNotice({
  notice,
  recovering,
  busy,
  onRecover,
}: {
  notice?: { kind: "warning" | "error"; message: string };
  recovering: boolean;
  busy: boolean;
  onRecover?: () => Promise<unknown>;
}) {
  const storageFailed = useSyncExternalStore(
    subscribeChatStorage,
    hasChatStorageFailure,
  );
  return (
    <>
      {storageFailed && (
        <p className="chat-notice chat-audio-warning" role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          No se pudieron guardar los cambios en esta pestaña. Exporta las
          respuestas antes de recargar.
        </p>
      )}
      {notice && (
        <p
          className={
            notice.kind === "warning"
              ? "config-feedback config-feedback-warning chat-notice chat-audio-warning"
              : "config-feedback config-feedback-error chat-notice chat-error-notice"
          }
          role={notice.kind === "warning" ? "status" : "alert"}
        >
          <TriangleAlert size={16} aria-hidden="true" />
          <span className="chat-notice-content">
            <span className="chat-notice-message">{notice.message}</span>
            {onRecover && (
              <button
                type="button"
                className="chat-recover chat-recover-icon"
                aria-label={recovering ? "Recuperando…" : "Recuperar respuesta"}
                data-tooltip-disabled="true"
                disabled={busy}
                onClick={async () => {
                  try {
                    await onRecover();
                  } catch {
                    /* The request keeps its persistent issue on failure. */
                  }
                }}
              >
                <RefreshCw size={16} aria-hidden="true" />
              </button>
            )}
          </span>
        </p>
      )}
    </>
  );
}
