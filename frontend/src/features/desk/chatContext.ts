import { createContext } from "react";
import type { Snapshot } from "./types";
import type { VoiceSignal } from "./voice";

export const ChatActionsContext = createContext<{
  snapshot: Snapshot;
  voice?: VoiceSignal;
  messagePrefix?: string;
  initialMessageIds?: ReadonlySet<string>;
  onFeedback: (id: string, feedback: "positive" | "negative") => void;
  onRegenerate: (id: string, question: string) => void;
} | null>(null);
