// @vitest-environment jsdom
import { cleanup, renderHook, waitFor, act } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useProfiles } from "./profiles";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const catalog = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "saved-flow", name: "Published flow" }],
    }),
  );

it("uses the saved flow instead of silently defaulting to simulation", async () => {
  catalog();
  const first = renderHook(useProfiles);
  await waitFor(() => expect(first.result.current.selected).toBe("saved-flow"));
  first.unmount();
  const reloaded = renderHook(useProfiles);
  await waitFor(() =>
    expect(reloaded.result.current.active?.id).toBe("saved-flow"),
  );
});

it("preserves an explicit choice of demonstration across reloads", async () => {
  catalog();
  const first = renderHook(useProfiles);
  await waitFor(() => expect(first.result.current.selected).toBe("saved-flow"));
  act(() => first.result.current.setSelected("demo"));
  first.unmount();
  const reloaded = renderHook(useProfiles);
  await waitFor(() => expect(reloaded.result.current.profiles).toHaveLength(1));
  expect(reloaded.result.current.selected).toBe("demo");
});

it("keeps a restored chat's target ahead of another tab's preference or a missing profile", async () => {
  catalog();
  localStorage.setItem("agent-desk.selected-profile", "demo");
  const restored = renderHook(() => useProfiles("test:missing-profile"));
  await waitFor(() => expect(restored.result.current.profiles).toHaveLength(1));
  expect(restored.result.current.selected).toBe("test:missing-profile");
  expect(restored.result.current.active).toBeUndefined();
});
