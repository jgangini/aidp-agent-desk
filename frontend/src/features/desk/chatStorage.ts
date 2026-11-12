import { record } from "../../shared/record";
import { storageKey } from "../../shared/identity";

/** Public chat data only; browser-tab storage never contains OCI credentials. */
export function readChatStorage(key: string): unknown {
  try {
    const raw = sessionStorage.getItem(storageKey(`agent-desk.${key}`));
    if (!raw || raw.length > 4_000_000) return undefined;
    const saved: unknown = JSON.parse(raw);
    return record(saved) && saved.version === 1 ? saved.data : undefined;
  } catch {
    return undefined;
  }
}
const failedWrites = new Set<string>();
const storageListeners = new Set<() => void>();
export const hasChatStorageFailure = () => failedWrites.size > 0;
export function subscribeChatStorage(listener: () => void) {
  storageListeners.add(listener);
  return () => {
    storageListeners.delete(listener);
  };
}

export function writeChatStorage(key: string, data: unknown): boolean {
  let saved = false;
  try {
    const raw = JSON.stringify({ version: 1, data });
    if (raw.length <= 4_000_000) {
      sessionStorage.setItem(storageKey(`agent-desk.${key}`), raw);
      saved = true;
    }
  } catch {
    /* The live chat remains usable when browser storage is unavailable. */
  }
  const previouslyFailed = hasChatStorageFailure();
  if (saved) failedWrites.delete(key);
  else failedWrites.add(key);
  if (previouslyFailed !== hasChatStorageFailure())
    storageListeners.forEach((listener) => listener());
  return saved;
}
