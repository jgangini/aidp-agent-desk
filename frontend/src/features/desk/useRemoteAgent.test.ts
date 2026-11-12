import { act, cleanup, renderHook } from "@testing-library/react";

import { afterEach, expect, it, vi } from "vitest";

import { SwarmEngine } from "./engine";
import { useRemoteAgent } from "./useRemoteAgent";

afterEach(() => {
  cleanup();

  sessionStorage.clear();

  vi.unstubAllGlobals();
});

it.each([403, 404, 422, 429])(
  "does not offer replay after a definite HTTP %s rejection",
  async (status) => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ detail: "Revisa la consulta o la conexión." }),
          { status },
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const hook = renderHook(() =>
      useRemoteAgent("a".repeat(32), "rejected", () => {}),
    );
    await act(async () => {
      await expect(hook.result.current.send("Q")).rejects.toThrow(
        "Revisa la consulta",
      );
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(hook.result.current.snapshot.conversations[0]).toMatchObject({
      answer: "",
      status: "failed",
      issue: {
        recoverable: false,
        kind: "error",
        message: "Revisa la consulta o la conexión.",
      },
    });
  },
);

it("explains a structured validation rejection without echoing its request input", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ detail: [{ input: "private question" }] }),
          { status: 422 },
        ),
    ),
  );
  const hook = renderHook(() =>
    useRemoteAgent("a".repeat(32), "validation", () => {}),
  );
  await act(async () => {
    await expect(hook.result.current.send("Q")).rejects.toThrow(
      "500 caracteres",
    );
  });
  expect(hook.result.current.snapshot.conversations[0].issue?.recoverable).toBe(
    false,
  );
});

