import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentView, reduceAgentPacket } from "./aidp";
import {
  emptyRemoteSnapshot,
  projectRemoteView,
  streamRemoteTurn,
  openRemoteStream,
  confirmRemoteCancellation,
} from "./remoteAgent";

const request = {
  profile_id: "a".repeat(32),
  session_id: "session-1",
  request_id: "request-1",
  question: "Pregunta real",
};
const event = (sequence: number) => ({
  protocol: "ai-market-intelligence",
  version: "2.0",
  kind: "event",
  event: {
    event_id: `event-${sequence}`,
    sequence,
    turn_id: request.request_id,
    type: "draft.upsert",
    block_id: "source",
    source_key: "web",
    text: `Salida ${sequence}`,
    evidence_ids: [],
  },
});
const final = {
  protocol: "ai-market-intelligence",
  version: "2.0",
  kind: "response",
  request_id: request.request_id,
  response: {
    status: "complete",
    markdown: "Respuesta real",
    artifacts: [],
    references: [],
  },
};
const response = (...packets: unknown[]) =>
  new Response(
    packets.map((packet) => JSON.stringify(packet)).join("\n") + "\n",
  );
afterEach(() => vi.unstubAllGlobals());

it("keeps an automatic gap replay recoverable when its HTTP request is rejected", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(event(1), event(3)))
    .mockResolvedValueOnce(new Response("{}", { status: 403 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(
    streamRemoteTurn(request, new AbortController().signal, () => {}),
  ).rejects.toMatchObject({ code: "stream_interrupted" });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
    action: "replay",
    after_sequence: 1,
  });
});

describe("real Agent Flow transport", () => {
  it("projects public source progress without inventing a finding or answer", () => {
    const progress = {
      ...event(1),
      event: {
        ...event(1).event,
        type: "source.coverage",
        block_id: null,
        text: "Consultando la fuente seleccionada",
      },
    };
    const view = reduceAgentPacket(
      createAgentView(request.request_id),
      progress,
    );
    const snapshot = projectRemoteView(emptyRemoteSnapshot(), view);
    expect(snapshot.events).toEqual([
      expect.objectContaining({
        type: "source.coverage",
        source: "web",
        text: progress.event.text,
      }),
    ]);
    expect(snapshot.findings).toEqual([]);
    expect(view.blocks.size).toBe(0);
  });
  it("publishes received blocks before the stream is closed or a final response arrives", async () => {
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        writer = controller;
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const updates = vi.fn();
    let finished = false;
    const done = streamRemoteTurn(
      request,
      new AbortController().signal,
      updates,
    ).then((view) => {
      finished = true;
      return view;
    });
    writer.enqueue(new TextEncoder().encode(JSON.stringify(event(1)) + "\n"));
    await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(1));
    expect(updates.mock.calls[0][0].blocks.get("source").text).toBe("Salida 1");
    expect(finished).toBe(false);
    writer.enqueue(new TextEncoder().encode(JSON.stringify(event(2)) + "\n"));
    await vi.waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
    expect(finished).toBe(false);
    writer.enqueue(new TextEncoder().encode(JSON.stringify(final) + "\n"));
    writer.close();
    expect((await done).final?.markdown).toBe("Respuesta real");
  });
  it("waits for AIDP cancellation acknowledgement rather than closing after response headers", async () => {
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        writer = controller;
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    let confirmed = false;
    const done = confirmRemoteCancellation(
      { ...request, profile_id: `test:${request.profile_id}` },
      new AbortController().signal,
    ).then(() => {
      confirmed = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(confirmed).toBe(false);
    writer.enqueue(
      new TextEncoder().encode(
        JSON.stringify({
          ...final,
          response: { ...final.response, status: "cancelled" },
        }) + "\n",
      ),
    );
    writer.close();
    await done;
    expect(confirmed).toBe(true);
  });
  it.each(["another-request", request.request_id])(
    "rejects missing or unrelated cancellation acknowledgement for %s",
    async (identity) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(response({ ...final, request_id: identity })),
      );
      await expect(
        confirmRemoteCancellation(request, new AbortController().signal),
      ).rejects.toThrow("no confirmó");
    },
  );
  it.each(["research", "replay", "cancel"] as const)(
    "keeps %s commands on TEST with the same conversation",
    async (action) => {
      const fetcher = vi.fn().mockResolvedValue(response(final));
      vi.stubGlobal("fetch", fetcher);
      await openRemoteStream({
        ...request,
        profile_id: `test:${request.profile_id}`,
        action,
      });
      expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
        ...request,
        action,
        surface: "TEST",
      });
    },
  );
  it("posts the selected profile and stable session and projects only public outputs", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(event(1), final));
    vi.stubGlobal("fetch", fetcher);
    const view = await streamRemoteTurn(
      request,
      new AbortController().signal,
      () => {},
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(request);
    expect(fetcher.mock.calls[0][1].headers["X-Agent-Desk"]).toBe("configure");
    const initial = emptyRemoteSnapshot();
    initial.conversations.push({
      id: request.request_id,
      question: request.question,
      answer: "",
      createdAt: 0,
      chunks: 0,
      status: "running",
    });
    const projected = projectRemoteView(initial, view, 1000);
    expect(projected.conversations[0]).toMatchObject({
      answer: "Respuesta real",
      status: "completed",
    });
    expect(projected.findings[0]).toMatchObject({
      text: "Salida 1",
      remote: true,
    });
    expect(projected.tasks).toEqual([]);
    expect(projected.agents).toEqual([]);
  });
  it("replays sequence gaps with the accepted cursor without rerunning research", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(event(1), event(3)))
      .mockResolvedValueOnce(response(event(2), event(3), final));
    vi.stubGlobal("fetch", fetcher);
    const view = await streamRemoteTurn(
      request,
      new AbortController().signal,
      () => {},
    );
    expect(view.cursor).toBe(3);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      ...request,
      action: "replay",
      after_sequence: 1,
    });
  });
  it("reports gateway failures and truncated streams without synthesizing an answer", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({ kind: "transport_error", message: "OCI no disponible" }),
      )
      .mockResolvedValueOnce(response(event(1)));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      streamRemoteTurn(request, new AbortController().signal, () => {}),
    ).rejects.toThrow("OCI no disponible");
    await expect(
      streamRemoteTurn(request, new AbortController().signal, () => {}),
    ).rejects.toThrow("sin una respuesta final");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("withdraws charts that are absent from the final authoritative manifest", () => {
    let view = reduceAgentPacket(createAgentView(request.request_id), {
      ...event(1),
      artifacts: [
        {
          artifact_id: "chart",
          evidence_ids: [],
          title: "Observaciones",
          rows: [{ source: "web", count: 2 }],
        },
      ],
    });
    expect(
      projectRemoteView(emptyRemoteSnapshot(), view).findings.some(
        (finding) => finding.artifact,
      ),
    ).toBe(true);
    view = reduceAgentPacket(view, final);
    expect(
      projectRemoteView(emptyRemoteSnapshot(), view).findings.some(
        (finding) => finding.artifact,
      ),
    ).toBe(false);
  });
});

