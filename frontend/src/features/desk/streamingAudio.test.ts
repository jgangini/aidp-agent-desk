// @vitest-environment node
import { expect, it, vi } from "vitest";
import { streamingAudio } from "./streamingAudio";

it("plays MP3 chunks before the server finishes streaming", async () => {
  const appended: number[] = [];
  class Buffer extends EventTarget {
    appendBuffer(chunk: ArrayBuffer) {
      appended.push(chunk.byteLength);
      queueMicrotask(() => this.dispatchEvent(new Event("updateend")));
    }
  }
  let source: Source;
  class Source extends EventTarget {
    static isTypeSupported() { return true; }
    readyState = "open";
    constructor() { super(); source = this; }
    addSourceBuffer() { return new Buffer(); }
    endOfStream() { this.readyState = "ended"; }
  }
  vi.stubGlobal("MediaSource", Source);
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  try {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const audio = { set src(_value: string) {
      queueMicrotask(() => source.dispatchEvent(new Event("sourceopen")));
    } } as HTMLAudioElement;
    const playback = await streamingAudio(new Response(body, {headers: {"content-type": "audio/mpeg"}}), audio, new AbortController().signal);
    controller!.enqueue(new Uint8Array([1, 2, 3]));
    await vi.waitFor(() => expect(appended).toEqual([3]));
    expect(source!.readyState).toBe("open");
    controller!.close();
    await playback.done;
    expect(source!.readyState).toBe("ended");
  } finally { create.mockRestore(); vi.unstubAllGlobals(); }
});
