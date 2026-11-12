import { record } from "../../shared/record";
import { useCallback, useEffect, useRef, useState } from "react";
import { SwarmEngine } from "./engine";
import { readChatStorage, writeChatStorage } from "./chatStorage";

function createSession(agentId: string) {
  return {
    id: crypto.randomUUID(),
    agentId,
    title: "",
    draft: "",
    engine: new SwarmEngine(),
  };
}

function restoreSessions() {
  const saved = readChatStorage("chats");
  if (record(saved) && Array.isArray(saved.sessions)) {
    const sessions = saved.sessions.flatMap((item: unknown) => {
      if (
        !record(item) ||
        typeof item.id !== "string" ||
        !item.id ||
        typeof item.agentId !== "string" ||
        !item.agentId ||
        typeof item.title !== "string" ||
        typeof item.draft !== "string"
      )
        return [];
      const engine = SwarmEngine.restore(item.engine);
      return engine
        ? [
            {
              id: item.id,
              agentId: item.agentId,
              title: item.title,
              draft: item.draft,
              engine,
            },
          ]
        : [];
    });
    const active =
      sessions.find((item) => item.id === saved.selected) ?? sessions[0];
    if (
      active &&
      new Set(sessions.map((item) => item.id)).size === sessions.length
    )
      return { sessions, selected: active.id, restoredAgent: active.agentId };
  }
  const initial = createSession("demo");
  return {
    sessions: [initial],
    selected: initial.id,
    restoredAgent: undefined,
  };
}

export function useSwarm() {
  const [initial] = useState(restoreSessions);
  const [sessions, setSessions] = useState(initial.sessions);
  const [selected, setSelected] = useState(initial.selected);
  const active = sessions.find((session) => session.id === selected)!;
  const engine = active.engine;
  const [snapshot, setSnapshot] = useEngineSnapshot(engine);
  useEffect(() => {
    const save = () =>
      writeChatStorage("chats", {
        selected,
        sessions: sessions.map((item) => ({
          ...item,
          engine: item.engine.checkpoint(),
        })),
      });
    save();
    const timer = window.setInterval(save, 1000);
    window.addEventListener("pagehide", save);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", save);
    };
  }, [sessions, selected]);
  const act = (action: (engine: SwarmEngine) => void) => {
    action(engine);
    const next = engine.snapshot();
    setSnapshot(next);
    const title = next.conversations[0]?.question;
    if (!active.title && title)
      setSessions((items) =>
        items.map((item) => (item.id === selected ? { ...item, title } : item)),
      );
  };
  const reset = () => {
    const next = createSession(active.agentId);
    setSessions((items) => [
      ...items.filter((item) => item.id !== selected),
      next,
    ]);
    setSelected(next.id);
    setSnapshot(next.engine.snapshot());
  };
  const newConversation = (agentId: string) => {
    const next = createSession(agentId);
    setSessions((items) => [
      ...items.filter(
        (item) => item.id !== selected || item.title || item.draft,
      ),
      next,
    ]);
    setSelected(next.id);
    setSnapshot(next.engine.snapshot());
  };
  const selectConversation = (id: string) => {
    const next = sessions.find((item) => item.id === id);
    if (!next) return;
    setSelected(id);
    setSnapshot(next.engine.snapshot());
  };
  const setDraft = useCallback(
    (draft: string) => {
      setSessions((items) => {
        if (items.find((item) => item.id === selected)?.draft === draft)
          return items;
        return items.map((item) =>
          item.id === selected ? { ...item, draft } : item,
        );
      });
    },
    [selected],
  );
  return {
    snapshot,
    act,
    reset,
    newConversation,
    selectConversation,
    deleteConversation: (id: string) => {
      if (!sessions.some((item) => item.id === id)) return;
      if (id === selected) {
        const next = createSession(active.agentId);
        setSessions((items) => [
          ...items.filter((item) => item.id !== id),
          next,
        ]);
        setSelected(next.id);
        setSnapshot(next.engine.snapshot());
      } else setSessions((items) => items.filter((item) => item.id !== id));
    },
    selectedConversation: selected,
    restoredAgent: initial.restoredAgent,
    draft: active.draft,
    setDraft,
    setAgent: useCallback(
      (agentId: string) =>
        setSessions((items) =>
          items.map((item) =>
            item.id === selected && !item.title && item.agentId !== agentId
              ? { ...item, agentId }
              : item,
          ),
        ),
      [selected],
    ),
    renameConversation: (title: string) => {
      const name = title.trim();
      if (!name) return;
      setSessions((items) =>
        items.map((item) =>
          item.id === selected ? { ...item, title: name } : item,
        ),
      );
    },
    setTitle: (title: string, agentId?: string) =>
      setSessions((items) =>
        items.map((item) =>
          item.id === selected && !item.title
            ? { ...item, title, agentId: agentId ?? item.agentId }
            : item,
        ),
      ),
    history: sessions
      .filter((item) => item.title || item.draft)
      .map(({ id, title, agentId, draft }) => ({
        id,
        title: title || `Borrador · ${draft}`,
        agentId,
      })),
  };
}

function useEngineSnapshot(engine: SwarmEngine) {
  const [snapshot, setSnapshot] = useState(() => engine.snapshot());
  const elapsed = useRef(performance.now());
  useEffect(() => {
    elapsed.current = performance.now();
    setSnapshot(engine.snapshot());
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = now - elapsed.current;
      elapsed.current = now;
      if (delta >= 0) engine.advance(Math.min(100, delta));
      setSnapshot(engine.snapshot());
    }, 50);
    return () => clearInterval(timer);
  }, [engine]);
  return [snapshot, setSnapshot] as const;
}