it("projects several genuine text deltas before closure and removes overlays on transport failure", async () => {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      writer = controller;
    },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
  const seen: string[] = [];
  const snapshot = {
    ...emptyRemoteSnapshot(),
    conversations: [
      {
        id: request.request_id,
        question: "Q",
        answer: "",
        createdAt: 0,
        chunks: 0,
        status: "running" as const,
      },
    ],
  };
  const finished = streamRemoteTurn(
    request,
    new AbortController().signal,
    (view) => {
      const projected = projectRemoteView(snapshot, view);
      expect(projected.conversations[0].answer).toBe("");
      seen.push(
        projected.events.find((event) => event.type === "source.streaming")
          ?.text ?? "",
      );
    },
  );
  const send = (phase: string, index: number, text = "") =>
    writer.enqueue(
      new TextEncoder().encode(
        JSON.stringify({
          protocol: "ai-market-intelligence",
          version: "2.0",
          kind: "text",
          request_id: request.request_id,
          turn_id: request.request_id,
          stream_id: "a".repeat(32),
          block_id: "source-web",
          block_revision: 1,
          source_key: "web",
          source_keys: ["web"],
          status: "provisional",
          phase,
          delta_index: index,
          text,
        }) + "\n",
      ),
    );
  send("start", 0);
  send("delta", 1, "First ");
  await vi.waitFor(() => expect(seen.at(-1)).toBe("First "));
  send("delta", 2, "second");
  await vi.waitFor(() => expect(seen.at(-1)).toBe("First second"));
  writer.enqueue(
    new TextEncoder().encode(
      JSON.stringify({ kind: "transport_error", message: "Connection lost" }) +
        "\n",
    ),
  );
  writer.close();
  await expect(finished).rejects.toThrow("Connection lost");
  expect(seen.at(-1)).toBe("");
});

