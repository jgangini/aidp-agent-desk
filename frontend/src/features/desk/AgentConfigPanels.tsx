import type { RefObject } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { SelectValue } from "../../shared/SelectValue";
import { CredentialDrop } from "./CredentialDrop";
import type { CredentialKind } from "./credentialFiles";
import type { FieldErrors } from "./configurationDraft";
import {
  ConfigurationField,
  type ConfigurationFieldState,
} from "./ConfigurationField";
import type {
  CredentialFiles,
  DiscoveryItem,
  DiscoveryOptions,
  DiscoverySelection,
} from "./discovery";

export function ConnectionPanel({
  fieldId,
  active,
  files,
  stored,
  disabled,
  errors,
  profiles,
  selectedProfile,
  compartments,
  onFileError,
  onFileSelect,
  fieldState,
}: {
  fieldId: string;
  active: boolean;
  files: CredentialFiles;
  stored: boolean;
  disabled: boolean;
  errors: FieldErrors;
  profiles: { name: string; region: string }[];
  selectedProfile: string;
  compartments: DiscoveryItem[];
  onFileError: (kind: CredentialKind, message: string) => void;
  onFileSelect: (kind: CredentialKind, file: File) => void;
  fieldState: ConfigurationFieldState;
}) {
  return (
    <div
      role="tabpanel"
      id={`${fieldId}-panel-0`}
      aria-labelledby={`${fieldId}-step-0`}
      hidden={!active}
      className="config-step-panel"
    >
      <div className="config-fields config-upload-fields">
        {(["config", "key"] as const).map((kind) => (
          <CredentialDrop
            key={kind}
            kind={kind}
            file={files[kind]}
            stored={stored}
            disabled={disabled}
            error={errors[kind] || ""}
            onError={(message) => onFileError(kind, message)}
            onSelect={(file) => onFileSelect(kind, file)}
          />
        ))}
      </div>
      <div className="config-fields config-profile-fields">
        <ConfigurationField
          state={fieldState}
          name="profile"
          label="Perfil"
          items={profiles.map((profile) => ({
            id: profile.name,
            name: profile.name,
          }))}
        />
        <label>
          Región
          <select
            name="region"
            disabled
            value={
              profiles.find((profile) => profile.name === selectedProfile)
                ?.region || ""
            }
          >
            <SelectValue />
            <option value="">Seleccionar…</option>
            {profiles.map((profile) =>
              profile.name === selectedProfile && profile.region ? (
                <option key={profile.name} value={profile.region}>
                  {profile.region}
                </option>
              ) : null,
            )}
          </select>
        </label>
        <ConfigurationField
          state={fieldState}
          name="compartment_id"
          label="Compartimento"
          items={compartments}
        />
      </div>
    </div>
  );
}

export function AgentFlowPanel({
  fieldId,
  active,
  discovery,
  busy,
  error,
  agentsRef,
  onToggle,
  fieldState,
}: {
  fieldId: string;
  active: boolean;
  discovery: {
    options: DiscoveryOptions;
    selection: DiscoverySelection;
    loading: boolean;
    stage: string;
    error: string;
  };
  busy: boolean;
  error?: string;
  agentsRef: RefObject<HTMLFieldSetElement | null>;
  onToggle: (id: string) => void;
  fieldState: ConfigurationFieldState;
}) {
  const { selection, options } = discovery;
  return (
    <div
      role="tabpanel"
      id={`${fieldId}-panel-1`}
      aria-labelledby={`${fieldId}-step-1`}
      hidden={!active}
      className="config-step-panel"
    >
      <div className="config-fields config-discovery-fields config-platform-fields">
        <ConfigurationField
          state={fieldState}
          name="instance_id"
          label="Oracle AI Data Platform Workbench"
          items={options.instances}
        />
        <ConfigurationField
          state={fieldState}
          name="workspace_id"
          label="Workspace"
          items={options.workspaces}
          required={options.workspaces.length > 0}
        />
        <fieldset
          ref={agentsRef}
          className="config-agent-choices t-input"
          name="agent_ids"
          tabIndex={-1}
          aria-describedby={error ? `${fieldId}-agents-error` : undefined}
          aria-invalid={!!error}
          aria-busy={discovery.loading && discovery.stage === "agents"}
        >
          <legend id={`${fieldId}-agents-label`}>Agent Flow</legend>
          <div
            id={`${fieldId}-agents-options`}
            role="group"
            aria-label="Agentes disponibles"
            className="config-agent-options"
            data-tooltip-disabled="true"
          >
            {discovery.loading && discovery.stage === "agents" ? (
              <div className="config-agent-loading" role="status">
                <LoaderCircle
                  className="config-select-spinner"
                  size={15}
                  aria-hidden="true"
                />
                <span>Buscando agentes…</span>
              </div>
            ) : options.agents.length > 0 ? (
              <>
                {options.agents.map((agent) => (
                  <label className="config-agent-choice" key={agent.id}>
                    <input
                      type="checkbox"
                      value={agent.id}
                      checked={selection.agent_ids.includes(agent.id)}
                      disabled={busy || discovery.loading || !agent.available}
                      onChange={() => onToggle(agent.id)}
                    />
                    <Check
                      className="config-agent-check"
                      size={12}
                      aria-hidden="true"
                    />
                    <span className="config-agent-copy">
                      <strong>{agent.name}</strong>
                      {agent.description && <small>{agent.description}</small>}
                      {!agent.available && <small>Publicación requerida</small>}
                    </span>
                  </label>
                ))}
              </>
            ) : (
              <p className="config-agent-placeholder">
                Selecciona un workspace para ver sus agentes.
              </p>
            )}
          </div>
          {!discovery.loading &&
            selection.instance_id &&
            (!options.workspaces.length || selection.workspace_id) &&
            !options.agents.length &&
            !discovery.error && (
              <p>No se encontraron agentes en esta selección.</p>
            )}
          {error && (
            <span
              id={`${fieldId}-agents-error`}
              className="config-field-error"
              role="alert"
            >
              {error}
            </span>
          )}
        </fieldset>
      </div>
    </div>
  );
}

export function AudioPanel({
  fieldId,
  active,
  obsoleteAudio,
  options,
  fieldState,
}: {
  fieldId: string;
  active: boolean;
  obsoleteAudio: boolean;
  options: Pick<DiscoveryOptions, "transcription_models" | "speech_models">;
  fieldState: ConfigurationFieldState;
}) {
  return (
    <div
      role="tabpanel"
      id={`${fieldId}-panel-2`}
      aria-labelledby={`${fieldId}-step-2`}
      hidden={!active}
      className="config-step-panel"
    >
      {obsoleteAudio && (
        <p className="config-discovery-warning" role="status">
          La configuración de audio guardada requiere reconfiguración.
          Selecciona OCI Speech o «Sin configurar» y guarda.
        </p>
      )}
      <div className="config-fields config-discovery-fields">
        <ConfigurationField
          state={fieldState}
          name="transcription_model"
          label="Audio a texto (STT)"
          items={options.transcription_models}
          required={false}
          placeholder="Sin configurar"
        />
        <ConfigurationField
          state={fieldState}
          name="speech_model"
          label="Texto a Audio (TTS)"
          items={options.speech_models}
          required={false}
          placeholder="Sin configurar"
        />
      </div>
    </div>
  );
}
