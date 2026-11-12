import { expect, it } from "vitest";
import {
  acceptContentItems,
  parseContentItems,
  type ContentItems,
} from "./contentItems";
import { createAgentView, reduceAgentPacket, readPublicPackets } from "./aidp";
import { emptyRemoteSnapshot, projectRemoteView } from "./remoteAgent";
import { readChatStorage, writeChatStorage } from "./chatStorage";
import { isSnapshot, restoreChatSnapshot } from "./snapshot";
import fixture from "./fixtures/content-items-v1.json";

it("bounds optional collections by UTF-8 bytes and item count", () => {
  const tooMany = collection();
  tooMany.items = Array.from({ length: 401 }, (_, index) => ({
    ...tooMany.items[0],
    item_id: `item-${index}`,
  }));
  expect(() => parseContentItems(tooMany)).toThrow();
  const multibyte = collection();
  multibyte.items = Array.from({ length: 200 }, (_, index) => ({
    ...multibyte.items[0],
    item_id: `item-${index}`,
    text: "漢".repeat(3000),
  }));
  expect(JSON.stringify(multibyte).length).toBeLessThan(1_048_576);
  expect(() => parseContentItems(multibyte)).toThrow("demasiado grande");
});

it("frames collection-sized packets while rejecting oversized NDJSON lines", async () => {
  const stream = (body: string) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
  const packets = [];
  for await (const packet of readPublicPackets(
    stream(JSON.stringify({ padding: "x".repeat(1_100_000) }) + "\n"),
  ))
    packets.push(packet);
  expect(packets).toHaveLength(1);
  await expect(async () => {
    for await (const _ of readPublicPackets(stream("x".repeat(2_097_153)))) {
      /* Framing must reject before JSON parsing. */
    }
  }).rejects.toThrow("demasiado grande");
});

const references = [
  {
    evidence_id: "page-1",
    url: "https://example.org/posts/1",
    content_basis: "post_text",
  },
  {
    evidence_id: "comment-1",
    url: "https://example.org/comments/1",
    requested_url: "https://example.org/posts/1",
    content_basis: "comment_text",
  },
];

it("accepts agent serialized envelopes including compacted replay and explicit withdrawal", () => {
  for (const envelope of [fixture.event, fixture.response, fixture.snapshot]) {
    const view = reduceAgentPacket(
      createAgentView("fixture-request"),
      envelope,
    );
    expect(view.contentItems).toEqual(fixture.collection);
    expect(
      reduceAgentPacket(view, {
        ...fixture.response,
        content_items: fixture.empty_collection,
      }).contentItems?.items,
    ).toEqual([]);
  }
});

it("keeps a cited comment attached to its reviewed parent publication within the same turn", () => {
  const view = reduceAgentPacket(createAgentView("fixture-request"), {
    ...fixture.event,
    event: { ...fixture.event.event, evidence_ids: ["comment-evidence"] },
  });
  const snapshot = emptyRemoteSnapshot();
  snapshot.conversations = [
    {
      id: "fixture-request",
      question: "Comentarios",
      answer: "",
      createdAt: 0,
      chunks: 0,
      status: "running",
    },
  ];
  const result = projectRemoteView(snapshot, view);
  expect(result.findings[0].references?.map((ref) => ref.evidence_id)).toEqual([
    "post-evidence",
    "comment-evidence",
  ]);
  expect(result.conversations[0].contentItems).toEqual(fixture.collection);
  const withoutReview = reduceAgentPacket(createAgentView("fixture-request"), {
    ...fixture.event,
    content_items: undefined,
    event: { ...fixture.event.event, evidence_ids: ["comment-evidence"] },
  });
  expect(
    projectRemoteView(
      emptyRemoteSnapshot(),
      withoutReview,
    ).findings[0].references?.map((ref) => ref.evidence_id),
  ).toEqual(["post-evidence", "comment-evidence"]);
  const parentOnly = reduceAgentPacket(createAgentView("fixture-request"), {
    ...fixture.event,
    content_items: undefined,
    event: { ...fixture.event.event, evidence_ids: ["post-evidence"] },
  });
  expect(
    projectRemoteView(
      emptyRemoteSnapshot(),
      parentOnly,
    ).findings[0].references?.map((ref) => ref.evidence_id),
  ).toEqual(["post-evidence", "comment-evidence"]);
});

it("binds comments to the primary publication even when supporting evidence includes another post", () => {
  const incoming = collection();
  incoming.items[0].evidence_ids.push("other-parent");
  const foreign = refs();
  foreign.set("other-parent", {
    evidence_id: "other-parent",
    url: "https://example.org/posts/2",
    content_basis: "post_text",
  });
  foreign.set("comment-1", {
    ...references[1],
    requested_url: "https://example.org/posts/2",
  });
  expect(
    acceptContentItems(undefined, incoming, foreign, new Map()).collection,
  ).toBeUndefined();
});

