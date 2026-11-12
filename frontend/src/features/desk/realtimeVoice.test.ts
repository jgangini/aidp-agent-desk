// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { liveCapture, speechResults } from "./realtimeVoice";

afterEach(() => vi.unstubAllGlobals());

function captureEnvironment(resume = Promise.resolve()) {
  const trackStop = vi.fn();
  const disconnect = vi.fn();
  const contextClose = vi.fn().mockResolvedValue(undefined);
  const addModule = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("AudioContext", class {
    audioWorklet = { addModule };
    destination = {};
    resume = () => resume;
    close = contextClose;
    createMediaStreamSource = () => ({ connect: vi.fn(), disconnect });
  });
  vi.stubGlobal("AudioWorkletNode", class {
    port = { onmessage: null, postMessage: vi.fn() };
    connect = vi.fn();
    disconnect = vi.fn();
  });
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    onopen?: () => void;
    onerror?: () => void;
    onclose?: () => void;
    onmessage?: (event: { data: string }) => void;
    send = vi.fn();
    close = vi.fn();
    constructor() { sockets.push(this); }
  }
  vi.stubGlobal("WebSocket", FakeSocket);
  const stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
  const config = {
    mode: "realtime" as const,
    url: "wss://realtime.aiservice.us-chicago-1.oci.oraclecloud.com/ws/transcribe/stream?session=test",
    authentication: { token: "test" }, sample_rate: 16000,
  };
  return { config, stream, sockets, trackStop, disconnect, contextClose, addModule };
}

describe("live capture lifecycle", () => {
  it("stops tracks, audio and socket immediately and ignores late speech", async () => {
    const env = captureEnvironment();
    const onSpeech = vi.fn();
    const pending = liveCapture(env.config, env.stream, onSpeech, vi.fn());
    await vi.waitFor(() => expect(env.sockets).toHaveLength(1));
    env.sockets[0].onopen?.();
    const capture = await pending;
    await capture.stop();
    capture.cancel();
    env.sockets[0].onmessage?.({ data: JSON.stringify({ event: "RESULT", transcriptions: [{ transcription: "Tarde", isFinal: true }] }) });
    expect(env.trackStop).toHaveBeenCalledTimes(1);
    expect(env.disconnect).toHaveBeenCalledTimes(1);
    expect(env.contextClose).toHaveBeenCalledTimes(1);
    expect(env.sockets[0].close).toHaveBeenCalledTimes(1);
    expect(env.sockets[0].send).toHaveBeenCalledTimes(1);
    expect(onSpeech).not.toHaveBeenCalled();
  });

  it("cancels an opening socket without waiting for its timeout", async () => {
    const env = captureEnvironment();
    const controller = new AbortController();
    const pending = liveCapture(env.config, env.stream, vi.fn(), vi.fn(), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(env.sockets).toHaveLength(1));
    controller.abort();
    await rejected;
    expect(env.sockets[0].close).toHaveBeenCalledTimes(1);
    expect(env.trackStop).toHaveBeenCalledTimes(1);
  });

  it("cannot create a socket after cancellation while audio is resuming", async () => {
    let resume!: () => void;
    const env = captureEnvironment(new Promise<void>((resolve) => { resume = resolve; }));
    const controller = new AbortController();
    const pending = liveCapture(env.config, env.stream, vi.fn(), vi.fn(), controller.signal);
    controller.abort();
    expect(env.trackStop).toHaveBeenCalledTimes(1);
    resume();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(env.sockets).toHaveLength(0);
    expect(env.addModule).not.toHaveBeenCalled();
  });
});

describe("OCI live transcription", () => {
  it("keeps final phrases and ignores protocol messages", () => {
    expect(speechResults(JSON.stringify({event: "ACK"}))).toEqual([]);
    expect(speechResults(JSON.stringify({event:"RESULT", transcriptions:[{transcription:" Hola ", isFinal:true},{transcription:"",isFinal:false}]}))).toEqual([{transcript:"Hola",isFinal:true}]);
    expect(() => speechResults(JSON.stringify({event:"ERROR"}))).toThrow("OCI Speech");
  });
  it("preserves provider partial results for immediate composer updates", () => {
    expect(speechResults(JSON.stringify({
      event: "RESULT",
      transcriptions: [{ transcription: " Hola en vivo ", isFinal: false }],
    }))).toEqual([{ transcript: "Hola en vivo", isFinal: false }]);
  });
  it("flushes the last short PCM fragment before acknowledging stop", () => {
    let Processor: any;
    const messages: any[] = [];
    vm.runInNewContext(readFileSync(new URL("../../../public/speech-capture.js", import.meta.url), "utf8"), {
      AudioWorkletProcessor: class { port = {postMessage: (value: unknown) => messages.push(value)}; },
      registerProcessor: (_name: string, value: unknown) => { Processor = value; },
      ArrayBuffer, DataView,
    });
    const capture = new Processor();
    capture.process([[new Float32Array([-2,0,2]),new Float32Array([-2,0,2])]]);
    expect(messages).toHaveLength(0);
    capture.port.onmessage({data:"flush"});
    expect(messages[1]).toBe("flushed");
    const pcm = new DataView(messages[0]);
    expect(pcm.byteLength).toBe(6);
    expect(pcm.getInt16(0,true)).toBe(-32768);
    expect(pcm.getInt16(4,true)).toBe(32767);
    capture.port.onmessage({data:"flush"});
    expect(messages).toHaveLength(3);
  });
});
