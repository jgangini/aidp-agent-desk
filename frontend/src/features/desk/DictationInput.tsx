import { ComposerPrimitive, useAuiState } from "@assistant-ui/react";
import { useRef } from "react";
import { StreamingText } from "./StreamingText";
import "./DictationInput.css";

export function DictationInput() {
  const text = useAuiState((state) => state.composer.text);
  const active = useAuiState((state) => !!state.composer.dictation);
  const mirror = useRef<HTMLDivElement>(null);
  const showing = active && !!text;
  return (
    <div className="dictation-input" data-streaming={showing}>
      <ComposerPrimitive.Input
        id="chat-input"
        className="aui-composer-input"
        aria-label="Mensaje al agente"
        placeholder="Escribe un mensaje…"
        maxLength={500}
        rows={1}
        onScroll={(event) => {
          if (mirror.current)
            mirror.current.scrollTop = event.currentTarget.scrollTop;
        }}
      />
      {showing && (
        <div ref={mirror} className="dictation-input-mirror" aria-hidden="true">
          <StreamingText text={text} live animateInitial />
        </div>
      )}
    </div>
  );
}
