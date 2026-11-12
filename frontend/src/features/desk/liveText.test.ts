import { describe, expect, it } from "vitest";
import { createAgentView, reduceAgentPacket, retireAgentText } from "./aidp";
import { emptyRemoteSnapshot, projectRemoteView } from "./remoteAgent";
import { isSnapshot } from "./snapshot";

const id = "a".repeat(32),
  other = "b".repeat(32);
function packet(phase = "start", index = 0, text = "", extra = {}) {
  return {
    protocol: "ai-market-intelligence",
    version: "2.0",
    kind: "text",
    request_id: "r",
    turn_id: "r",
    stream_id: id,
    block_id: "source-web",
    block_revision: 1,
    source_key: "web",
    source_keys: ["web"],
    status: "provisional",
    phase,
    delta_index: index,
    text,
    ...extra,
  };
}
const durable = (revision = 1) => ({
  protocol: "ai-market-intelligence",
  version: "2.0",
  kind: "event",
  event: {
    event_id: `e${revision}`,
    turn_id: "r",
    sequence: revision,
    type: "draft.upsert",
    block_id: "source-web",
    block_revision: revision,
    source_key: "web",
    text: "Reviewed",
    evidence_ids: [],
  },
  references: [],
  artifacts: [],
});
const answer = (view: ReturnType<typeof createAgentView>) =>
  projectRemoteView(
    {
      ...emptyRemoteSnapshot(),
      conversations: [
        {
          id: "r",
          question: "Q",
          answer: "",
          status: "running",
          createdAt: 0,
          chunks: 0,
        },
      ],
    },
    view,
  ).conversations[0].answer;

const sourceText = (view: ReturnType<typeof createAgentView>) => {
  const projected = projectRemoteView(emptyRemoteSnapshot(), view);
  return (
    projected.events.find((event) => event.type === "source.streaming")?.text ??
    projected.findings.find((finding) => finding.source === "web")?.text ??
    ""
  );
};