it("retains withdrawn item revision floors across reload and degrades unknown optional versions without losing messages", () => {
  const snapshot = emptyRemoteSnapshot();
  snapshot.conversations = [
    {
      id: "r",
      question: "Consulta",
      answer: "Respuesta anterior",
      createdAt: 0,
      chunks: 0,
      status: "running",
    },
  ];
  const first = reduceAgentPacket(createAgentView("r"), packet(collection(2)));
  const removedView = reduceAgentPacket(
    first,
    packet({ schema_version: "1.0", revision: 3, items: [] }, 2),
  );
  const removed = projectRemoteView(
    projectRemoteView(snapshot, first, 1),
    removedView,
    2,
  );
  const restored = restoreChatSnapshot(JSON.parse(JSON.stringify(removed)))!;
  const oldItem = collection(4);
  oldItem.items[0].item_revision = 1;
  const staleView = reduceAgentPacket(createAgentView("r"), packet(oldItem));
  expect(
    projectRemoteView(restored, staleView, 4).conversations[0].contentItems
      ?.items,
  ).toEqual([]);
  const future = JSON.parse(JSON.stringify(snapshot));
  future.conversations[0].contentItems = { schema_version: "2.0", items: [] };
  const compatible = restoreChatSnapshot(future)!;
  expect(compatible.conversations[0].answer).toBe("Respuesta anterior");
  expect(compatible.conversations[0].contentItems).toBeUndefined();
});
function collection(revision = 1): ContentItems {
  return {
    schema_version: "1.0",
    revision,
    items: [
      {
        item_id: "stable-item",
        item_revision: revision,
        source_key: "custom-source",
        kind: "post",
        primary_evidence_id: "page-1",
        evidence_ids: ["page-1"],
        text: "## Síntesis\nContenido **verificado**.",
        content_basis: ["post_text"],
        limitations: ["Muestra limitada."],
        comments_analysis: {
          status: "partial",
          parent_item_id: "stable-item",
          evidence_ids: ["comment-1"],
          analyzed_count: 1,
          text: "La muestra menciona la disponibilidad.",
          limitations: ["No representa a todos los clientes."],
        },
      },
    ],
  };
}
const refs = () => new Map(references.map((ref) => [ref.evidence_id, ref]));

it("accepts the agent-owned canonical fixture and preserves its legacy response", () => {
  expect(
    acceptContentItems(
      undefined,
      fixture.collection,
      new Map(fixture.references.map((ref) => [ref.evidence_id, ref])),
      new Map(),
    ).collection,
  ).toEqual(fixture.collection);
  const legacy = reduceAgentPacket(
    createAgentView("fixture-request"),
    fixture.legacy_response,
  );
  expect(legacy.contentItems).toBeUndefined();
  expect(legacy.final?.markdown).toBe("Respuesta sin colección opcional.");
});
const packet = (content_items?: unknown, sequence = 1) => ({
  protocol: "ai-market-intelligence",
  version: "2.0",
  kind: "event",
  event: {
    event_id: `event-${sequence}`,
    sequence,
    turn_id: "r",
    type: "draft.upsert",
    block_id: "custom",
    source_key: "web",
    text: "Resumen de fuente",
    evidence_ids: ["page-1"],
  },
  references,
  content_items,
});

it("accepts optional versioned reviewed content without restricting generic source names", () => {
  expect(parseContentItems(collection())).toEqual(collection());
  expect(parseContentItems({ schema_version: "2.0" })).toBeUndefined();
  expect(
    acceptContentItems(undefined, collection(), refs(), new Map()).collection,
  ).toEqual(collection());
  expect(
    reduceAgentPacket(createAgentView("r"), packet()).contentItems,
  ).toBeUndefined();
});

it("accepts a newer sibling collection and extra references without replaying its immutable event", () => {
  const initial = collection();
  delete initial.items[0].comments_analysis;
  const first = reduceAgentPacket(createAgentView("r"), {
    ...packet(initial),
    references: [references[0]],
  });
  const updated = reduceAgentPacket(first, packet(collection(2)));
  expect(updated.cursor).toBe(1);
  expect(updated.events.size).toBe(1);
  expect(updated.contentItems?.revision).toBe(2);
  expect(
    updated.contentItems?.items[0].comments_analysis?.evidence_ids,
  ).toEqual(["comment-1"]);
  expect(updated.references.size).toBe(2);
});

