export interface RealtimeSession {
  mode: "realtime";
  url: string;
  authentication: Record<string, unknown>;
  sample_rate: number;
}

export function speechResults(message: string): { transcript: string; isFinal: boolean }[] {
  const data = JSON.parse(message);
  if (data.event === "ERROR") throw new Error("OCI Speech rechazó la sesión de transcripción.");
  if (data.event !== "RESULT" || !Array.isArray(data.transcriptions)) return [];
  return data.transcriptions.flatMap((item: { transcription?: unknown; isFinal?: unknown }) =>
    typeof item.transcription === "string" && item.transcription.trim()
      ? [{ transcript: item.transcription.trim(), isFinal: item.isFinal === true }]
      : [],
  );
}

export async function liveCapture(
  config: RealtimeSession,
  stream: MediaStream,
  onSpeech: (result: { transcript: string; isFinal: boolean }) => void,
  onError: (error: Error) => void,
  signal?: AbortSignal,
) {
  if (!/^wss:\/\/realtime\.aiservice\.[a-z0-9-]+\.oci\.oraclecloud\.com\/ws\/transcribe\/stream\?/.test(config.url))
    throw new Error("El destino de OCI Speech no es válido.");
  const context = new AudioContext({ sampleRate: config.sample_rate });
  let socket: WebSocket | undefined;
  let node: AudioWorkletNode | undefined;
  let closing = false;
  let source: MediaStreamAudioSourceNode | undefined;
  let rejectOpening: (() => void) | undefined;
  const close = () => {
    if (closing) return;
    closing = true;
    signal?.removeEventListener("abort", close);
    source?.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    node?.disconnect();
    socket?.close();
    void context.close().catch(() => {});
    rejectOpening?.();
  };
  const ensureActive = () => {
    if (closing || signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };
  signal?.addEventListener("abort", close, { once: true });
  try {
    ensureActive();
    await context.resume();
    ensureActive();
    await context.audioWorklet.addModule("/speech-capture.js");
    ensureActive();
    socket = new WebSocket(config.url);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("OCI Speech no respondió a tiempo.")), 15000);
      rejectOpening = () => { clearTimeout(timeout); reject(new DOMException("Aborted", "AbortError")); };
      socket!.onopen = () => { clearTimeout(timeout); resolve(); };
      socket!.onerror = () => { clearTimeout(timeout); reject(new Error("No se pudo conectar con OCI Speech.")); };
    });
    rejectOpening = undefined;
    ensureActive();
    socket.send(JSON.stringify(config.authentication));
    socket.onmessage = (event) => {
      if (closing) return;
      try {
        for (const result of speechResults(event.data)) {
          onSpeech(result);
        }
      } catch (error) { onError(error instanceof Error ? error : new Error("Respuesta de audio inválida.")); }
    };
    socket.onerror = () => { if (!closing) onError(new Error("Se interrumpió la conexión con OCI Speech.")); };
    socket.onclose = () => { if (!closing) onError(new Error("OCI Speech cerró la sesión de audio.")); };
    node = new AudioWorkletNode(context, "speech-capture");
    node.port.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      if (event.data === "flushed") return;
      if (socket?.readyState !== WebSocket.OPEN || closing) return;
      if (socket.bufferedAmount > 1024 * 1024) {
        onError(new Error("La conexión es demasiado lenta para transcribir en vivo."));
        return;
      }
      socket.send(event.data);
    };
    source = context.createMediaStreamSource(stream);
    source.connect(node);
    // The worklet has silent output; connecting it keeps capture processing active.
    node.connect(context.destination);
    return {
      cancel: close,
      async stop() {
        close();
      },
    };
  } catch (error) { close(); throw error; }
}
