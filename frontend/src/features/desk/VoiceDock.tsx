import { useEffect, useRef, useState } from "react";
import { VoiceBeam } from "voice-glow";
import type { VoiceSignal } from "./voice";
import type { VoiceConversationPhase } from "./voiceConversation";

export function VoiceDock({
  supported,
  onStart,
  onStop,
  voice,
  playing,
  reducedMotion,
  phase,
}: {
  supported: boolean;
  onStart: () => void;
  onStop: () => void;
  voice: VoiceSignal;
  playing: boolean;
  reducedMotion: boolean;
  phase: VoiceConversationPhase;
}) {
  const listening = phase === "listening";
  const active = phase !== "idle";
  const beam = useRef<HTMLDivElement>(null);
  const [beamWidth, setBeamWidth] = useState(350);
  useEffect(() => {
    if (!beam.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setBeamWidth(entry.contentRect.width),
    );
    observer.observe(beam.current);
    return () => observer.disconnect();
  }, []);
  const spread = Math.max(1, beamWidth / 350);
  const label = !supported
    ? "Conversación por voz no disponible"
    : listening
      ? "Escuchando…"
      : phase === "waiting"
        ? "Esperando respuesta…"
        : phase === "speaking"
          ? "Respondiendo…"
          : "Toca para hablar";
  return (
    <VoiceBeam
      ref={beam}
      className="voice-dock-beam"
      glowWidth={spread}
      lobeSpacing={spread}
      rangeWidth={spread}
      theme="dark"
      level={() => {
        const signal = voice.sample(performance.now());
        return signal.mode === "idle" ? 0.06 : signal.level * 0.6;
      }}
      paused={!playing || reducedMotion}
      borderRadius={0}
    >
      <div
        className="voice-dock"
        data-listening={listening}
        data-voice-phase={phase}
        data-playing={playing && !reducedMotion}
      >
        <button
          type="button"
          className="voice-dock-button"
          aria-label={active ? "Detener voz" : "Hablar con el agente"}
          aria-pressed={active}
          disabled={!supported}
          data-tooltip={label}
          onClick={active ? onStop : onStart}
        >
          <span className="voice-dock-wave" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </button>
      </div>
    </VoiceBeam>
  );
}
