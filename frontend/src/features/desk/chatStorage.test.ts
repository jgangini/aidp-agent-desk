import { afterEach, expect, it, vi } from "vitest";
import {
  readChatStorage,
  writeChatStorage,
  hasChatStorageFailure,
  subscribeChatStorage,
} from "./chatStorage";
import { isSnapshot } from "./snapshot";
import { SwarmEngine } from "./engine";

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  writeChatStorage("chats", {});
  writeChatStorage("quota-test", {});
});

it("notifies once on oversized or quota-failed writes, retains the checkpoint and clears only after saving", () => {
  const listener = vi.fn();
  const unsubscribe = subscribeChatStorage(listener);
  expect(writeChatStorage("quota-test", "last saved")).toBe(true);
  expect(writeChatStorage("quota-test", "x".repeat(4_000_001))).toBe(false);
  expect(hasChatStorageFailure()).toBe(true);
  expect(readChatStorage("quota-test")).toBe("last saved");
  expect(writeChatStorage("quota-test", "x".repeat(4_000_001))).toBe(false);
  expect(listener).toHaveBeenCalledTimes(1);
  const setter = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
  expect(writeChatStorage("quota-test", "new")).toBe(false);
  setter.mockRestore();
  expect(writeChatStorage("quota-test", "saved again")).toBe(true);
  expect(hasChatStorageFailure()).toBe(false);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
});

it("rejects corrupt, unsupported and oversized records without throwing", () => {
  for (const raw of ["{", '{"version":2,"data":{}}', " ".repeat(4_000_001)]) {
    sessionStorage.setItem("agent-desk.chats", raw);
    expect(readChatStorage("chats")).toBeUndefined();
  }
  expect(isSnapshot({ conversations: [] })).toBe(false);
  const snapshot = new SwarmEngine().snapshot();
  expect(isSnapshot({ ...snapshot, findings: [{ source: "__proto__" }] })).toBe(
    false,
  );
  expect(isSnapshot({ ...snapshot, time: -1 })).toBe(false);
});

it("tolerates blocked storage and quota failures while preserving the last saved entry", () => {
  writeChatStorage("chats", { selected: "first" });
  const setter = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("Quota", "QuotaExceededError");
    });
  expect(() => writeChatStorage("chats", { selected: "second" })).not.toThrow();
  setter.mockRestore();
  expect(readChatStorage("chats")).toEqual({ selected: "first" });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  expect(readChatStorage("chats")).toBeUndefined();
});

it("validates saved media again before restoring a remote snapshot", () => {
  const snapshot = new SwarmEngine().snapshot();
  snapshot.findings.push({
    id: "f",
    requestId: "r",
    source: "youtube",
    title: "Post",
    text: "Texto",
    at: 0,
    references: [
      {
        evidence_id: "e",
        url: "https://example.org/post",
        media: [
          {
            kind: "image",
            delivery: "direct",
            role: "thumbnail",
            url: "https://127.0.0.1/private",
          },
        ],
      },
    ],
  });
  expect(isSnapshot(snapshot)).toBe(false);
});

it("roundtrips the pending mailbox and rejects broken engine references or counters", () => {
  const engine = new SwarmEngine();
  engine.inject("Demo");
  engine.advance(2200);
  const checkpoint = engine.checkpoint();
  const restored = SwarmEngine.restore(JSON.parse(JSON.stringify(checkpoint)))!;
  engine.advance(300);
  restored.advance(300);
  expect(restored.snapshot()).toEqual(engine.snapshot());
  expect(SwarmEngine.restore({ ...checkpoint, serial: 0 })).toBeUndefined();
  const unassigned = structuredClone(checkpoint);
  delete unassigned.state.tasks.find((task) => task.status === "running")!
    .worker;
  expect(SwarmEngine.restore(unassigned)).toBeUndefined();
  checkpoint.state.agents[0].queue.push("missing-task");
  expect(SwarmEngine.restore(checkpoint)).toBeUndefined();
});

it("separates only known legacy error suffixes without deleting partial or completed answers", async () => {
  const { separateLegacyIssues } = await import("./snapshot");
  const snapshot = new SwarmEngine().snapshot();
  const base = {
    id: "legacy",
    question: "Q",
    createdAt: 0,
    chunks: 0,
    status: "failed" as const,
  };
  snapshot.conversations = [
    { ...base, answer: "Partial answer\n\nnetwork error" },
    { ...base, id: "whole", answer: "network error" },
    { ...base, id: "legitimate", status: "completed", answer: "network error" },
    { ...base, id: "unknown", answer: "Something like network error" },
    {
      ...base,
      id: "wrapper",
      status: "completed",
      answer: "Agent invocation failed.",
    },
    {
      ...base,
      id: "quoted",
      status: "completed",
      answer: 'El mensaje fue "Agent invocation failed."',
    },
  ];
  const turns = separateLegacyIssues(snapshot).conversations;
  expect(turns[0].answer).toBe("Partial answer");
  expect(turns[0].issue?.recoverable).toBe(true);
  expect(turns[1].answer).toBe("");
  expect(turns[2].issue).toBeUndefined();
  expect(turns[3].answer).toBe("Something like network error");
  expect(turns[3].issue).toBeUndefined();
  expect(turns[4]).toMatchObject({
    answer: "",
    status: "failed",
    issue: { kind: "error", recoverable: false },
  });
  expect(turns[5].issue).toBeUndefined();
});
