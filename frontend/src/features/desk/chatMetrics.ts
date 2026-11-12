export interface TokenUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  contextTokens?: number;
  contextWindow?: number;
}

export function formatWorkDuration(milliseconds: number) {
  const seconds = Number.isFinite(milliseconds)
    ? Math.floor(Math.max(0, milliseconds) / 1000)
    : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return hours
    ? `${hours}h ${minutes}m ${seconds % 60}s`
    : minutes
      ? `${minutes}m ${seconds % 60}s`
      : `${seconds}s`;
}

export const tokenCount = (value?: number) =>
  value === undefined || !Number.isFinite(value) || value < 0
    ? "—"
    : value >= 1000000
      ? `${(value / 1000000).toFixed(1).replace(/\.0$/, "")}M`
      : value >= 1000
        ? `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`
        : String(value);

export function contextUsage(usage?: TokenUsage) {
  const used = usage?.contextTokens;
  const limit = usage?.contextWindow;
  const known =
    used !== undefined &&
    limit !== undefined &&
    Number.isFinite(used) &&
    Number.isFinite(limit) &&
    used >= 0 &&
    limit > 0;
  return {
    label: `${tokenCount(used)} / ${tokenCount(limit)}`,
    percentage: known ? Math.min(100, (used / limit) * 100) : undefined,
  };
}

export function responseTiming<
  T extends {
    createdAt: number;
    completedAt?: number;
    firstChunkAt?: number;
  },
>(conversation: T) {
  return {
    total:
      conversation.completedAt === undefined
        ? undefined
        : Math.round(
            Math.max(0, conversation.completedAt - conversation.createdAt),
          ),
    first:
      conversation.firstChunkAt === undefined
        ? undefined
        : Math.round(
            Math.max(0, conversation.firstChunkAt - conversation.createdAt),
          ),
  };
}
