import { apiFetch as fetch } from "../../shared/identity";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

export type CredentialFiles = Partial<Record<"config" | "key", File>>;
export interface DiscoveryItem {
  id: string;
  name: string;
}
export interface DiscoveredAgent extends DiscoveryItem {
  description?: string;
  available: boolean;
}
export interface DiscoveryOptions {
  compartments: DiscoveryItem[];
  transcription_models: DiscoveryItem[];
  speech_models: DiscoveryItem[];
  instances: DiscoveryItem[];
  workspaces: DiscoveryItem[];
  agents: DiscoveredAgent[];
  warnings: string[];
}
const emptyOptions: DiscoveryOptions = {
  compartments: [],
  transcription_models: [],
  speech_models: [],
  instances: [],
  workspaces: [],
  agents: [],
  warnings: [],
};
const emptySelection = {
  profile: "",
  compartment_id: "",
  instance_id: "",
  workspace_id: "",
  transcription_model: "",
  speech_model: "",
  agent_ids: [] as string[],
};
export type DiscoverySelection = typeof emptySelection;
export interface ConfigurationDraft extends DiscoverySelection {
  region: string;
  has_credentials: boolean;
  connection_managed?: boolean;
  profiles: import("./profiles").AgentProfile[];
}

export async function discoveryPost<T>(
  route: "profiles" | "options" | "import" | "draft",
  files: CredentialFiles,
  fields: Record<string, string>,
  signal: AbortSignal,
): Promise<T> {
  const body = new FormData();
  for (const kind of ["config", "key"] as const) {
    if (files[kind]) body.set(kind, files[kind]);
  }
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  const response = await fetch(`/api/desk/discovery/${route}`, {
    method: "POST",
    headers: { "X-Agent-Desk": "configure" },
    body,
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : "No se pudieron consultar los recursos OCI.",
    );
  return result as T;
}

type DiscoveryWarnings = Partial<Record<string, string[]>>;
interface CatalogUpdates {
  setProfiles: Dispatch<SetStateAction<{ name: string; region: string }[]>>;
  setOptions: Dispatch<SetStateAction<DiscoveryOptions>>;
  setSelection: Dispatch<SetStateAction<DiscoverySelection>>;
  setWarnings: Dispatch<SetStateAction<DiscoveryWarnings>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
}
async function loadCatalog(
  stage: string,
  files: CredentialFiles,
  fields: Record<string, string>,
  signal: AbortSignal,
  {
    setProfiles,
    setOptions,
    setSelection,
    setWarnings,
    setLoading,
    setError,
  }: CatalogUpdates,
) {
  try {
    if (stage === "profiles") {
      const result = await discoveryPost<{
        profiles: { name: string; region: string }[];
      }>("profiles", files, fields, signal);
      if (!signal.aborted) setProfiles(result.profiles);
    } else {
      const result = await discoveryPost<DiscoveryOptions>(
        "options",
        files,
        fields,
        signal,
      );
      if (signal.aborted) return;
      setOptions((current) => ({
        ...current,
        ...(stage === "compartments"
          ? { compartments: result.compartments }
          : stage === "audio"
            ? {
                transcription_models: result.transcription_models,
                speech_models: result.speech_models,
              }
            : stage === "resources"
              ? {
                  transcription_models: result.transcription_models,
                  speech_models: result.speech_models,
                  instances: result.instances,
                }
              : { workspaces: result.workspaces, agents: result.agents }),
      }));
      if (stage === "agents")
        setSelection((current) => ({
          ...current,
          agent_ids: current.agent_ids.filter((id) =>
            result.agents.some((agent) => agent.id === id && agent.available),
          ),
        }));
      setWarnings((current) => ({ ...current, [stage]: result.warnings }));
    }
  } catch (reason) {
    if (!signal.aborted)
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudieron consultar los recursos OCI.",
      );
  } finally {
    if (!signal.aborted) setLoading(false);
  }
}

async function restoreCatalog(
  draft: ConfigurationDraft,
  signal: AbortSignal,
  onError: (message: string) => void,
) {
  const restored = { ...emptyOptions, warnings: [] as string[] };
  const fields = {
    profile: draft.profile,
    compartment_id: draft.compartment_id,
    instance_id: draft.instance_id,
    workspace_id: draft.workspace_id,
  };
  try {
    for (const stage of ["compartments", "resources", "agents"]) {
      if (stage === "resources" && !draft.compartment_id) break;
      if (stage === "agents" && !draft.instance_id) break;
      const result = await discoveryPost<DiscoveryOptions>(
        "options",
        {},
        { ...fields, stage },
        signal,
      );
      if (signal.aborted) return { restored, fields };
      if (stage === "compartments") restored.compartments = result.compartments;
      if (stage === "resources") {
        restored.instances = result.instances;
        restored.transcription_models = result.transcription_models;
        restored.speech_models = result.speech_models;
      }
      if (stage === "agents") {
        restored.workspaces = result.workspaces;
        restored.agents = result.agents;
      }
      restored.warnings.push(...result.warnings);
    }
  } catch (reason) {
    if (!signal.aborted)
      onError(
        reason instanceof Error
          ? reason.message
          : "No se pudo actualizar el catálogo.",
      );
  }
  return { restored, fields };
}

