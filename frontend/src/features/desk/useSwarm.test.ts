import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSwarm } from "./useSwarm";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.useRealTimers();
});

it("renames only the active chat, persists the title and keeps questions and later titles independent", () => {
  const hook = renderHook(useSwarm);
  act(() =>
    hook.result.current.act((engine) => engine.inject("Pregunta original")),
  );
  const first = hook.result.current.selectedConversation;
  act(() => hook.result.current.newConversation("remote"));
  act(() => hook.result.current.setTitle("Otro chat", "remote"));
  act(() => hook.result.current.selectConversation(first));
  act(() => hook.result.current.renameConversation("  Nombre editado  "));
  act(() => hook.result.current.renameConversation("  "));
  act(() => hook.result.current.setTitle("Una pregunta posterior"));
  expect(hook.result.current.history.map((item) => item.title)).toEqual([
    "Nombre editado",
    "Otro chat",
  ]);
  expect(hook.result.current.snapshot.conversations[0].question).toBe(
    "Pregunta original",
  );
  hook.unmount();
  const restored = renderHook(useSwarm);
  expect(restored.result.current.history.map((item) => item.title)).toEqual([
    "Nombre editado",
    "Otro chat",
  ]);
});

it("resynchronizes a reset frame clock without passing negative time to the engine", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const now = vi.spyOn(performance, "now").mockReturnValue(100);
  try {
    const { result } = renderHook(useSwarm);
    now.mockReturnValue(90);
    expect(() => act(() => vi.advanceTimersByTime(50))).not.toThrow();
    expect(result.current.snapshot.time).toBe(0);
    now.mockReturnValue(115);
    act(() => vi.advanceTimersByTime(50));
    expect(result.current.snapshot.time).toBe(25);
  } finally {
    now.mockRestore();
  }
});

it("restores messages, results and clock without advancing hidden conversations", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  const { result } = renderHook(useSwarm);
  const first = result.current.selectedConversation;
  act(() =>
    result.current.act((engine) => {
      engine.inject("Primera investigación");
    }),
  );
  act(() => vi.advanceTimersByTime(3000));
  const firstTime = result.current.snapshot.time;
  const firstFindings = result.current.snapshot.findings;
  act(() => result.current.setDraft("Borrador de la primera"));
  act(() => result.current.newConversation("saved-agent"));
  const second = result.current.selectedConversation;
  expect(result.current.snapshot.conversations).toHaveLength(0);
  act(() =>
    result.current.act((engine) => {
      engine.inject("Segunda investigación");
    }),
  );
  act(() => vi.advanceTimersByTime(1000));
  const secondTime = result.current.snapshot.time;
  expect(result.current.history.map((item) => item.title)).toEqual([
    "Primera investigación",
    "Segunda investigación",
  ]);
  expect(result.current.history[1].agentId).toBe("saved-agent");
  act(() => result.current.selectConversation(first));
  expect(result.current.snapshot.time).toBe(firstTime);
  expect(result.current.draft).toBe("Borrador de la primera");
  expect(result.current.snapshot.findings).toEqual(firstFindings);
  expect(result.current.snapshot.conversations[0].question).toBe(
    "Primera investigación",
  );
  act(() => vi.advanceTimersByTime(500));
  act(() => result.current.selectConversation(second));
  expect(result.current.snapshot.time).toBe(secondTime);
  expect(result.current.snapshot.conversations[0].question).toBe(
    "Segunda investigación",
  );
  act(() => result.current.reset());
  expect(result.current.snapshot.conversations).toHaveLength(0);
  expect(result.current.history.map((item) => item.id)).toEqual([first]);
});

it("deletes only the selected history entry and persists an empty replacement when deleting the active chat", () => {
  const hook = renderHook(useSwarm);
  const first = hook.result.current.selectedConversation;
  act(() => hook.result.current.setTitle("First"));
  act(() => hook.result.current.newConversation("demo"));
  const second = hook.result.current.selectedConversation;
  act(() => hook.result.current.setTitle("Second"));
  act(() => hook.result.current.deleteConversation(first));
  expect(hook.result.current.history.map((item) => item.id)).toEqual([second]);
  expect(hook.result.current.selectedConversation).toBe(second);
  act(() => hook.result.current.deleteConversation(second));
  expect(hook.result.current.history).toEqual([]);
  expect(hook.result.current.selectedConversation).not.toBe(second);
  hook.unmount();
  const restored = renderHook(useSwarm);
  expect(restored.result.current.history).toEqual([]);
});