it("reports an explicitly pending previous request without resubmitting research", async () => {
  const packet = {
    protocol: "ai-market-intelligence",
    version: "2.0",
    kind: "response",
    request_id: request.request_id,
    response: {
      status: "pending",
      resumable: true,
      pending_request_id: "old-request",
      markdown: "Retoma la solicitud anterior.",
      references: [],
      artifacts: [],
    },
  };
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(packet) + "\n"));
  vi.stubGlobal("fetch", fetcher);
  await expect(
    streamRemoteTurn(request, new AbortController().signal, () => {}),
  ).rejects.toThrow("Hay una solicitud anterior pendiente");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("continues its own pending TEST request with the same question and identity", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response(event(1), {
        ...final,
        response: {
          ...final.response,
          status: "pending",
          continuation_safe: true,
        },
      }),
    )
    .mockResolvedValueOnce(response(event(2), final));
  vi.stubGlobal("fetch", fetcher);
  const view = await streamRemoteTurn(
    { ...request, profile_id: `test:${request.profile_id}` },
    new AbortController().signal,
    () => {},
  );
  expect(view.final?.markdown).toBe("Respuesta real");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    ...request,
    action: "research",
    surface: "TEST",
  });
  expect(view.cursor).toBe(2);
});

it("resumes unfinished TEST work after a read-only recovery snapshot", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      response({
        protocol: "ai-market-intelligence",
        version: "2.0",
        kind: "snapshot",
        request_id: request.request_id,
        replay: { cursor: 0, events: [] },
        references: [],
        artifacts: [],
        response: null,
      }),
    )
    .mockResolvedValueOnce(response(final));
  vi.stubGlobal("fetch", fetcher);
  const view = await streamRemoteTurn(
    {
      ...request,
      profile_id: `test:${request.profile_id}`,
      action: "replay",
      after_sequence: 0,
    },
    new AbortController().signal,
    () => {},
  );
  expect(view.final?.status).toBe("complete");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    ...request,
    action: "research",
    surface: "TEST",
  });
});

