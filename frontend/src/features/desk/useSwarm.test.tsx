import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSwarm } from "./useSwarm";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useRealTimers();
});

it("changes the agent of an empty chat while preserving its conversation and draft", () => {
  vi.useFakeTimers();
  const { result } = renderHook(useSwarm);
  const first = result.current.selectedConversation;
  act(() => result.current.setDraft("Pregunta pendiente"));
  act(() => result.current.setAgent("test:profile"));
  expect(result.current.selectedConversation).toBe(first);
  expect(result.current.draft).toBe("Pregunta pendiente");
  expect(result.current.history[0].agentId).toBe("test:profile");
  act(() => result.current.setTitle("Pregunta enviada", "test:profile"));
  act(() => result.current.setAgent("demo"));
  expect(result.current.history[0].agentId).toBe("test:profile");
});

it("binds the restored TEST target on first send and preserves its draft when reopened", () => {
  vi.useFakeTimers();
  const { result } = renderHook(useSwarm);
  const first = result.current.selectedConversation;
  act(() => result.current.setDraft("Consulta pendiente"));
  act(() => result.current.setTitle("Primera consulta TEST", "test:profile"));
  expect(result.current.history).toEqual([
    { id: first, title: "Primera consulta TEST", agentId: "test:profile" },
  ]);
  expect(result.current.draft).toBe("Consulta pendiente");
  act(() => result.current.setTitle("Segundo mensaje", "another-profile"));
  expect(result.current.history[0].agentId).toBe("test:profile");
  act(() => result.current.newConversation("demo"));
  expect(result.current.selectedConversation).not.toBe(first);
  act(() => result.current.selectConversation(first));
  expect(result.current.selectedConversation).toBe(first);
  expect(
    result.current.history.find((item) => item.id === first)?.agentId,
  ).toBe("test:profile");
  expect(result.current.draft).toBe("Consulta pendiente");
});

it("restores the selected chat, TEST destination, history and drafts after remount", () => {
  const first = renderHook(useSwarm);
  const id = first.result.current.selectedConversation;
  act(() => first.result.current.setTitle("Consulta TEST", "test:profile"));
  act(() => first.result.current.setDraft("Borrador TEST"));
  act(() => first.result.current.newConversation("demo"));
  act(() => first.result.current.setDraft("Otro borrador"));
  act(() => first.result.current.selectConversation(id));
  first.unmount();
  const restored = renderHook(useSwarm);
  expect(restored.result.current.selectedConversation).toBe(id);
  expect(restored.result.current.restoredAgent).toBe("test:profile");
  expect(restored.result.current.draft).toBe("Borrador TEST");
  expect(restored.result.current.history).toHaveLength(2);
});

it("flushes a running demo on pagehide and resumes its actual engine state", () => {
  vi.useFakeTimers();
  const first = renderHook(useSwarm);
  act(() =>
    first.result.current.act((engine) => engine.inject("Demo guardada")),
  );
  act(() => first.result.current.act((engine) => engine.advance(3000)));
  act(() => window.dispatchEvent(new Event("pagehide")));
  const snapshot = first.result.current.snapshot;
  first.unmount();
  const restored = renderHook(useSwarm);
  expect(restored.result.current.snapshot).toEqual(snapshot);
  act(() => restored.result.current.act((engine) => engine.advance(20000)));
  expect(restored.result.current.snapshot.conversations[0].status).toBe(
    "completed",
  );
  act(() =>
    restored.result.current.act((engine) => engine.inject("Siguiente")),
  );
  const tasks = restored.result.current.snapshot.tasks;
  expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length);
});

it("keeps healthy history when the previously selected checkpoint is corrupt", () => {
  const first = renderHook(useSwarm);
  const healthyId = first.result.current.selectedConversation;
  act(() => first.result.current.setTitle("Conservar", "test:profile"));
  act(() => first.result.current.newConversation("demo"));
  first.unmount();
  const saved = JSON.parse(sessionStorage.getItem("agent-desk.chats")!);
  saved.data.sessions[1].engine = {};
  sessionStorage.setItem("agent-desk.chats", JSON.stringify(saved));
  const restored = renderHook(useSwarm);
  expect(restored.result.current.selectedConversation).toBe(healthyId);
  expect(restored.result.current.restoredAgent).toBe("test:profile");
  expect(restored.result.current.history[0].title).toBe("Conservar");
});
