import { apiFetch as fetch } from "../../shared/identity";
import { storageKey } from "../../shared/identity";
import { useCallback, useEffect, useState } from "react";
import { agentChoices, profileIdentity } from "./agentTarget";
export interface AgentProfile {
  id: string;
  name: string;
  endpoint_host: string;
  flow_id: string;
  region: string;
  profile: string;
  ready: boolean;
  surface?: "PROD" | "TEST";
  instance_id?: string;
  workspace_id?: string;
}
export function useProfiles(restoredAgent?: string) {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [selected, updateSelected] = useState(() => {
    try {
      return (
        restoredAgent ??
        localStorage.getItem(storageKey("agent-desk.selected-profile")) ??
        "demo"
      );
    } catch {
      return restoredAgent ?? "demo";
    }
  });
  const setSelected = useCallback((id: string) => {
    updateSelected(id);
    try {
      localStorage.setItem(storageKey("agent-desk.selected-profile"), id);
    } catch {
      // Selection still works when browser storage is unavailable.
    }
  }, []);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/desk/profiles");
      if (!response.ok) throw new Error();
      const available: AgentProfile[] = await response.json();
      setProfiles(available);
      const choices = agentChoices(available);
      updateSelected((current) => {
        // A restored chat must never be retargeted to another profile.
        if (restoredAgent) return current;
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(
            storageKey("agent-desk.selected-profile"),
          );
        } catch {
          return choices.some((profile) => profile.id === current)
            ? current
            : (choices[0]?.id ?? "demo");
        }
        const next =
          saved === "demo"
            ? "demo"
            : choices.some((profile) => profile.id === current)
              ? current
              : (choices[0]?.id ?? "demo");
        if (available.length || saved) {
          try {
            localStorage.setItem(
              storageKey("agent-desk.selected-profile"),
              next,
            );
          } catch {
            /* Optional preference storage. */
          }
        }
        return next;
      });
      setError("");
    } catch {
      setError(
        "No se pudo leer la configuración. Comprueba que el backend esté disponible.",
      );
    }
  }, [restoredAgent]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return {
    profiles,
    selected,
    setSelected,
    refresh,
    error,
    active: profiles.find(
      (profile) => profile.id === profileIdentity(selected),
    ),
  };
}