it("rejects malformed collections atomically while keeping ordinary events and prior content", () => {
  const first = reduceAgentPacket(createAgentView("r"), packet(collection()));
  for (const mutation of [
    (c: ContentItems) => {
      c.items.push(c.items[0]);
    },
    (c: ContentItems) => {
      c.items[0].primary_evidence_id = "missing";
    },
    (c: ContentItems) => {
      c.items[0].text = "a".repeat(3001);
    },
    (c: ContentItems) => {
      c.items[0].evidence_ids = ["comment-1"];
      c.items[0].primary_evidence_id = "comment-1";
    },
    (c: ContentItems) => {
      c.items[0].comments_analysis!.parent_item_id = "other";
    },
    (c: ContentItems) => {
      c.items[0].comments_analysis!.analyzed_count = 2;
    },
  ]) {
    const bad = collection(2);
    mutation(bad);
    const next = reduceAgentPacket(first, packet(bad, 2));
    expect(next.contentItems).toBe(first.contentItems);
    expect(next.cursor).toBe(2);
    expect(first.cursor).toBe(1);
  }
});

it("never attaches another publication's comments or unresolved references", () => {
  expect(
    acceptContentItems(undefined, collection(), new Map(), new Map())
      .collection,
  ).toBeUndefined();
  const foreign = refs();
  foreign.set("comment-1", {
    ...references[1],
    requested_url: "https://example.org/posts/2",
  });
  expect(
    acceptContentItems(undefined, collection(), foreign, new Map()).collection,
  ).toBeUndefined();
});

it("replaces by collection revision, preserves absence and ignores stale or contradictory items", () => {
  const first = reduceAgentPacket(createAgentView("r"), packet(collection()));
  expect(reduceAgentPacket(first, packet(undefined, 2)).contentItems).toBe(
    first.contentItems,
  );
  const conflict = collection();
  conflict.items[0].text = "contradiction";
  expect(reduceAgentPacket(first, packet(conflict, 2)).contentItems).toBe(
    first.contentItems,
  );
  conflict.revision = 2;
  expect(reduceAgentPacket(first, packet(conflict, 2)).contentItems).toBe(
    first.contentItems,
  );
  const updated = reduceAgentPacket(first, packet(collection(2), 2));
  expect(updated.contentItems?.revision).toBe(2);
  expect(
    reduceAgentPacket(updated, packet(collection(), 3)).contentItems?.revision,
  ).toBe(2);
  const withdrawn = reduceAgentPacket(
    updated,
    packet({ schema_version: "1.0", revision: 3, items: [] }, 3),
  );
  expect(withdrawn.contentItems?.items).toEqual([]);
  expect(
    reduceAgentPacket(withdrawn, packet(collection(1), 4)).contentItems?.items,
  ).toEqual([]);
  const resurrection = collection(4);
  resurrection.items[0].item_revision = 1;
  expect(
    reduceAgentPacket(withdrawn, packet(resurrection, 4)).contentItems?.items,
  ).toEqual([]);
});

it("accepts the capability on response and snapshot envelopes, never text or foreign requests", () => {
  for (const kind of ["response", "snapshot"]) {
    const view = reduceAgentPacket(createAgentView("r"), {
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind,
      request_id: "r",
      references,
      content_items: collection(),
      response: {
        status: "complete",
        markdown: "## Informe",
        references,
        artifacts: [],
      },
      replay: { cursor: 0, events: [] },
    });
    expect(view.contentItems).toEqual(collection());
    expect(view.final?.markdown).toBe("## Informe");
  }
  expect(() =>
    reduceAgentPacket(createAgentView("other"), packet(collection())),
  ).toThrow("otra solicitud");
});

it("persists content per turn, validates it on reload and preserves newer saved revisions during replay", () => {
  const snapshot = emptyRemoteSnapshot();
  snapshot.conversations = ["r", "other"].map((id) => ({
    id,
    question: "Consulta",
    answer: "",
    createdAt: 0,
    chunks: 0,
    status: "running",
  }));
  const first = projectRemoteView(
    snapshot,
    reduceAgentPacket(createAgentView("r"), packet(collection(2))),
    1,
  );
  expect(first.conversations[1].contentItems).toBeUndefined();
  writeChatStorage("content-test", first);
  const saved = readChatStorage("content-test");
  expect(isSnapshot(saved)).toBe(true);
  expect(saved).toEqual(first);
  const replay = projectRemoteView(
    first,
    reduceAgentPacket(createAgentView("r"), packet(collection())),
    2,
  );
  expect(replay.conversations[0].contentItems?.revision).toBe(2);
  const unsafe = structuredClone(first);
  unsafe.conversations[0].contentReferences![0].url = "javascript:alert(1)";
  expect(isSnapshot(unsafe)).toBe(false);
  const missing = structuredClone(first);
  missing.conversations[0].contentReferences = [];
  expect(isSnapshot(missing)).toBe(false);
  sessionStorage.removeItem("agent-desk.content-test");
});

