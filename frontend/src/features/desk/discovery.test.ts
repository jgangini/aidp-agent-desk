import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useDiscovery, type ConfigurationDraft } from "./discovery";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const draft: ConfigurationDraft = {
  profile: "DEFAULT",
  region: "region",
  has_credentials: true,
  compartment_id: "compartment",
  instance_id: "",
  workspace_id: "",
  agent_ids: [],
  transcription_model: "",
  speech_model: "",
  profiles: [],
};
const options = (warnings: string[]) => ({
  compartments: [{ id: "compartment", name: "Compartment" }],
  instances: [],
  workspaces: [],
  agents: [],
  transcription_models: [],
  speech_models: [],
  warnings,
});
const reply = (value: unknown, ok = true) => ({ ok, json: async () => value });

it("keeps restored catalog warnings private to each restore", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(reply(options(["Only the first catalog"])))
      .mockResolvedValueOnce(reply(options([])))
      .mockResolvedValueOnce(reply(options([])))
      .mockResolvedValueOnce(reply(options([]))),
  );
  const first = renderHook(() => useDiscovery({}, false));
  await act(() =>
    first.result.current.restore(draft, new AbortController().signal),
  );
  expect(first.result.current.warnings).toEqual(["Only the first catalog"]);
  first.unmount();
  const second = renderHook(() => useDiscovery({}, false));
  await act(() =>
    second.result.current.restore(draft, new AbortController().signal),
  );
  expect(second.result.current.warnings).toEqual([]);
  expect(second.result.current.options.compartments).toHaveLength(1);
});

it("preserves the verified partial catalog when a later stage fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(reply(options([])))
      .mockResolvedValueOnce(reply({ detail: "Resources unavailable" }, false)),
  );
  const hook = renderHook(() => useDiscovery({}, false));
  await act(() =>
    hook.result.current.restore(draft, new AbortController().signal),
  );
  expect(hook.result.current.options.compartments[0].id).toBe("compartment");
  expect(hook.result.current.selection.compartment_id).toBe("compartment");
  expect(hook.result.current.error).toBe("Resources unavailable");
});
