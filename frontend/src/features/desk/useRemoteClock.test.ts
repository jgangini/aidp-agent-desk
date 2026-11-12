import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRemoteAgent } from "./useRemoteAgent";
import { streamRemoteTurn, confirmRemoteCancellation } from "./remoteAgent";

vi.mock("./remoteAgent", async (original) => ({
  ...(await original<typeof import("./remoteAgent")>()),
  streamRemoteTurn: vi.fn(),
  confirmRemoteCancellation: vi.fn(),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(["failure", "cancel"])(
  "ticks between remote packets and freezes on %s",
  async (ending) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
    const intervals = vi.spyOn(window, "setInterval");
    const clearInterval = vi.spyOn(window, "clearInterval");
    let fail!: (error: Error) => void;
    vi.mocked(streamRemoteTurn).mockImplementation(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          fail = reject;
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    vi.mocked(confirmRemoteCancellation).mockResolvedValue(undefined);
    const hook = renderHook(() =>
      useRemoteAgent("remote", "clock-test", vi.fn()),
    );
    let request!: Promise<unknown>;
    act(() => {
      request = hook.result.current.send("Test clock").catch(() => undefined);
    });
    const created = hook.result.current.snapshot.conversations[0].createdAt;
    const persisted = sessionStorage.getItem("agent-desk.remote-chats");
    act(() => vi.advanceTimersByTime(5000));
    expect(hook.result.current.snapshot.time - created).toBe(5000);
    expect(sessionStorage.getItem("agent-desk.remote-chats")).toBe(persisted);
    await act(async () => {
      if (ending === "cancel") await hook.result.current.cancel();
      else fail(new Error("connection lost"));
      await request;
    });
    const completed = hook.result.current.snapshot.conversations[0].completedAt;
    expect(completed).toBe(created + 5000);
    expect(clearInterval).toHaveBeenCalledWith(intervals.mock.results[0].value);
    act(() => vi.advanceTimersByTime(5000));
    expect(hook.result.current.snapshot.conversations[0].completedAt).toBe(
      completed,
    );
  },
);
