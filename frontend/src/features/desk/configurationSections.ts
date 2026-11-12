import { credentialError } from "./credentialFiles";
import type { ConfigStep, FieldErrors } from "./configurationDraft";
import type {
  ConfigurationDraft,
  CredentialFiles,
  DiscoveryOptions,
  DiscoverySelection,
} from "./discovery";

export function configurationCredentials(
  files: CredentialFiles,
  errors: FieldErrors,
  draft?: ConfigurationDraft,
) {
  const validFiles = (["config", "key"] as const).every(
    (kind) =>
      files[kind] && !credentialError(kind, files[kind]) && !errors[kind],
  );
  const stored = !!draft?.has_credentials && !files.config && !files.key;
  return { validFiles, stored, ready: validFiles || stored };
}

interface SectionInput {
  credentials: ReturnType<typeof configurationCredentials>;
  selection: DiscoverySelection;
  options: DiscoveryOptions;
  draft?: ConfigurationDraft;
  savedSteps: ConfigStep[];
  loading: boolean;
  error: string;
  restoring: boolean;
}

function connectionSection(input: SectionInput) {
  const { credentials, selection, options, draft, savedSteps } = input;
  const matchesSaved =
    credentials.stored &&
    draft?.profile === selection.profile &&
    draft?.compartment_id === selection.compartment_id;
  const emptyCompartment =
    !input.restoring &&
    !input.loading &&
    !input.error &&
    !!selection.compartment_id &&
    !selection.instance_id &&
    !options.instances.length;
  return {
    ready:
      credentials.ready && !!selection.profile && !!selection.compartment_id,
    saved: savedSteps.includes(0),
    canCancel: !!draft?.has_credentials,
    matchesSaved,
    compartmentWarning: emptyCompartment
      ? "No se encontraron instancias AIDP en este compartimento."
      : undefined,
  };
}

function agentFlowSection(
  input: SectionInput,
  connection: ReturnType<typeof connectionSection>,
) {
  const { selection, options, draft, savedSteps } = input;
  return {
    ready:
      connection.matchesSaved &&
      connection.ready &&
      !!selection.instance_id &&
      (!options.workspaces.length || !!selection.workspace_id) &&
      (selection.agent_ids.length > 0 || !!draft?.profiles.length) &&
      !input.error,
    saved: savedSteps.includes(1),
    canCancel:
      !!draft?.has_credentials &&
      [
        selection.instance_id,
        selection.workspace_id,
        selection.agent_ids.length,
        draft.instance_id,
      ].some(Boolean),
  };
}

function audioSection(
  input: SectionInput,
  connection: ReturnType<typeof connectionSection>,
) {
  const { selection, options, draft, savedSteps } = input;
  const obsolete = [draft?.transcription_model, draft?.speech_model].some(
    (model) => model?.startsWith("google.") || model?.startsWith("xai."),
  );
  const catalogs = {
    transcription_model: options.transcription_models,
    speech_model: options.speech_models,
  };
  const valid = (["transcription_model", "speech_model"] as const).every(
    (field) =>
      !selection[field] ||
      catalogs[field].some((model) => model.id === selection[field]),
  );
  return {
    ready: connection.matchesSaved && !!draft?.profiles.length && valid,
    saved: savedSteps.includes(2) && !obsolete,
    canCancel:
      !!draft?.has_credentials &&
      [
        selection.transcription_model,
        selection.speech_model,
        draft.transcription_model,
        draft.speech_model,
      ].some(Boolean),
    valid,
    obsolete,
  };
}

export function configurationSections(input: SectionInput) {
  const connection = connectionSection(input);
  return [
    connection,
    agentFlowSection(input, connection),
    audioSection(input, connection),
    {
      ready: connection.matchesSaved && !!input.draft?.profiles.length,
      saved: input.savedSteps.includes(3),
      canCancel: false,
    },
  ] as const;
}
