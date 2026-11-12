import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { createAgentView, reduceAgentPacket } from "./aidp";
import {
  answerMarkdown,
  emptyRemoteSnapshot,
  projectRemoteView,
} from "./remoteAgent";
import { eventPresentation } from "./presentation";
import { writeChatStorage } from "./chatStorage";
import { isSnapshot, restoreChatSnapshot } from "./snapshot";
import { ChatActionsContext } from "./chatContext";
import { ToolProgress, progressEvents } from "./ToolProgress";
import { useRemoteAgent } from "./useRemoteAgent";

const messageIdentity = vi.hoisted(() => ({ id: "fixture-request-assistant" }));
vi.mock("@assistant-ui/react", () => ({
  useAuiState: () => messageIdentity.id,
}));
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  messageIdentity.id = "fixture-request-assistant";
});
const packets = readFileSync(
  `${import.meta.dirname}/fixtures/presentation-v1.ndjson`,
  "utf8",
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
function base() {
  const snapshot = emptyRemoteSnapshot();
  snapshot.conversations.push({
    id: "fixture-request",
    question: "Fixture",
    answer: "",
    createdAt: 0,
    chunks: 0,
    status: "running",
  });
  return snapshot;
}
const replay = packets.find((packet) => packet.kind === "snapshot");

it.each([true, false])(
  "keeps an operational failed response out of the answer (resumable=%s)",
  (resumable) => {
    const tail = readFileSync(
      `${import.meta.dirname}/fixtures/terminal-failure-v2.ndjson`,
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const requestId = tail[1].request_id;
    // The producer fixture is the terminal tail after the first two durable events.
    let view = { ...createAgentView(requestId), cursor: 2 };
    view = reduceAgentPacket(view, tail[0]);
    const response = {
      ...tail[1],
      response: { ...tail[1].response, resumable },
    };
    view = reduceAgentPacket(view, response);
    const snapshot = base();
    snapshot.conversations[0].id = requestId;
    expect(projectRemoteView(snapshot, view).conversations[0].answer).toBe("");
    expect(answerMarkdown(view.response)).toBe("");
    expect(view.response?.markdown).toBe(response.response.markdown);
    expect(view.response?.failure).toEqual(response.response.failure);
  },
);

it("preserves factual response text without a recognized operational failure", () => {
  for (const failure of [
    undefined,
    null,
    "failure",
    {},
    { stage: "", error_type: "Error" },
    { stage: "analyze", error_type: [] },
  ]) {
    const view = reduceAgentPacket(createAgentView("fixture-request"), {
      ...packets.at(-1),
      response: {
        ...packets.at(-1).response,
        status: "failed",
        failure,
        markdown: "Hallazgos parciales validados.",
      },
    });
    expect(answerMarkdown(view.response)).toBe(
      "Hallazgos parciales validados.",
    );
  }
});

it("keeps a typed consolidation in the answer without creating a second source card", () => {
  let view = createAgentView("fixture-request");
  const result = structuredClone(
    packets.find((packet) => packet.event?.type === "draft.upsert"),
  );
  result.event.sequence = 1;
  view = reduceAgentPacket(view, result);
  const compacted = structuredClone(result);
  Object.assign(compacted.event, {
    event_id: "compacted-result",
    sequence: 2,
    type: "draft.compacted",
    block_id: "consolidated",
    text: "Síntesis consolidada.",
  });
  view = reduceAgentPacket(view, compacted);
  const snapshot = projectRemoteView(base(), view);
  expect(snapshot.findings).toHaveLength(1);
  expect(snapshot.findings[0].id).toBe(
    `fixture-request:${result.event.block_id}`,
  );
  expect(snapshot.conversations[0].answer).toBe("Síntesis consolidada.");
});

it("retains a compacted result belonging to a source block", () => {
  const result = structuredClone(
    packets.find((packet) => packet.event?.type === "draft.upsert"),
  );
  Object.assign(result.event, {
    sequence: 1,
    type: "draft.compacted",
    block_id: "source-facebook",
  });
  const snapshot = projectRemoteView(
    base(),
    reduceAgentPacket(createAgentView("fixture-request"), result),
  );
  expect(snapshot.findings).toHaveLength(1);
  expect(snapshot.findings[0].text).toBe(result.event.text);
});

it("groups a source heading without merging its activities, notes or result", () => {
  const snapshot = base();
  for (const packet of packets.slice(0, 2)) {
    const view = reduceAgentPacket(createAgentView("fixture-request"), {
      ...packet,
      event: { ...packet.event, sequence: 1 },
    });
    snapshot.events.push(...projectRemoteView(base(), view).events);
  }
  snapshot.events.push({
    ...snapshot.events[0],
    id: 3,
    text: "Síntesis admitidas.",
    presentation: { schema_version: "1.0", purpose: "progress" },
  });
  snapshot.findings.push({
    id: "result",
    requestId: "fixture-request",
    source: "facebook",
    title: "Resultado",
    text: "**Hallazgo** de la fuente.",
    at: 0,
    remote: true,
  });
  snapshot.findings.push({
    id: "references-only",
    requestId: "fixture-request",
    source: "desk",
    sourceLabel: "Fuentes",
    title: "Fuentes de la respuesta",
    text: "",
    at: 0,
    remote: true,
  });
  const screen = render(
    <ChatActionsContext.Provider
      value={{ snapshot, onFeedback: () => {}, onRegenerate: () => {} }}
    >
      <ToolProgress />
    </ChatActionsContext.Provider>,
  );
  expect(
    screen.container.querySelectorAll(".tool-progress-label"),
  ).toHaveLength(1);
  expect(screen.container.querySelectorAll("[data-activity-id]")).toHaveLength(
    2,
  );
  expect(screen.container.textContent).toContain("Síntesis admitidas.");
  expect(
    screen.container.querySelector(".markdown-text strong")?.textContent,
  ).toBe("Hallazgo");
});

it("keeps unknown source identities on concurrent text overlays", () => {
  let view = createAgentView("fixture-request");
  const template = packets.find(
    (packet) => packet.kind === "text" && packet.phase === "start",
  );
  for (const [index, source] of ["catalogue", "inventory"].entries()) {
    const start = {
      ...template,
      source_key: source,
      source_keys: [source],
      block_id: source,
      stream_id: String(index).repeat(32),
    };
    view = reduceAgentPacket(view, start);
    view = reduceAgentPacket(view, {
      ...start,
      phase: "delta",
      delta_index: 1,
      text: `Texto de ${source}`,
    });
  }
  const overlays = projectRemoteView(base(), view).events.filter(
    (event) => event.type === "source.streaming",
  );
  expect(overlays.map((event) => event.sourceLabel)).toEqual([
    "catalogue",
    "inventory",
  ]);
  const snapshot = projectRemoteView(base(), view);
  const screen = render(
    <ChatActionsContext.Provider
      value={{ snapshot, onFeedback: () => {}, onRegenerate: () => {} }}
    >
      <ToolProgress />
    </ChatActionsContext.Provider>,
  );
  expect(
    screen.container.querySelectorAll(".tool-progress-label"),
  ).toHaveLength(2);
  expect(screen.container.textContent).toContain("Texto de catalogue");
  expect(screen.container.textContent).toContain("Texto de inventory");
});

it("preserves each producer activity, original copy, revisions and provisional discard", () => {
  let view = createAgentView("fixture-request");
  for (const packet of packets) {
    view = reduceAgentPacket(view, packet);
    const snapshot = projectRemoteView(base(), view, 1000);
    const activities = progressEvents(snapshot.events, view.requestId, true);
    if (packet.event?.sequence === 2) {
      expect(activities).toHaveLength(2);
      expect(activities.map((event) => event.text)).toEqual([
        packets[0].event.text,
        packets[1].event.text,
      ]);
      expect(snapshot.findings).toEqual([]);
    }
    if (packet.kind === "text" && packet.phase === "end") {
      expect(
        [...view.liveText.streams.values()].some(
          (stream) => stream.text === "Prosa provisional.",
        ),
      ).toBe(true);
      expect(snapshot.conversations[0].answer).toBe("");
    }
    if (packet.event?.sequence === 7) {
      expect(view.liveText.streams.size).toBe(0);
      expect(snapshot.findings[0].text).toBe("Observación revisada.");
      expect(snapshot.conversations[0].answer).toBe(packet.event.text);
    }
  }
  expect(view.final?.status).toBe("partial");
  expect(view.final?.markdown).toBe("La muestra es parcial.");
});

it("restores two original activities from snapshot alone, deduplicates replay and preserves history", () => {
  const view = reduceAgentPacket(createAgentView("fixture-request"), replay);
  expect(view.activities.size).toBe(2);
  const projected = projectRemoteView(base(), view);
  const activities = progressEvents(projected.events, view.requestId, false);
  expect(activities).toHaveLength(2);
  expect(
    activities.every(
      (event) => event.presentation?.activity?.outcome === "empty",
    ),
  ).toBe(true);
  expect(
    restoreChatSnapshot(JSON.parse(JSON.stringify(projected)))?.events,
  ).toEqual(projected.events);
  expect(reduceAgentPacket(view, packets[2]).activities).toEqual(
    view.activities,
  );
  const live = packets
    .slice(0, 4)
    .reduce(reduceAgentPacket, createAgentView("fixture-request"));
  expect(reduceAgentPacket(live, packets[0]).activities).toEqual(
    live.activities,
  );
});

it("renders Markdown and original text without replacing typed progress, and closes pending UI without success", () => {
  const packet = structuredClone(packets[0]);
  packet.event.text =
    "Información recuperada de la fuente; pendiente de análisis y verificación.";
  let view = reduceAgentPacket(createAgentView("fixture-request"), packet);
  const second = structuredClone(packets[1]);
  second.event.text = "**Recuperando** resultados de @Usuario";
  view = reduceAgentPacket(view, second);
  const snapshot = projectRemoteView(base(), view);
  const tree = (value: typeof snapshot) => (
    <ChatActionsContext.Provider
      value={{ snapshot: value, onFeedback: () => {}, onRegenerate: () => {} }}
    >
      <ToolProgress />
    </ChatActionsContext.Provider>
  );
  const screen = render(tree(snapshot));
  expect(screen.container.querySelectorAll("[data-activity-id]")).toHaveLength(
    2,
  );
  expect(screen.container.textContent).toContain(packet.event.text);
  expect(screen.container.textContent).not.toContain(
    "Analizando resultados...",
  );
  expect(screen.container.querySelector("strong")?.textContent).toBe(
    "Facebook",
  );
  expect(
    screen.container.querySelector(".markdown-text strong")?.textContent,
  ).toBe("Recuperando");
  expect(screen.container.querySelector(".user-mention")?.textContent).toBe(
    "@Usuario",
  );
  const final = projectRemoteView(
    snapshot,
    reduceAgentPacket(view, packets.at(-1)),
  );
  screen.rerender(tree(final));
  expect(screen.container.querySelector("details")?.open).toBe(false);
  expect(
    screen.container.querySelectorAll(
      '[data-activity-id][data-tool-status="interrupted"]',
    ),
  ).toHaveLength(2);
});

it.each([
  (packet: typeof replay) => {
    packet.event.coverage.presentation.purpose = "answer";
  },
  (packet: typeof replay) => {
    packet.event.coverage.presentation.schema_version = "9.0";
  },
  (packet: typeof replay) => {
    packet.event.coverage.presentation.activity.state = "completed";
  },
  (packet: typeof replay) => {
    packet.event.coverage.presentation.activity.outcome = "empty";
  },
  (packet: typeof replay) => {
    packet.event.coverage.presentation.activity.activity_id = "bad";
  },
  (packet: typeof replay) => {
    packet.event.coverage.phase = "failed";
  },
  (packet: typeof replay) => {
    const activity = packet.event.coverage.presentation.activity;
    activity.phase = "retrieved";
    activity.state = "completed";
    activity.outcome = ["empty"];
    packet.event.coverage.phase = "retrieved";
  },
  (packet: typeof replay) => {
    packet.event.coverage.presentation.activity.phase = ["retrieved"];
  },
])(
  "rejects contradictory or malformed presentation without changing the prior view",
  (change) => {
    const packet = structuredClone(packets[0]);
    change(packet);
    const view = createAgentView("fixture-request");
    expect(() => reduceAgentPacket(view, packet)).toThrow(TypeError);
    expect(view.cursor).toBe(0);
    expect(view.events.size).toBe(0);
  },
);

it.each(["foreign", "identity", "future", "limit", "null"])(
  "rejects invalid snapshot activity inventory: %s",
  (failure) => {
    const packet = structuredClone(replay);
    const activities = packet.replay.snapshot.activities;
    const key = Object.keys(activities)[0];
    if (failure === "foreign") activities[key].turn_id = "other";
    if (failure === "identity") activities.wrong = activities[key];
    if (failure === "future")
      activities[key].sequence = packet.replay.cursor + 1;
    if (failure === "null") packet.replay.snapshot.activities = null;
    if (failure === "limit")
      for (let index = 0; index < 801; index++)
        activities[index] = activities[key];
    expect(() =>
      reduceAgentPacket(createAgentView("fixture-request"), packet),
    ).toThrow(TypeError);
  },
);

it("validates persisted metadata and keeps legacy activity grouping and copy adaptation", () => {
  const legacy = structuredClone(packets[0]);
  delete legacy.event.coverage.presentation;
  expect(eventPresentation(legacy.event)).toBeUndefined();
  const view = reduceAgentPacket(createAgentView("fixture-request"), legacy);
  const snapshot = projectRemoteView(base(), view);
  expect(progressEvents(snapshot.events, view.requestId, true)).toHaveLength(1);
  snapshot.events[0].presentation = {
    schema_version: "1.0",
    purpose: "answer",
  };
  expect(isSnapshot(snapshot)).toBe(false);
});

it("retains newly replayed activities when no result block or response is available", async () => {
  let attempt = 0;
  const fetcher = vi.fn(async (_url, options) => {
    const requestId = JSON.parse(options.body).request_id;
    if (++attempt === 1)
      return new Response(
        JSON.stringify({ kind: "transport_error", message: "Disconnected" }) +
          "\n",
      );
    const packet = structuredClone(replay);
    packet.request_id = requestId;
    delete packet.response;
    packet.replay.cursor = 4;
    packet.replay.snapshot.blocks = {};
    for (const event of Object.values(
      packet.replay.snapshot.activities,
    ) as Record<string, unknown>[])
      event.turn_id = requestId;
    return new Response(JSON.stringify(packet) + "\n");
  });
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() =>
    useRemoteAgent("a".repeat(32), "activity-replay", () => {}),
  );
  await act(async () => {
    await expect(hook.result.current.send("Fixture")).rejects.toThrow();
  });
  const id = hook.result.current.snapshot.conversations[0].id;
  await act(async () => {
    await expect(hook.result.current.recover(id)).rejects.toThrow();
  });
  expect(
    progressEvents(hook.result.current.snapshot.events, id, false),
  ).toHaveLength(2);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("preserves current-turn saved progress on an empty replay alongside other turn events", async () => {
  const view = reduceAgentPacket(
    createAgentView("fixture-request"),
    packets[0],
  );
  const snapshot = projectRemoteView(base(), view);
  snapshot.conversations[0].status = "failed";
  snapshot.conversations[0].issue = {
    message: "Disconnected",
    kind: "warning",
    recoverable: true,
  };
  snapshot.events.push({
    ...snapshot.events[0],
    requestId: "older-request",
    id: 99,
  });
  writeChatStorage("remote-chats", { "empty-activity-replay": snapshot });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            protocol: "ai-market-intelligence",
            version: "2.0",
            kind: "heartbeat",
            request_id: "fixture-request",
          }) + "\n",
        ),
    ),
  );
  const hook = renderHook(() =>
    useRemoteAgent("a".repeat(32), "empty-activity-replay", () => {}),
  );
  await act(async () => {
    await expect(
      hook.result.current.recover("fixture-request"),
    ).rejects.toThrow();
  });
  expect(hook.result.current.snapshot.events).toEqual(snapshot.events);
});

