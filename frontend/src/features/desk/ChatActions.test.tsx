import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ResponseActions } from "./ChatActions";
import { ChatActionsContext } from "./chatContext";
import type { Snapshot } from "./types";

vi.mock("@assistant-ui/react", () => ({
  ActionBarPrimitive: {
    Root: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Copy: () => null,
    Speak: () => null,
    StopSpeaking: () => null,
  },
  AuiIf: () => null,
  useAuiState: (select: (value: unknown) => unknown) =>
    select({ message: { id: "session:turn-assistant", isLast: true } }),
}));
afterEach(cleanup);

it("dispatches feedback and regeneration by conversation identity without owning an engine", () => {
  const snapshot: Snapshot = {
    time: 100,
    playing: true,
    speed: 1,
    agents: [],
    tasks: [],
    events: [],
    findings: [],
    failures: 0,
    revision: 1,
    conversations: [
      {
        id: "turn",
        question: "Research",
        answer: "Answer",
        createdAt: 0,
        completedAt: 100,
        chunks: 1,
        status: "completed",
      },
    ],
  };
  const onFeedback = vi.fn();
  const onRegenerate = vi.fn();
  const value = {
    snapshot,
    messagePrefix: "session:",
    onFeedback,
    onRegenerate,
  };
  const { rerender } = render(
    <ChatActionsContext.Provider value={value}>
      <ResponseActions />
    </ChatActionsContext.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Respuesta útil" }));
  fireEvent.click(screen.getByRole("button", { name: "Respuesta no útil" }));
  fireEvent.click(screen.getByRole("button", { name: "Regenerar respuesta" }));
  expect(onFeedback.mock.calls).toEqual([
    ["turn", "positive"],
    ["turn", "negative"],
  ]);
  expect(onRegenerate).toHaveBeenCalledExactlyOnceWith("turn", "Research");
  rerender(
    <ChatActionsContext.Provider
      value={{
        ...value,
        snapshot: {
          ...snapshot,
          conversations: snapshot.conversations.map((turn) => ({
            ...turn,
            status: "running",
          })),
        },
      }}
    >
      <ResponseActions />
    </ChatActionsContext.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Regenerar respuesta" }));
  expect(onRegenerate).toHaveBeenCalledTimes(1);
});
