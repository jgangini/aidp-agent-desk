import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useChatNotice } from "./useChatNotice";
afterEach(cleanup);

it("clears a configuration warning on composer edits but preserves genuine errors", () => {
  const { result } = renderHook(() => useChatNotice("agent", "chat", false));
  act(() => result.current.warning("Configure audio"));
  expect(result.current.notice?.kind).toBe("warning");
  act(() => result.current.clearWarning());
  expect(result.current.notice).toBeUndefined();
  act(() => result.current.error("Transport failed"));
  act(() => result.current.clearWarning());
  expect(result.current.notice).toEqual({
    kind: "error",
    message: "Transport failed",
  });
  act(() => result.current.clear());
  expect(result.current.notice).toBeUndefined();
});

it.each(["agent", "conversation", "configuring"] as const)(
  "clears notices and rejects delayed callbacks after changing %s",
  (field) => {
    const initial = {
      agent: "first",
      conversation: "chat",
      configuring: false,
    };
    const { result, rerender } = renderHook(
      (props) =>
        useChatNotice(props.agent, props.conversation, props.configuring),
      { initialProps: initial },
    );
    const previous = result.current;
    act(() => previous.warning("Configure audio"));
    rerender({ ...initial, [field]: field === "configuring" ? true : "other" });
    expect(result.current.notice).toBeUndefined();
    act(() => {
      previous.warning("Late warning");
      previous.error("Late failure");
    });
    expect(result.current.notice).toBeUndefined();
    expect(previous.isCurrent()).toBe(false);
    rerender(initial);
    act(() => previous.warning("Old context revisited"));
    expect(result.current.notice).toBeUndefined();
  },
);