it("projects cards from the accepted saved collection and manifest when a fresh replay contradicts an immutable item", () => {
  const snapshot = emptyRemoteSnapshot();
  snapshot.conversations = [
    {
      id: "r",
      question: "Consulta",
      answer: "",
      createdAt: 0,
      chunks: 0,
      status: "running",
    },
  ];
  const saved = projectRemoteView(
    snapshot,
    reduceAgentPacket(createAgentView("r"), packet(collection())),
  );
  const conflict = collection(2);
  conflict.items[0].item_revision = 1;
  conflict.items[0].text = "Contradiction";
  conflict.items[0].comments_analysis!.evidence_ids = ["new-comment"];
  const incoming = {
    ...packet(conflict),
    references: [
      { ...references[0], url: "https://example.org/posts/replaced" },
      {
        ...references[1],
        evidence_id: "new-comment",
        requested_url: "https://example.org/posts/replaced",
      },
    ],
  };
  const fresh = reduceAgentPacket(createAgentView("r"), incoming);
  expect(fresh.contentItems?.revision).toBe(2);
  const projected = projectRemoteView(saved, fresh);
  expect(projected.conversations[0].contentItems).toEqual(
    saved.conversations[0].contentItems,
  );
  expect(projected.conversations[0].contentReferences).toEqual(references);
  expect(projected.findings[0].references).toEqual(references);
});

it.each(["event", "response"])(
  "keeps new %s references when the accepted content collection is unchanged",
  (kind) => {
    const snapshot = emptyRemoteSnapshot();
    snapshot.conversations = [
      {
        id: "r",
        question: "Consulta",
        answer: "",
        createdAt: 0,
        chunks: 0,
        status: "running",
      },
    ];
    const first = reduceAgentPacket(createAgentView("r"), packet(collection()));
    const saved = projectRemoteView(snapshot, first);
    const added = {
      evidence_id: "new-page",
      url: "https://example.org/posts/added",
      content_basis: "post_text",
    };
    const incoming =
      kind === "event"
        ? {
            ...packet(undefined, 2),
            event: {
              ...packet(undefined, 2).event,
              block_id: "new",
              evidence_ids: [added.evidence_id],
            },
            references: [added],
          }
        : {
            protocol: "ai-market-intelligence",
            version: "2.0",
            kind: "response",
            request_id: "r",
            response: {
              status: "complete",
              markdown: "Answer",
              artifacts: [],
              references: [...references, added],
            },
          };
    const projected = projectRemoteView(
      saved,
      reduceAgentPacket(first, incoming),
    );
    expect(projected.conversations[0].contentItems).toEqual(
      saved.conversations[0].contentItems,
    );
    expect(projected.conversations[0].contentReferences).toContainEqual(added);
    if (kind === "event")
      expect(
        projected.findings.find((finding) => finding.id === "r:new")
          ?.references,
      ).toEqual([added]);
  },
);

it("rejects replaced evidence destinations even when a fresh replay has an identical collection", () => {
  const snapshot = emptyRemoteSnapshot();
  snapshot.conversations = [
    {
      id: "r",
      question: "Consulta",
      answer: "",
      createdAt: 0,
      chunks: 0,
      status: "running",
    },
  ];
  const saved = projectRemoteView(
    snapshot,
    reduceAgentPacket(createAgentView("r"), packet(collection())),
  );
  const incoming = {
    ...packet(collection()),
    references: [
      { ...references[0], url: "https://example.org/posts/replaced" },
      { ...references[1], requested_url: "https://example.org/posts/replaced" },
    ],
  };
  const projected = projectRemoteView(
    saved,
    reduceAgentPacket(createAgentView("r"), incoming),
  );
  expect(projected.conversations[0].contentItems).toEqual(
    saved.conversations[0].contentItems,
  );
  expect(projected.conversations[0].contentReferences).toEqual(references);
  expect(projected.findings[0].references).toEqual(references);
});

it("distinguishes accepted replay from contradictory or unreviewed collections", () => {
  const prior = collection();
  const refs = new Map(references.map((ref) => [ref.evidence_id, ref]));
  const history = new Map(prior.items.map((item) => [item.item_id, item]));
  expect(
    acceptContentItems(prior, structuredClone(prior), refs, history),
  ).toEqual({
    collection: prior,
    accepted: true,
  });
  expect(
    acceptContentItems(prior, structuredClone(prior), refs, history).collection,
  ).toBe(prior);
  const conflict = collection();
  conflict.items[0].text = "Contradictory content under the same revision";
  expect(acceptContentItems(prior, conflict, refs, history)).toEqual({
    collection: prior,
    accepted: false,
  });
  expect(acceptContentItems(prior, undefined, refs, history).accepted).toBe(
    false,
  );
  expect(
    acceptContentItems(prior, collection(), new Map(), history).accepted,
  ).toBe(false);
});
