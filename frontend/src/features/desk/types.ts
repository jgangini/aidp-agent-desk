import type { TokenUsage } from "./chatMetrics";
import type { Reference } from "./publicManifest";
export type Role = "research" | "social" | "analysis" | "writing";
export type Source =
  | "web"
  | "facebook"
  | "instagram"
  | "youtube"
  | "x"
  | "yahoo_finance"
  | "analysis"
  | "desk";
export type TaskStatus =
  | "waiting"
  | "queued"
  | "running"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";
export interface Agent {
  id: string;
  name: string;
  role: Role;
  online: boolean;
  queue: string[];
  current?: string;
  completed: number;
  history: SimEvent[];
}
export interface Task {
  id: string;
  requestId: string;
  title: string;
  role: Role;
  source: Source;
  dependencies: string[];
  status: TaskStatus;
  duration: number;
  remaining: number;
  attempts: number;
  maxAttempts: number;
  readyAt: number;
  worker?: string;
  failAttempts: number;
  output: string;
  emitted: number;
}
export interface SimEvent {
  presentation?: import("./presentation").Presentation;
  sourceLabel?: string;
  id: number;
  at: number;
  type: string;
  text: string;
  from: string;
  to: string;
  taskId?: string;
  requestId?: string;
  source?: Source;
}
export interface Finding {
  sourceLabel?: string;
  id: string;
  requestId: string;
  source: Source;
  title: string;
  text: string;
  at: number;
  references?: Reference[];
  remote?: boolean;
  artifact?: import("./publicManifest").Artifact;
}
export interface TurnIssue {
  message: string;
  kind: "warning" | "error";
  recoverable: boolean;
  requestId?: string;
}
export interface Conversation {
  contentItems?: import("./contentItems").ContentItems;
  contentReferences?: Reference[];
  contentHistory?: import("./contentItems").ContentItem[];
  issue?: TurnIssue;
  id: string;
  question: string;
  answer: string;
  createdAt: number;
  firstChunkAt?: number;
  completedAt?: number;
  chunks: number;
  feedback?: "positive" | "negative";
  usage?: TokenUsage;
  status: "running" | "completed" | "failed" | "cancelled";
}
export interface Snapshot {
  time: number;
  playing: boolean;
  speed: number;
  agents: Agent[];
  tasks: Task[];
  events: SimEvent[];
  findings: Finding[];
  conversations: Conversation[];
  failures: number;
  revision: number;
}
export const roleLabels: Record<Role, string> = {
  research: "Investigación",
  social: "Redes sociales",
  analysis: "Análisis",
  writing: "Síntesis",
};
export const sourceLabels: Record<Source, string> = {
  web: "Web",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
  yahoo_finance: "Yahoo Finance",
  analysis: "Análisis",
  desk: "Agent Desk",
};
