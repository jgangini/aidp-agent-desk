import { apiFetch as fetch } from "../../shared/identity";
import { useEffect, useState } from "react";
import { profileIdentity } from "./agentTarget";

export interface QuerySuggestion {
  title: string;
  query: string;
}
export const suggestionsChanged = "agent-desk.suggestions-changed";

export async function readSuggestions(
  identity: string,
  signal: AbortSignal,
): Promise<QuerySuggestion[]> {
  const response = await fetch(
    `/api/desk/suggestions/${encodeURIComponent(profileIdentity(identity))}`,
    { signal },
  );
  if (!response.ok) throw new Error("No se pudieron cargar las sugerencias.");
  const data = await response.json();
  if (!Array.isArray(data.items))
    throw new Error("Las sugerencias no tienen un formato válido.");
  return data.items;
}

export function sampleSuggestions(
  items: QuerySuggestion[],
  random = Math.random,
) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function useSuggestions(identity: string, conversation?: string) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    identity: string;
    items: QuerySuggestion[];
  }>({ identity, items: [] });
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener(suggestionsChanged, refresh);
    return () => window.removeEventListener(suggestionsChanged, refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void readSuggestions(identity, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted)
          setState({ identity, items: sampleSuggestions(items) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ identity, items: [] });
      });
    return () => controller.abort();
  }, [identity, conversation, revision]);
  return state.identity === identity ? state.items : [];
}