function discoveryStage(
  { profile, compartment_id, instance_id }: DiscoverySelection,
  audioOnly: boolean,
) {
  return audioOnly && profile && compartment_id
    ? "audio"
    : !profile
      ? "profiles"
      : !compartment_id
        ? "compartments"
        : !instance_id
          ? "resources"
          : "agents";
}

export function useDiscovery(
  files: CredentialFiles,
  enabled: boolean,
  audioOnly = false,
) {
  const [profiles, setProfiles] = useState<{ name: string; region: string }[]>(
    [],
  );
  const [options, setOptions] = useState(emptyOptions);
  const [selection, setSelection] = useState(emptySelection);
  const [warnings, setWarnings] = useState<Partial<Record<string, string[]>>>(
    {},
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const { profile, compartment_id, instance_id, workspace_id } = selection;
  const stage = discoveryStage(selection, audioOnly);
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    const fields: Record<string, string> =
      stage === "profiles" ? {} : { profile, stage };
    if (compartment_id) fields.compartment_id = compartment_id;
    if (instance_id) fields.instance_id = instance_id;
    if (workspace_id) fields.workspace_id = workspace_id;
    void loadCatalog(stage, files, fields, controller.signal, {
      setProfiles,
      setOptions,
      setSelection,
      setWarnings,
      setLoading,
      setError,
    });
    return () => controller.abort();
  }, [
    files.config,
    files.key,
    enabled,
    profile,
    compartment_id,
    instance_id,
    workspace_id,
    stage,
    attempt,
  ]);

  const reset = () => {
    request.current?.abort();
    setProfiles([]);
    setOptions(emptyOptions);
    setSelection(emptySelection);
    setWarnings({});
    setError("");
    setLoading(false);
    setAttempt((current) => current + 1);
  };
  const choose = (
    name: keyof Omit<DiscoverySelection, "agent_ids">,
    value: string,
  ) => {
    if (selection[name] === value) return;
    if (name === "transcription_model" || name === "speech_model") {
      setSelection((current) => ({ ...current, [name]: value }));
      return;
    }
    request.current?.abort();
    setError("");
    setLoading(false);
    setSelection((current) => ({
      ...current,
      [name]: value,
      agent_ids: [],
      ...(name === "profile"
        ? {
            compartment_id: "",
            transcription_model: "",
            speech_model: "",
            instance_id: "",
            workspace_id: "",
          }
        : name === "compartment_id"
          ? {
              transcription_model: "",
              speech_model: "",
              instance_id: "",
              workspace_id: "",
            }
          : name === "instance_id"
            ? { workspace_id: "" }
            : {}),
    }));
    setOptions((current) => ({
      ...current,
      ...(name === "profile"
        ? emptyOptions
        : name === "compartment_id"
          ? { ...emptyOptions, compartments: current.compartments }
          : name === "instance_id"
            ? { workspaces: [], agents: [] }
            : { agents: [] }),
    }));
    setWarnings((current) =>
      name === "profile"
        ? {}
        : name === "compartment_id"
          ? { compartments: current.compartments }
          : {
              compartments: current.compartments,
              resources: current.resources,
            },
    );
  };
  const toggle = (id: string) => {
    if (!options.agents.some((agent) => agent.id === id && agent.available))
      return;
    setSelection((current) => ({
      ...current,
      agent_ids: current.agent_ids.includes(id)
        ? current.agent_ids.filter((item) => item !== id)
        : [...current.agent_ids, id],
    }));
  };
  const clearSection = (section: "agents" | "audio") => {
    request.current?.abort();
    setLoading(false);
    setError("");
    setSelection((current) => ({
      ...current,
      ...(section === "agents"
        ? { instance_id: "", workspace_id: "", agent_ids: [] }
        : { transcription_model: "", speech_model: "" }),
    }));
    if (section === "agents")
      setOptions((current) => ({ ...current, workspaces: [], agents: [] }));
  };
  const restore = async (draft: ConfigurationDraft, signal: AbortSignal) => {
    if (!draft.has_credentials) return;
    const { restored, fields } = await restoreCatalog(draft, signal, setError);
    if (signal.aborted) return;
    setProfiles([{ name: draft.profile, region: draft.region }]);
    setOptions(restored);
    setSelection({
      ...fields,
      agent_ids: draft.agent_ids.filter((id) =>
        restored.agents.some((agent) => agent.id === id && agent.available),
      ),
      transcription_model: draft.transcription_model,
      speech_model: draft.speech_model,
    });
    setWarnings({ restored: restored.warnings });
  };
  return {
    profiles,
    options,
    selection,
    choose,
    toggle,
    clearSection,
    restore,
    reset,
    cancel: () => request.current?.abort(),
    loading,
    error,
    stage,
    warnings: [
      ...new Set(Object.values(warnings).flatMap((items) => items ?? [])),
    ],
    retry: () => setAttempt((current) => current + 1),
  };
}