it("bounds automatic TEST continuations and never resumes another request", async () => {
  const pending = {
    ...final,
    response: { ...final.response, status: "pending", continuation_safe: true },
  };
  const fetcher = vi
    .fn()
    .mockImplementation(() => Promise.resolve(response(pending)));
  vi.stubGlobal("fetch", fetcher);
  const selected = { ...request, profile_id: `test:${request.profile_id}` };
  await expect(
    streamRemoteTurn(selected, new AbortController().signal, () => {}),
  ).rejects.toThrow("La captura sigue pendiente");
  expect(fetcher).toHaveBeenCalledTimes(3);
  fetcher.mockClear().mockImplementation(() =>
    Promise.resolve(
      response({
        ...pending,
        response: {
          ...pending.response,
          pending_request_id: "another-request",
        },
      }),
    ),
  );
  await expect(
    streamRemoteTurn(selected, new AbortController().signal, () => {}),
  ).rejects.toThrow("solicitud anterior pendiente");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["pending", "snapshot"])(
  "streams new TEST text after %s while rejecting retired stream identities",
  async (initial) => {
    const text = (id: string, phase: string, index: number, value = "") => ({
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "text",
      request_id: request.request_id,
      turn_id: request.request_id,
      stream_id: id.repeat(32),
      block_id: "consolidated",
      block_revision: 1,
      source_key: null,
      source_keys: ["web"],
      status: "provisional",
      phase,
      delta_index: index,
      text: value,
    });
    const first =
      initial === "pending"
        ? {
            ...final,
            response: {
              ...final.response,
              status: "pending",
              continuation_safe: true,
            },
          }
        : {
            protocol: "ai-market-intelligence",
            version: "2.0",
            kind: "snapshot",
            request_id: request.request_id,
            replay: { cursor: 0, events: [] },
            references: [],
            artifacts: [],
            response: null,
          };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          text("a", "start", 0),
          text("a", "delta", 1, "Retired"),
          first,
        ),
      )
      .mockResolvedValueOnce(
        response(
          text("a", "delta", 2, " stale"),
          text("b", "start", 0),
          text("b", "delta", 1, "New "),
          text("b", "delta", 2, "answer"),
          final,
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const seen: string[] = [];
    const view = await streamRemoteTurn(
      {
        ...request,
        profile_id: `test:${request.profile_id}`,
        ...(initial === "snapshot" ? { action: "replay" as const } : {}),
      },
      new AbortController().signal,
      (current) =>
        seen.push(current.liveText.streams.get("consolidated")?.text ?? ""),
    );
    expect(seen).toContain("New ");
    expect(seen).toContain("New answer");
    expect(seen).not.toContain("Retired stale");
    expect(view.final?.markdown).toBe("Respuesta real");
    expect(fetcher).toHaveBeenCalledTimes(2);
  },
);

it("does not automatically continue uncertain TEST effects without the agent's safe signal", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    response({
      ...final,
      response: { ...final.response, status: "pending" },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    streamRemoteTurn(
      { ...request, profile_id: `test:${request.profile_id}` },
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow("La captura sigue pendiente");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("distinguishes an explicit resumable agent failure from an interrupted connection", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    response({
      ...final,
      response: { ...final.response, status: "failed", resumable: true },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    streamRemoteTurn(
      { ...request, profile_id: `test:${request.profile_id}` },
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toMatchObject({
    code: "agent_incomplete",
    message:
      "El agente detuvo la investigación. Puedes recuperar esta misma solicitud.",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("keeps durable source drafts in progress until genuine consolidated deltas arrive", () => {
  const snapshot = {
    ...emptyRemoteSnapshot(),
    conversations: [
      {
        id: request.request_id,
        question: "Q",
        answer: "",
        createdAt: 0,
        chunks: 0,
        status: "running" as const,
      },
    ],
  };
  let view = reduceAgentPacket(createAgentView(request.request_id), event(1));
  expect(projectRemoteView(snapshot, view).conversations[0].answer).toBe("");
  expect(projectRemoteView(snapshot, view).findings[0].text).toBe("Salida 1");
  const text = (phase: string, index: number, value = "") => ({
    protocol: "ai-market-intelligence",
    version: "2.0",
    kind: "text",
    request_id: request.request_id,
    turn_id: request.request_id,
    stream_id: "b".repeat(32),
    block_id: "consolidated",
    block_revision: 1,
    source_key: null,
    source_keys: ["web"],
    status: "provisional",
    phase,
    delta_index: index,
    text: value,
  });
  view = reduceAgentPacket(view, text("start", 0));
  view = reduceAgentPacket(view, text("delta", 1, "Final "));
  expect(projectRemoteView(snapshot, view).conversations[0]).toMatchObject({
    answer: "Final ",
    status: "running",
  });
  view = reduceAgentPacket(view, text("delta", 2, "answer"));
  expect(projectRemoteView(snapshot, view).conversations[0].answer).toBe(
    "Final answer",
  );
  view = reduceAgentPacket(view, {
    ...event(2),
    event: {
      ...event(2).event,
      type: "draft.compacted",
      block_id: "consolidated",
      block_revision: 1,
      text: "Final answer confirmed",
      status: "final",
    },
  });
  expect(view.liveText.streams.size).toBe(0);
  expect(projectRemoteView(snapshot, view).conversations[0]).toMatchObject({
    answer: "Final answer confirmed",
    status: "running",
  });
  view = reduceAgentPacket(view, {
    ...event(3),
    event: {
      ...event(3).event,
      type: "run.completed",
      block_id: undefined,
      text: "Canonical completed text",
      status: "partial",
    },
  });
  expect(projectRemoteView(snapshot, view).conversations[0].answer).toBe(
    "Canonical completed text",
  );
  view = reduceAgentPacket(view, final);
  expect(projectRemoteView(snapshot, view).conversations[0]).toMatchObject({
    answer: "Respuesta real",
    status: "completed",
  });
});

it("does not promote resumable response markdown into a final answer", () => {
  const snapshot = {
    ...emptyRemoteSnapshot(),
    conversations: [
      {
        id: request.request_id,
        question: "Q",
        answer: "",
        createdAt: 0,
        chunks: 0,
        status: "running" as const,
      },
    ],
  };
  const view = reduceAgentPacket(createAgentView(request.request_id), {
    ...final,
    response: {
      ...final.response,
      status: "partial",
      resumable: true,
      markdown: "Control summary while sources are pending",
    },
  });
  expect(projectRemoteView(snapshot, view).conversations[0]).toMatchObject({
    answer: "",
    status: "running",
  });
});