it.each([403, 429])(
  "retains recovery after HTTP %s rejects replay of an accepted request",
  async (status) => {
    let calls = 0;
    const fetcher = vi.fn(async (_url, options) => {
      calls++;
      if (calls === 1) return new Response("");
      if (calls === 2) return new Response("{}", { status });
      return new Response(
        JSON.stringify({
          protocol: "ai-market-intelligence",
          version: "2.0",
          kind: "response",
          request_id: JSON.parse(options.body).request_id,
          response: {
            status: "complete",
            markdown: "Recovered",
            artifacts: [],
            references: [],
          },
        }) + "\n",
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const hook = renderHook(() =>
      useRemoteAgent("a".repeat(32), "replay-rejection", () => {}),
    );
    await act(async () => {
      await expect(hook.result.current.send("Q")).rejects.toThrow();
    });
    const id = hook.result.current.snapshot.conversations[0].id;
    await act(async () => {
      await expect(hook.result.current.recover(id)).rejects.toThrow();
    });
    expect(
      hook.result.current.snapshot.conversations[0].issue?.recoverable,
    ).toBe(true);
    await act(async () => {
      await hook.result.current.recover(id);
    });
    expect(hook.result.current.snapshot.conversations[0]).toMatchObject({
      id,
      status: "completed",
      answer: "Recovered",
    });
    expect(
      fetcher.mock.calls.map((call) => JSON.parse(call[1].body).request_id),
    ).toEqual([id, id, id]);
  },
);

it("keeps a real session across questions and restores each conversation independently", async () => {
  const fetcher = vi.fn(async (_url, options) => {
    const body = JSON.parse(options.body);

    return new Response(
      JSON.stringify({
        protocol: "ai-market-intelligence",

        version: "2.0",

        kind: "response",

        request_id: body.request_id,

        response: {
          status: "complete",

          markdown: body.question,

          artifacts: [],

          references: [],
        },
      }) + "\n",
    );
  });

  vi.stubGlobal("fetch", fetcher);

  const { result, rerender } = renderHook(
    ({ session }) => useRemoteAgent("a".repeat(32), session, () => {}),

    { initialProps: { session: "first" } },
  );

  await act(async () => {
    await result.current.send("Primera");
  });

  await act(async () => {
    await result.current.send("Segunda");
  });

  expect(
    fetcher.mock.calls.map((call) => JSON.parse(call[1].body).session_id),
  ).toEqual(["first", "first"]);

  rerender({ session: "second" });

  expect(result.current.snapshot.conversations).toHaveLength(0);

  rerender({ session: "first" });

  expect(
    result.current.snapshot.conversations.map((turn) => turn.answer),
  ).toEqual(["Primera", "Segunda"]);

  expect(result.current.snapshot.findings).toEqual([]);

  const original = result.current.snapshot;

  cleanup();

  fetcher.mockClear();

  const restored = renderHook(() =>
    useRemoteAgent("a".repeat(32), "first", () => {}),
  );

  expect(restored.result.current.snapshot).toEqual(original);

  expect(fetcher).not.toHaveBeenCalled();
});

it("restores an interrupted stream without resending or pretending it is still connected", async () => {
  const fetcher = vi.fn(
    (_url: unknown, _options: { body: string }) =>
      new Promise<Response>(() => {}),
  );

  vi.stubGlobal("fetch", fetcher);

  const first = renderHook(() =>
    useRemoteAgent("test:profile", "running", () => {}),
  );

  act(() => {
    void first.result.current.send("Consulta en curso");
  });

  const stored = sessionStorage.getItem("agent-desk.remote-chats")!;

  const request = JSON.parse(fetcher.mock.calls[0][1].body);

  // Simulate page teardown without invoking the hook's explicit cancel cleanup.

  sessionStorage.setItem("agent-desk.remote-chats", stored);

  const restored = renderHook(() =>
    useRemoteAgent("test:profile", "running", () => {}),
  );

  expect(restored.result.current.snapshot.conversations[0]).toMatchObject({
    id: request.request_id,

    question: "Consulta en curso",

    status: "failed",
  });

  expect(
    restored.result.current.snapshot.conversations[0].issue?.message,
  ).toContain("no se volvió a enviar");

  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("persists a single transport issue and replays the original request after reload without a new turn", async () => {
  let sent: Record<string, unknown>;
  const fetcher = vi.fn(async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        kind: "transport_error",
        code: "stream_interrupted",
        message: "private low level",
      }) + "\n",
    );
  });
  vi.stubGlobal("fetch", fetcher);
  const first = renderHook(() =>
    useRemoteAgent("a".repeat(32), "recover-session", () => {}),
  );
  await act(async () => {
    await expect(first.result.current.send("Question")).rejects.toThrow();
  });
  const id = first.result.current.snapshot.conversations[0].id;
  expect(first.result.current.snapshot.conversations[0]).toMatchObject({
    answer: "",
    status: "failed",
    issue: { kind: "warning", recoverable: true },
  });
  cleanup();
  fetcher.mockClear();
  const restored = renderHook(() =>
    useRemoteAgent("a".repeat(32), "recover-session", () => {}),
  );
  expect(restored.result.current.snapshot.conversations[0].issue).toBeDefined();
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockImplementation(async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        protocol: "ai-market-intelligence",
        version: "2.0",
        kind: "response",
        request_id: id,
        response: {
          status: "completed",
          markdown: "Recovered answer",
          references: [],
          artifacts: [],
        },
      }) + "\n",
    );
  });
  await act(async () => {
    await restored.result.current.recover(id);
  });
  expect(sent!).toMatchObject({
    request_id: id,
    session_id: "recover-session",
    profile_id: "a".repeat(32),
    action: "replay",
    after_sequence: 0,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(restored.result.current.snapshot.conversations).toHaveLength(1);
  expect(restored.result.current.snapshot.conversations[0]).toMatchObject({
    answer: "Recovered answer",
    status: "completed",
  });
  expect(
    restored.result.current.snapshot.conversations[0].issue,
  ).toBeUndefined();
});

it("preserves partial agent output and the issue when replay fails", async () => {
  const packet = (request_id: string) =>
    JSON.stringify({
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "response",
      request_id,
      response: {
        status: "pending",
        resumable: true,
        markdown: "Internal pending instruction",
        references: [],
        artifacts: [],
      },
    }) + "\n";
  const fetcher = vi.fn(
    async (_url, options) =>
      new Response(packet(JSON.parse(options.body).request_id)),
  );
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() =>
    useRemoteAgent("a".repeat(32), "partial-session", () => {}),
  );
  await act(async () => {
    await expect(hook.result.current.send("Q")).rejects.toThrow();
  });
  const turn = hook.result.current.snapshot.conversations[0];
  expect(turn.answer).toBe(""); // pending control copy is never an agent answer
  fetcher.mockResolvedValue(
    new Response(
      JSON.stringify({ kind: "transport_error", message: "Disconnected" }) +
        "\n",
    ),
  );
  await act(async () => {
    await expect(hook.result.current.recover(turn.id)).rejects.toThrow();
  });
  expect(hook.result.current.snapshot.conversations[0].issue).toBeDefined();
  expect(hook.result.current.snapshot.conversations[0].answer).toBe("");
});

