export async function streamingAudio(response: Response, audio: HTMLAudioElement, signal: AbortSignal) {
  const mime = response.headers.get("content-type")?.split(";")[0] || "audio/mpeg";
  if (!response.body || typeof MediaSource === "undefined" || !MediaSource.isTypeSupported(mime)) {
    const url = URL.createObjectURL(await response.blob());
    audio.src = url;
    return { url, done: Promise.resolve() };
  }
  const media = new MediaSource();
  const url = URL.createObjectURL(media);
  audio.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      media.addEventListener("sourceopen", () => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, { once: true });
      if (signal.aborted) abort();
    });
    const buffer = media.addSourceBuffer(mime);
    const reader = response.body.getReader();
    const done = (async () => {
      try {
        while (!signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done || signal.aborted) break;
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              buffer.removeEventListener("updateend", complete);
              buffer.removeEventListener("error", fail);
              signal.removeEventListener("abort", fail);
            };
            const complete = () => { cleanup(); resolve(); };
            const fail = () => { cleanup(); reject(new Error("Se interrumpió el audio del agente.")); };
            buffer.addEventListener("updateend", complete, { once: true });
            buffer.addEventListener("error", fail, { once: true });
            signal.addEventListener("abort", fail, { once: true });
            try { buffer.appendBuffer(chunk.value.slice().buffer); } catch (error) { cleanup(); reject(error); }
          });
        }
        if (media.readyState === "open" && !signal.aborted) media.endOfStream();
      } finally { await reader.cancel().catch(() => {}); }
    })();
    return { url, done };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
