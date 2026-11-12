import type { ReactNode } from "react";
import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Chat } from "./Chat";
import { SwarmEngine } from "./engine";
import { writeChatStorage } from "./chatStorage";


const feedback = vi.hoisted(() => ({
  notice: undefined as
    { kind: "warning" | "error"; message: string } | undefined,
  error: vi.fn(),
  warning: vi.fn(),
  clear: vi.fn(),
  clearWarning: vi.fn(),
  isCurrent: () => true,
}));
vi.mock("./useChatNotice", () => ({ useChatNotice: () => feedback }));
vi.mock("./suggestions", () => ({ useSuggestions: () => [] }));
vi.mock("voice-glow", () => ({
  VoiceBeam: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  feedback.notice = undefined;
  writeChatStorage("notice-test", {});
});

it("warns above the composer when the live history cannot be saved and clears on successful save", () => {
  const { container } = render(
    <Chat
      snapshot={new SwarmEngine().snapshot()}
      act={() => {}}
      reset={() => {}}
      agentName="Demo"
    />,
  );
  act(() => {
    writeChatStorage("notice-test", "x".repeat(4_000_001));
  });
  const notice = screen.getByRole("status");
  expect(notice.textContent).toContain("antes de recargar");
  expect(notice.nextElementSibling).toBe(
    container.querySelector(".aui-composer-root"),
  );
  act(() => {
    writeChatStorage("notice-test", {});
  });
  expect(screen.queryByText(/No se pudieron guardar/)).toBeNull();
});

it.each([
  { kind: "warning", role: "status", modifier: "chat-audio-warning" },
  { kind: "error", role: "alert", modifier: "chat-error-notice" },
] as const)(
  "places the framed $kind notice directly above the real composer with its accessible severity",
  ({ kind, role, modifier }) => {
    feedback.notice = { kind, message: "Message from the current request" };
    const { container } = render(
      <Chat
        snapshot={new SwarmEngine().snapshot()}
        act={() => {}}
        reset={() => {}}
        agentName="Demo"
      />,
    );
    const notice = screen.getByRole(role);
    const composer = container.querySelector(".aui-composer-root")!;
    expect(notice.textContent).toBe(feedback.notice.message);
    expect(notice.classList.contains("chat-notice")).toBe(true);
    expect(notice.classList.contains(modifier)).toBe(true);
    expect(notice.nextElementSibling).toBe(composer);
    expect(
      notice.querySelector('svg.lucide-triangle-alert[aria-hidden="true"]'),
    ).not.toBeNull();
    expect(composer.querySelector(".chat-notice")).toBeNull();
  },
);

it("shows one persisted issue above composer, hides empty failed assistant actions and recovers explicitly", async () => {
  feedback.notice = { kind: "error", message: "Duplicate transient message" };
  const snapshot = new SwarmEngine().snapshot();
  snapshot.conversations = [
    {
      id: "failed",
      question: "Question",
      answer: "",
      createdAt: 0,
      chunks: 0,
      status: "failed",
      issue: {
        message: "Connection interrupted",
        kind: "warning",
        recoverable: true,
      },
    },
  ];
  const recover = vi.fn().mockResolvedValue("Recovered");
  const { container } = render(
    <Chat
      snapshot={snapshot}
      act={() => {}}
      reset={() => {}}
      agentName="Remote"
      onRecover={recover}
    />,
  );
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.queryByText("Duplicate transient message")).toBeNull();
  expect(container.querySelector(".aui-assistant-message")).toBeNull();
  expect(screen.getByRole("status").nextElementSibling).toBe(
    container.querySelector(".aui-composer-root"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Recuperar respuesta" }));
  expect(recover).toHaveBeenCalledWith("failed");
});

it("never fabricates an assistant response for an empty failed turn after its issue is resolved", () => {
  const snapshot = new SwarmEngine().snapshot();
  snapshot.conversations = [
    {
      id: "resolved-alias",
      question: "Repeated question",
      answer: "",
      createdAt: 0,
      chunks: 0,
      status: "failed",
    },
  ];
  const { container } = render(
    <Chat
      snapshot={snapshot}
      act={() => {}}
      reset={() => {}}
      agentName="Remote"
    />,
  );
  expect(container.querySelector(".aui-assistant-message")).toBeNull();
  expect(screen.queryByText("No se pudo completar la consulta.")).toBeNull();
  expect(screen.getByText("Repeated question")).toBeDefined();
});

it("keeps only the refresh action when several interrupted attempts exist", () => {
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
      answer: "",
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
  const recover = vi.fn().mockResolvedValue("Recovered");
  render(
    <Chat
      snapshot={snapshot}
      act={() => {}}
      reset={() => {}}
      agentName="Remote"
      onRecover={recover}
    />,
  );
  expect(recover).not.toHaveBeenCalled();
  expect(screen.queryByText("Recuperar otro intento interrumpido")).toBeNull();
  expect(screen.queryByRole("button", { name: /Intento 1/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Recuperar respuesta" }));
  expect(recover).toHaveBeenCalledWith("unknown");
});

it("shows source fragments inside the open process, then folds it for the streaming final answer", () => {
  const snapshot = new SwarmEngine().snapshot();
  snapshot.conversations = [
    {
      id: "stream-phase",
      question: "Q",
      answer: "",
      createdAt: 0,
      chunks: 0,
      status: "running",
    },
  ];
  snapshot.events = [
    {
      id: 1,
      at: 1,
      type: "source.streaming",
      text: "First source fragment",
      source: "web",
      from: "agent",
      to: "desk",
      requestId: "stream-phase",
    },
  ];
  const props = { act: () => {}, reset: () => {}, agentName: "Remote" };
  const { container, rerender } = render(
    <Chat {...props} snapshot={snapshot} />,
  );
  expect(container.querySelector(".tool-progress")?.hasAttribute("open")).toBe(
    true,
  );
  expect(container.querySelector(".tool-progress")?.textContent).toContain(
    "First source fragment",
  );
  expect(
    container.querySelector(".answer-text > .markdown-text")?.textContent ?? "",
  ).toBe("");
  const more = {
    ...snapshot,
    revision: 1,
    events: [{ ...snapshot.events[0], text: "First source fragment extended" }],
  };
  rerender(<Chat {...props} snapshot={more} />);
  expect(container.querySelector(".tool-progress")?.textContent).toContain(
    "First source fragment extended",
  );
  const synthesis = {
    ...more,
    revision: 2,
    conversations: [{ ...snapshot.conversations[0], answer: "Final fragment" }],
  };
  rerender(<Chat {...props} snapshot={synthesis} />);
  expect(container.querySelector(".tool-progress")?.hasAttribute("open")).toBe(
    false,
  );
  expect(
    container.querySelector(".answer-text > .markdown-text")?.textContent,
  ).toBe("Final fragment");
  expect(screen.getByRole("button", { name: "Detener consulta" })).toBeTruthy();
});

it("shows the selected conversation title and retains the empty-chat fallback", () => {
  const props = {
    snapshot: new SwarmEngine().snapshot(),
    act: () => {},
    reset: () => {},
    agentName: "Demo",
    history: [{ id: "saved", title: "Consulta guardada" }],
  };
  const { rerender } = render(<Chat {...props} selectedConversation="saved" />);
  expect(
    screen.getByRole("heading", { name: "Consulta guardada" }),
  ).toBeTruthy();
  rerender(<Chat {...props} selectedConversation="empty" />);
  expect(screen.getByRole("heading", { name: "Nuevo Chat" })).toBeTruthy();
});
