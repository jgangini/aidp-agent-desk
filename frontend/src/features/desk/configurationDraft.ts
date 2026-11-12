import { credentialError, type CredentialKind } from "./credentialFiles";
import type {
  ConfigurationDraft,
  CredentialFiles,
  DiscoveryItem,
  DiscoverySelection,
} from "./discovery";

export const configSteps = [
  "Conexión",
  "Agent Flow",
  "Audio",
  "Sugerencias",
] as const;
export type ConfigStep = 0 | 1 | 2 | 3;
export type FieldErrors = Partial<
  Record<CredentialKind | keyof DiscoverySelection, string>
>;

export function savedConfigurationSteps(
  saved: ConfigurationDraft,
): ConfigStep[] {
  return [
    ...(saved.has_credentials ? [0 as const] : []),
    ...(saved.instance_id && saved.profiles.length ? [1 as const] : []),
    ...(saved.transcription_model || saved.speech_model ? [2 as const] : []),
  ];
}

function credentialFields(
  files: CredentialFiles,
  fieldErrors: FieldErrors,
): FieldErrors {
  const invalid: FieldErrors = {};
  for (const kind of ["config", "key"] as const) {
    const file = files[kind];
    const message = file
      ? credentialError(kind, file) || fieldErrors[kind]
      : `Selecciona ${kind === "config" ? "el archivo config" : "key.pem"}.`;
    if (message) invalid[kind] = message;
  }
  return invalid;
}

export function validateConfigurationDraft({
  step,
  files,
  credentialsReady,
  fieldErrors,
  selection,
  workspaces,
  draft,
}: {
  step: ConfigStep;
  files: CredentialFiles;
  credentialsReady: boolean;
  fieldErrors: FieldErrors;
  selection: DiscoverySelection;
  workspaces: DiscoveryItem[];
  draft?: ConfigurationDraft;
}): FieldErrors {
  const invalid: FieldErrors = {};
  if (!credentialsReady)
    Object.assign(invalid, credentialFields(files, fieldErrors));
  for (const [name, label] of [
    ["profile", "un perfil OCI"],
    ["compartment_id", "un compartimento"],
    ...(step === 1 ? [["instance_id", "una instancia AIDP"] as const] : []),
  ] as const)
    if (!selection[name]) invalid[name] = `Selecciona ${label}.`;
  if (step === 1 && workspaces.length && !selection.workspace_id)
    invalid.workspace_id = "Selecciona un workspace.";
  if (step === 1 && !selection.agent_ids.length && !draft?.profiles.length)
    invalid.agent_ids = "Selecciona al menos un agente publicado.";
  return invalid;
}

export function configurationDraftFields(
  step: Exclude<ConfigStep, 3>,
  selection: DiscoverySelection,
  draft?: ConfigurationDraft,
): Record<string, string> {
  const { agent_ids, ...fields } = selection;
  return {
    ...fields,
    ...(step === 1
      ? {
          transcription_model: draft?.transcription_model || "",
          speech_model: draft?.speech_model || "",
        }
      : {}),
    agent_ids: JSON.stringify(agent_ids),
    step: ["connection", "agents", "audio"][step],
  };
}

export function resumeConfigurationDraft(
  saved: ConfigurationDraft,
  raw: string | null,
): ConfigurationDraft {
  try {
    const pending = JSON.parse(raw || "null");
    if (
      saved.has_credentials &&
      pending?.connection ===
        JSON.stringify([saved.profile, saved.compartment_id]) &&
      pending.selection?.profile === saved.profile
    ) {
      const values = pending.selection;
      if (
        [
          "profile",
          "compartment_id",
          "instance_id",
          "workspace_id",
          "transcription_model",
          "speech_model",
        ].every((key) => typeof values[key] === "string") &&
        Array.isArray(values.agent_ids) &&
        values.agent_ids.every((id: unknown) => typeof id === "string")
      )
        return {
          ...saved,
          profile: values.profile,
          compartment_id: values.compartment_id,
          instance_id: values.instance_id,
          workspace_id: values.workspace_id,
          transcription_model: values.transcription_model,
          speech_model: values.speech_model,
          agent_ids: values.agent_ids,
        };
    }
  } catch {
    /* Ignore expired or malformed UI state. */
  }
  return saved;
}
