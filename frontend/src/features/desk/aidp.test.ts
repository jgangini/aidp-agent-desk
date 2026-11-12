import { describe, expect, it } from "vitest";
import {
  createAgentView,
  readPublicPackets,
  reduceAgentPacket,
  ReplayRequired,
} from "./aidp";
const event = (sequence = 1, extra = {}) => ({
  protocol: "ai-market-intelligence",
  version: "2.0",
  kind: "event",
  event: {
    event_id: `e-${sequence}`,
    sequence,
    turn_id: "r",
    type: "draft.upsert",
    block_id: "b",
    evidence_ids: ["ref"],
    ...extra,
  },
});
const chart = { artifact_id: "chart", evidence_ids: ["ref"], type: "bar" };
const final = (artifacts: unknown[] = []) => ({
  protocol: "ai-market-intelligence",
  version: "2.0",
  kind: "response",
  request_id: "r",
  response: { status: "complete", references: [], artifacts },
});

describe("normalized AIDP v2 boundary", () => {
  it("accepts real coverage events without a content block and preserves replay sequencing", () => {
    const coverage = event(1, {
      type: "source.coverage",
      block_id: null,
      source_key: "x",
      text: "Consultando la fuente seleccionada",
      evidence_ids: [],
    });
    const view = reduceAgentPacket(createAgentView("r"), coverage);
    expect(view.cursor).toBe(1);
    expect(view.blocks.size).toBe(0);
    expect(reduceAgentPacket(view, coverage).events.size).toBe(1);
    const restored = reduceAgentPacket(createAgentView("r"), {
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "snapshot",
      request_id: "r",
      replay: { cursor: 1, events: [coverage.event] },
    });
    expect(restored.cursor).toBe(1);
    expect(restored.blocks.size).toBe(0);
    expect(
      reduceAgentPacket(restored, event(2)).blocks.get("b")?.sequence,
    ).toBe(2);
  });
  it.each(["", 0, false, [], {}])(
    "rejects an invalid non-null block identifier: %j",
    (block_id) => {
      expect(() =>
        reduceAgentPacket(createAgentView("r"), event(1, { block_id })),
      ).toThrow("Texto no válido");
    },
  );
  it("still requires a real block identifier inside a replay block snapshot", () => {
    expect(() =>
      reduceAgentPacket(createAgentView("r"), {
        protocol: "ai-market-intelligence",
        version: "2.0",
        kind: "snapshot",
        request_id: "r",
        replay: {
          cursor: 1,
          snapshot: {
            blocks: { b: event(1, { block_id: null }).event },
            artifacts: {},
          },
        },
      }),
    ).toThrow("Bloque de snapshot no válido");
  });
  it("deduplicates immutable events and requires replay across sequence gaps", () => {
    const view = reduceAgentPacket(createAgentView("r"), event());
    expect(reduceAgentPacket(view, event()).events.size).toBe(1);
    expect(() =>
      reduceAgentPacket(view, event(1, { text: "changed" })),
    ).toThrow("inmutable");
    expect(() => reduceAgentPacket(view, event(3))).toThrow(ReplayRequired);
    try {
      reduceAgentPacket(view, event(3));
    } catch (error) {
      expect((error as ReplayRequired).afterSequence).toBe(1);
    }
  });
  it("rejects foreign, private and unsupported packets without mutating state", () => {
    const view = createAgentView("r");
    for (const packet of [
      event(1, { turn_id: "foreign" }),
      { ...event(), version: "1.0" },
      { ...event(), kind: "tool", request_id: "r" },
    ])
      expect(() => reduceAgentPacket(view, packet)).toThrow();
    expect(view.cursor).toBe(0);
    expect(view.blocks.size).toBe(0);
  });
  it("withdraws provisional charts and never resurrects them after an empty final artifact set", () => {
    let view = reduceAgentPacket(createAgentView("r"), {
      ...event(),
      artifacts: [chart],
    });
    expect(view.artifacts.size).toBe(1);
    view = reduceAgentPacket(
      view,
      event(2, { type: "draft.corrected", status: "failed" }),
    );
    expect(view.artifacts.size).toBe(0);
    view = reduceAgentPacket(view, final());
    view = reduceAgentPacket(view, { ...event(3), artifacts: [chart] });
    expect(view.artifacts.size).toBe(0);
  });
  it("preserves pending responses and restores a snapshot with a contiguous replay cursor", () => {
    let view = reduceAgentPacket(createAgentView("r"), {
      ...event(),
      artifacts: [chart],
    });
    view = reduceAgentPacket(view, {
      ...final(),
      response: {
        status: "pending",
        resumable: true,
        references: [],
        artifacts: [],
      },
    });
    expect(view.final).toBeUndefined();
    expect(view.artifacts.size).toBe(1);
    view = reduceAgentPacket(view, {
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "snapshot",
      request_id: "r",
      replay: {
        cursor: 5,
        snapshot: { blocks: { b: event(5).event }, artifacts: { chart } },
      },
    });
    expect(view.cursor).toBe(5);
    expect(view.blocks.get("b")!.sequence).toBe(5);
    expect(reduceAgentPacket(view, event(6)).cursor).toBe(6);
  });
  it("validates manifests atomically and preserves signed query strings", () => {
    const view = createAgentView("r");
    const url = "https://cdn.example.org/file?signature=a%2Fb&expires=123";
    const reference = {
      evidence_id: "ref",
      url: "https://example.org/source",
      media: [{ kind: "image", delivery: "direct", role: "preview", url }],
    };
    const applied = reduceAgentPacket(view, {
      ...event(),
      references: [reference],
    });
    expect(applied.references.get("ref")!.media).toEqual(reference.media);
    expect(() =>
      reduceAgentPacket(view, {
        ...event(),
        references: [
          reference,
          { evidence_id: "bad", url: "javascript:alert(1)" },
        ],
      }),
    ).toThrow();
    expect(view.events.size).toBe(0);
    expect(view.references.size).toBe(0);
    expect(() =>
      reduceAgentPacket(applied, {
        ...event(2),
        references: [{ ...reference, url: "https://elsewhere.example.org" }],
      }),
    ).toThrow("destino");
  });
  it("frames UTF-8 and JSON split across arbitrary chunks, including final lines without newline", async () => {
    const bytes = new TextEncoder().encode('{"text":"señal"}\n{"done":true}');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const packets = [];
    for await (const packet of readPublicPackets(stream)) packets.push(packet);
    expect(packets).toEqual([{ text: "señal" }, { done: true }]);
  });
  it("aborts a pending read without starting another request", async () => {
    const abort = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const iterator = readPublicPackets(stream, abort.signal);
    const pending = iterator.next();
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toBe(true);
  });
});