it("keeps reviewed partial text through a failing recovery and never appends transport errors", async () => {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, options) => {
      const request_id = JSON.parse(options.body).request_id;
      const partial = {
        protocol: "ai-market-intelligence",
        version: "2.0",
        kind: "event",
        event: {
          event_id: "partial",
          sequence: 1,
          turn_id: request_id,
          type: "draft.upsert",
          block_id: "consolidated",
          text: "Reviewed partial answer",
          status: "completed",
          evidence_ids: [],
        },
      };
      const heartbeat = {
        protocol: "ai-market-intelligence",
        version: "2.0",
        kind: "heartbeat",
        request_id,
      };
      return new Response(
        [
          call++ ? heartbeat : partial,
          { kind: "transport_error", message: "raw transport failure" },
        ]
          .map((value) => JSON.stringify(value) + "\n")
          .join(""),
      );
    }),
  );
  const hook = renderHook(() =>
    useRemoteAgent("a".repeat(32), "real-partial", () => {}),
  );
  await act(async () => {
    await expect(hook.result.current.send("Q")).rejects.toThrow();
  });
  const id = hook.result.current.snapshot.conversations[0].id;
  expect(hook.result.current.snapshot.conversations[0].answer).toBe(
    "Reviewed partial answer",
  );
  await act(async () => {
    await expect(hook.result.current.recover(id)).rejects.toThrow();
  });
  expect(hook.result.current.snapshot.conversations[0].answer).toBe(
    "Reviewed partial answer",
  );
  expect(hook.result.current.snapshot.conversations[0].issue?.kind).toBe(
    "warning",
  );
});