it("supports attributed generic progress without an activity alongside provisional source text", () => {
  const packet = structuredClone(packets[0]);
  delete packet.event.coverage.presentation.activity;
  packet.event.source_key = "catalogue";
  const snapshot = projectRemoteView(
    base(),
    reduceAgentPacket(createAgentView("fixture-request"), packet),
  );
  snapshot.events.push({
    ...snapshot.events[0],
    id: 2,
    presentation: undefined,
    sourceLabel: undefined,
    source: "facebook",
    type: "source.streaming",
    text: "Provisional",
  });
  const error = vi.spyOn(console, "error");
  const screen = render(
    <ChatActionsContext.Provider
      value={{ snapshot, onFeedback: () => {}, onRegenerate: () => {} }}
    >
      <ToolProgress />
    </ChatActionsContext.Provider>,
  );
  expect(screen.container.textContent).toContain("catalogue");
  expect(screen.container.textContent).toContain("Provisional");
  expect(screen.container.querySelectorAll("li")).toHaveLength(2);
  expect(error).not.toHaveBeenCalled();
});

it.each([
  { status: "cancelled", resumable: false },
  { status: "failed", resumable: false },
  { status: "failed", resumable: true },
])(
  "stops activity UI on $status (resumable=$resumable) without changing its observed state",
  async ({ status, resumable }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        const requestId = JSON.parse(options.body).request_id;
        const event = structuredClone(packets[0]);
        event.event.turn_id = requestId;
        if (resumable) {
          event.event.coverage.phase = "pending";
          Object.assign(event.event.coverage.presentation.activity, {
            phase: "pending",
            state: "pending",
            outcome: "pending",
          });
        }
        const terminal = {
          ...event,
          event: {
            ...event.event,
            event_id: "terminal-fixture",
            sequence: 2,
            type: status === "cancelled" ? "run.cancelled" : "run.failed",
            status,
            text: "",
            coverage: {
              presentation: { schema_version: "1.0", purpose: "terminal" },
            },
          },
        };
        const response = {
          ...packets.at(-1),
          request_id: requestId,
          response: {
            status,
            resumable,
            markdown: "",
            references: [],
            artifacts: [],
          },
        };
        return new Response(
          [event, terminal, response]
            .map((packet) => JSON.stringify(packet))
            .join("\n") + "\n",
        );
      }),
    );
    const hook = renderHook(() =>
      useRemoteAgent(
        "a".repeat(32),
        `terminal-${status}-${resumable}`,
        () => {},
      ),
    );
    await act(async () => {
      if (resumable)
        await expect(hook.result.current.send("Fixture")).rejects.toThrow(
          "recuperar",
        );
      else await hook.result.current.send("Fixture");
    });
    const snapshot = hook.result.current.snapshot;
    expect(snapshot.conversations[0].status).toBe(status);
    if (resumable)
      expect(snapshot.conversations[0].issue?.recoverable).toBe(true);
    expect(snapshot.events[0].presentation?.activity?.state).toBe(
      resumable ? "pending" : "running",
    );
    messageIdentity.id = `${snapshot.conversations[0].id}-assistant`;
    const screen = render(
      <ChatActionsContext.Provider
        value={{ snapshot, onFeedback: () => {}, onRegenerate: () => {} }}
      >
        <ToolProgress />
      </ChatActionsContext.Provider>,
    );
    expect(screen.container.querySelector("details")?.open).toBe(false);
    expect(
      screen.container.querySelectorAll(
        '[data-activity-id][data-tool-status="interrupted"]',
      ),
    ).toHaveLength(1);
    expect(screen.container.querySelector('[data-running="true"]')).toBeNull();
  },
);