describe("transient public text", () => {
  it("appends real deltas before end without changing the durable cursor or findings", () => {
    let view = reduceAgentPacket(createAgentView("r"), packet());
    view = reduceAgentPacket(view, packet("delta", 1, "First "));
    expect(sourceText(view)).toBe("First ");
    view = reduceAgentPacket(view, packet("delta", 2, "fragment"));
    view = reduceAgentPacket(view, packet("end", 3));
    expect(sourceText(view)).toBe("First fragment");
    expect(view.cursor).toBe(0);
    expect(view.events.size).toBe(0);
    expect(projectRemoteView(emptyRemoteSnapshot(), view).findings).toEqual([]);
    expect(isSnapshot(projectRemoteView(emptyRemoteSnapshot(), view))).toBe(
      true,
    );
    const duplicate = reduceAgentPacket(view, packet("delta", 2, "fragment"));
    expect(sourceText(duplicate)).toBe("First fragment");
    expect(() =>
      reduceAgentPacket(view, packet("delta", 2, "changed")),
    ).toThrow(/inmutable/);
    view = reduceAgentPacket(view, durable());
    expect(sourceText(view)).toBe("Reviewed");
    expect(view.liveText.streams.size).toBe(0);
    view = reduceAgentPacket(view, packet("delta", 4, "late"));
    expect(sourceText(view)).toBe("Reviewed");
  });
  it("supersedes attempts of the same revision and supports discard after end", () => {
    let view = reduceAgentPacket(createAgentView("r"), packet());
    view = reduceAgentPacket(view, packet("delta", 1, "old"));
    view = reduceAgentPacket(
      view,
      packet("start", 0, "", { stream_id: other }),
    );
    view = reduceAgentPacket(view, packet("delta", 2, "late old"));
    view = reduceAgentPacket(
      view,
      packet("delta", 1, "new", { stream_id: other }),
    );
    view = reduceAgentPacket(view, packet("end", 2, "", { stream_id: other }));
    expect(sourceText(view)).toBe("new");
    view = reduceAgentPacket(
      view,
      packet("discard", 3, "", { stream_id: other }),
    );
    expect(sourceText(view)).toBe("");
    view = reduceAgentPacket(
      view,
      packet("delta", 4, "late new", { stream_id: other }),
    );
    expect(sourceText(view)).toBe("");
  });
  it("preserves a newer overlay when an older durable block arrives", () => {
    let view = reduceAgentPacket(
      createAgentView("r"),
      packet("start", 0, "", { block_revision: 2 }),
    );
    view = reduceAgentPacket(
      view,
      packet("delta", 1, "newer", { block_revision: 2 }),
    );
    view = reduceAgentPacket(view, durable());
    expect(sourceText(view)).toBe("newer");
    view = reduceAgentPacket(view, durable(2));
    expect(sourceText(view)).toBe("Reviewed");
  });
  it("interleaves sources and shows consolidated text in preference to their drafts", () => {
    let view = reduceAgentPacket(createAgentView("r"), packet());
    view = reduceAgentPacket(view, packet("delta", 1, "web"));
    const extra = {
      stream_id: other,
      block_id: "consolidated",
      source_key: null,
      source_keys: ["web", "x"],
    };
    view = reduceAgentPacket(view, packet("start", 0, "", extra));
    view = reduceAgentPacket(view, packet("delta", 1, "Synthesis", extra));
    expect(answer(view)).toBe("Synthesis");
    view = reduceAgentPacket(view, {
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "response",
      request_id: "r",
      response: {
        status: "completed",
        markdown: "Canonical",
        references: [],
        artifacts: [],
      },
    });
    expect(answer(view)).toBe("Canonical");
    expect(view.liveText.streams.size).toBe(0);
    view = reduceAgentPacket(
      view,
      packet("start", 0, "", { stream_id: "c".repeat(32) }),
    );
    expect(answer(view)).toBe("Canonical");
  });
  it("clears provisional text on snapshot and reconnection without losing durable data", () => {
    let view = reduceAgentPacket(createAgentView("r"), durable());
    view = reduceAgentPacket(
      view,
      packet("start", 0, "", { block_revision: 2 }),
    );
    view = reduceAgentPacket(
      view,
      packet("delta", 1, "unreviewed", { block_revision: 2 }),
    );
    expect(sourceText(view)).toBe("unreviewed");
    const clean = retireAgentText(view);
    expect(sourceText(clean)).toBe("Reviewed");
    expect(clean.cursor).toBe(1);
    view = reduceAgentPacket(view, {
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "snapshot",
      request_id: "r",
      replay: { cursor: 1, events: [] },
    });
    expect(sourceText(view)).toBe("Reviewed");
    view = reduceAgentPacket(
      view,
      packet("start", 0, "", { stream_id: other }),
    );
    expect(sourceText(view)).toBe("Reviewed");
  });
  it.each([
    { turn_id: "other" },
    { request_id: "other" },
    { stream_id: "bad" },
    { status: "final" },
    { source_keys: Array(9).fill("web") },
    { phase: ["end"] },
    { delta_index: 1024 },
  ])("rejects invalid text identities and envelopes %j", (extra) => {
    expect(() =>
      reduceAgentPacket(createAgentView("r"), packet("start", 0, "", extra)),
    ).toThrow();
  });
  it("rejects missing starts, gaps, metadata changes and new deltas after end", () => {
    expect(() =>
      reduceAgentPacket(createAgentView("r"), packet("delta", 1, "x")),
    ).toThrow(/iniciado/);
    let view = reduceAgentPacket(createAgentView("r"), packet());
    expect(() => reduceAgentPacket(view, packet("delta", 2, "gap"))).toThrow(
      /orden/,
    );
    expect(() =>
      reduceAgentPacket(view, packet("delta", 1, "x", { source_key: "x" })),
    ).toThrow(/incompatible/);
    view = reduceAgentPacket(view, packet("end", 1));
    expect(() => reduceAgentPacket(view, packet("delta", 2, "x"))).toThrow(
      /terminado/,
    );
  });
  it("counts Unicode code points and enforces fragment, stream and packet bounds", () => {
    let view = reduceAgentPacket(createAgentView("r"), packet());
    expect(() =>
      reduceAgentPacket(view, packet("delta", 1, "x".repeat(2049))),
    ).toThrow(/fragmento/);
    view = reduceAgentPacket(view, packet("delta", 1, "😀".repeat(2048)));
    for (let index = 2; index <= 9; index++)
      view = reduceAgentPacket(view, packet("delta", index, "x".repeat(2048)));
    expect(() =>
      reduceAgentPacket(view, packet("delta", 10, "x".repeat(2048))),
    ).toThrow(/grande/);
    let bounded = reduceAgentPacket(createAgentView("r"), packet());
    for (let index = 1; index < 1024; index++)
      bounded = reduceAgentPacket(bounded, packet("delta", index, "x"));
    expect(() =>
      reduceAgentPacket(bounded, packet("start", 0, "", { stream_id: other })),
    ).toThrow(/Demasiados/);
  });
});

it("does not expose withdrawn consolidated text after a failed correction or empty final", () => {
  let view = reduceAgentPacket(
    createAgentView("r"),
    packet("start", 0, "", { block_id: "consolidated" }),
  );
  view = reduceAgentPacket(
    view,
    packet("delta", 1, "Unreviewed", { block_id: "consolidated" }),
  );
  view = reduceAgentPacket(view, {
    ...durable(),
    event: {
      ...durable().event,
      block_id: "consolidated",
      type: "draft.corrected",
      status: "failed",
      text: "Withdrawn",
    },
  });
  expect(sourceText(view)).toBe("");
  view = reduceAgentPacket(view, {
    protocol: "ai-market-intelligence",
    version: "2.0",
    kind: "response",
    request_id: "r",
    response: { status: "failed", markdown: "", references: [], artifacts: [] },
  });
  expect(sourceText(view)).toBe("");
});