it.each(["completed", "failed"])(
  "resolves an alias against the original identity, preserving a failed final issue (%s)",
  async (status) => {
    const snapshot = new SwarmEngine().snapshot();
    const issue = {
      message: "Interrupted",
      kind: "warning" as const,
      recoverable: true,
    };
    snapshot.conversations = [
      {
        id: "original",
        question: "Q",
        answer: "Partial",
        createdAt: 0,
        chunks: 0,
        status: "failed",
        issue,
      },
      {
        id: "alias",
        question: "Q",
        answer: "",
        createdAt: 1,
        chunks: 0,
        status: "failed",
        issue: { ...issue, requestId: "original" },
      },
    ];
    sessionStorage.setItem(
      "agent-desk.remote-chats",
      JSON.stringify({ version: 1, data: { aliasSession: snapshot } }),
    );
    const fetcher = vi.fn(async (_url, options) => {
      expect(JSON.parse(options.body).request_id).toBe("original");
      return new Response(
        JSON.stringify({
          protocol: "ai-market-intelligence",
          version: "2.0",
          kind: "response",
          request_id: "original",
          response: {
            status,
            markdown: status === "completed" ? "Recovered" : "",
            references: [],
            artifacts: [],
          },
        }) + "\n",
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const hook = renderHook(() =>
      useRemoteAgent("a".repeat(32), "aliasSession", () => {}),
    );
    await act(async () => {
      await hook.result.current.recover("alias");
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const turns = hook.result.current.snapshot.conversations;
    expect(turns).toHaveLength(2);
    if (status === "completed") {
      expect(turns[0].answer).toBe("Recovered");
      expect(turns.every((turn) => !turn.issue)).toBe(true);
    } else
      expect(turns.every((turn) => turn.issue?.kind === "error")).toBe(true);
  },
);

it("clears the old warning while recovering and shows a new TEST preparation failure", async () => {
  const snapshot = new SwarmEngine().snapshot();
  snapshot.conversations = [
    {
      id: "original",
      question: "Q",
      answer: "Partial",
      createdAt: 0,
      chunks: 0,
      status: "failed",
      issue: { message: "Disconnected", kind: "warning", recoverable: true },
    },
  ];
  sessionStorage.setItem(
    "agent-desk.remote-chats",
    JSON.stringify({ version: 1, data: { blocked: snapshot } }),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      await gate;
      return new Response(
        JSON.stringify({
          kind: "transport_error",
          code: "test_unavailable",
          message:
            "TEST no está activo. Actualízalo desde el proyecto del agente antes de probar.",
        }) + "\n",
      );
    }),
  );
  const hook = renderHook(() =>
    useRemoteAgent("a".repeat(32), "blocked", () => {}),
  );
  let recovery!: Promise<string | undefined>;
  act(() => {
    recovery = hook.result.current.recover("original");
  });
  expect(hook.result.current.snapshot.conversations[0].status).toBe("running");
  expect(hook.result.current.snapshot.conversations[0].issue).toBeUndefined();
  await act(async () => {
    release();
    await expect(recovery).rejects.toThrow("TEST no está activo");
  });
  expect(
    hook.result.current.snapshot.conversations[0].issue?.message,
  ).toContain("TEST no está activo");
  expect(hook.result.current.snapshot.conversations[0].answer).toBe("Partial");
});

it("recovers the explicitly chosen earlier request and clears the current notice without renaming response identities", async () => {
  const snapshot = new SwarmEngine().snapshot();
  const issue = {
    message: "Interrupted",
    kind: "warning" as const,
    recoverable: true,
  };
  snapshot.conversations = [
    {
      id: "original",
      question: "Same question",
      answer: "Partial",
      createdAt: 0,
      chunks: 0,
      status: "failed",
      issue,
    },
    {
      id: "unknown",
      question: "Same question",
      answer: "",
      createdAt: 1000,
      chunks: 0,
      status: "failed",
      issue,
    },
  ];
  sessionStorage.setItem(
    "agent-desk.remote-chats",
    JSON.stringify({ version: 1, data: { explicit: snapshot } }),
  );
  const fetcher = vi.fn(async (_url, options) => {
    const command = JSON.parse(options.body);
    expect(command.request_id).toBe("original");
    expect(command.action).toBe("replay");
    return new Response(
      JSON.stringify({
        protocol: "ai-market-intelligence",
        version: "2.0",
        kind: "response",
        request_id: "original",
        response: {
          status: "completed",
          markdown: "Stored original answer",
          references: [],
          artifacts: [],
        },
      }) + "\n",
    );
  });
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() =>
    useRemoteAgent("a".repeat(32), "explicit", () => {}),
  );
  await act(async () => {
    await hook.result.current.recover("original", "unknown");
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(hook.result.current.snapshot.conversations[0].answer).toBe(
    "Stored original answer",
  );
  expect(hook.result.current.snapshot.conversations[1].answer).toBe("");
  expect(
    hook.result.current.snapshot.conversations.every((turn) => !turn.issue),
  ).toBe(true);
});

it("keeps incompatible TEST output in a non-recoverable notice, never in the answer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            kind: "transport_error",
            code: "unsupported_output",
            message:
              "El agente TEST no entregó una respuesta en el formato esperado.",
          }) + "\n",
        ),
    ),
  );
  const hook = renderHook(() =>
    useRemoteAgent("a".repeat(32), "invalid-test", () => {}),
  );
  await act(async () => {
    await expect(hook.result.current.send("Question")).rejects.toThrow(
      "formato esperado",
    );
  });
  expect(hook.result.current.snapshot.conversations[0]).toMatchObject({
    answer: "",
    status: "failed",
    issue: {
      kind: "error",
      recoverable: false,
      message:
        "El agente TEST no entregó una respuesta en el formato esperado.",
    },
  });
});

it("forgets deleted remote chat data across reloads without sending an invocation", () => {
  const snapshot = new SwarmEngine().snapshot();
  sessionStorage.setItem(
    "agent-desk.remote-chats",
    JSON.stringify({
      version: 1,
      data: { deleted: snapshot, retained: snapshot },
    }),
  );
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() =>
    useRemoteAgent("a".repeat(32), "retained", () => {}),
  );
  act(() => {
    expect(hook.result.current.deleteConversation("deleted")).toBe(true);
  });
  expect(
    JSON.parse(sessionStorage.getItem("agent-desk.remote-chats")!).data.deleted,
  ).toBeUndefined();
  expect(
    JSON.parse(sessionStorage.getItem("agent-desk.remote-chats")!).data
      .retained,
  ).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});
