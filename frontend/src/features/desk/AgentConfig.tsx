import { useId, useRef, useState } from "react";
import type { AgentProfile } from "./profiles";
import { useDiscovery, type ConfigurationDraft } from "./discovery";
import "./AgentConfigDrop.css";
import { SuggestionsEditor } from "./SuggestionsEditor";
import type { ConfigurationFieldState } from "./ConfigurationField";
import type { ConfigStep } from "./configurationDraft";
import {
  ConnectionPanel,
  AgentFlowPanel,
  AudioPanel,
} from "./AgentConfigPanels";
import {
  configurationCredentials,
  configurationSections,
} from "./configurationSections";
import {
  ConfigurationTabs,
  DiscoveryNotices,
  ConfigurationFeedback,
  ConfigurationFooter,
  ConfigurationCancelDialog,
} from "./AgentConfigChrome";
import { useConfigurationSteps } from "./useConfigurationSteps";
import { useConfigurationFields } from "./useConfigurationFields";
import { useConfigurationPanel } from "./useConfigurationPanel";
import {
  useConfigurationRestore,
  useConfigurationSave,
  cancelConfiguration,
} from "./configurationPersistence";

export function AgentConfig({
  profiles,
  selected,
  onSelect,
  onSaved,
  onClose,
  closeRequest = 0,
  error: loadError,
}: {
  profiles: AgentProfile[];
  selected: string;
  onSelect: (id: string) => void;
  onSaved: () => Promise<void>;
  onClose: () => void;
  closeRequest?: number;
  error: string;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const surface = useRef<HTMLElement>(null);
  const cancelDialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<ConfigurationDraft>();
  const [connectionManaged, setConnectionManaged] = useState<boolean>();
  const steps = useConfigurationSteps(connectionManaged);
  const { step, setStep, suggestionsVisited } = steps;
  const fields = useConfigurationFields(surface);
  const { files, errors: fieldErrors } = fields;
  const [savedSteps, setSavedSteps] = useState<ConfigStep[]>([]);
  const [restoring, setRestoring] = useState(false);
  const edited = useRef(false);
  const draftState = {
    draft,
    setDraft,
    setSavedSteps,
    restoring,
    setRestoring,
    edited,
  };
  const operation = { busy, setBusy, setError, setNotice };
  const credentials = configurationCredentials(files, fieldErrors, draft);
  const { validFiles, ready: credentialsReady } = credentials;
  const discovery = useDiscovery(
    files,
    credentialsReady && !restoring,
    step === 2,
  );
  const { selection, options } = discovery;
  const restoration = useConfigurationRestore({
    files,
    selection,
    restore: discovery.restore,
    state: draftState,
    setError,
    onConnectionMode: setConnectionManaged,
    onManagedConnection: () => {
      discovery.reset();
      fields.clearFiles();
      fields.clearErrors();
      setError("");
      setNotice("");
    },
  });
  const agentsRef = useRef<HTMLFieldSetElement>(null);
  const fieldId = useId();
  const sections = configurationSections({
    credentials,
    selection,
    options,
    draft,
    savedSteps,
    loading: discovery.loading,
    error: discovery.error,
    restoring,
  });
  const section = sections[step];
  const ready = !restoring && !discovery.loading && section.ready;
  const saving = useConfigurationSave({
    files,
    selection,
    state: draftState,
    operation,
    clearFiles: fields.clearFiles,
    selected,
    onSaved,
    onSelect,
  });
  const panel = useConfigurationPanel({
    title,
    surface,
    busy,
    cancelDiscovery: discovery.cancel,
    onClose,
    closeRequest,
  });
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      step === 3 ||
      busy ||
      section.saved ||
      (step === 2 && !sections[2].valid)
    )
      return;
    setError("");
    setNotice("");
    if (
      !fields.validate(event.currentTarget, {
        step,
        credentialsReady,
        selection,
        workspaces: options.workspaces,
        draft,
      })
    )
      return;
    if (!ready) return;
    await saving.persist(step);
  };
  const fieldState: ConfigurationFieldState = {
    fieldId,
    step,
    selection,
    disabled: busy || restoring,
    loading: discovery.loading,
    stage: discovery.stage,
    errors: fieldErrors,
    compartmentWarning: sections[0].compartmentWarning,
    onChange: (name, value) => {
      discovery.choose(name, value);
      fields.selectField();
      setError("");
      setNotice("");
    },
    onEmpty: fields.report,
  };
  const cancelSection = () =>
    cancelConfiguration({
      step,
      state: draftState,
      operation,
      discovery,
      abortSave: saving.abort,
      clearFiles: fields.clearFiles,
      clearErrors: fields.clearErrors,
      resetSteps: steps.reset,
      cancelDialog,
      onSaved,
    });
  return (
    <section
      ref={surface}
      className="agent-config-glass agent-config-inline"
      role="region"
      aria-labelledby="agent-config-title"
      onKeyDown={panel.onKeyDown}
    >
      <header>
        <img
          className="config-aidp-icon"
          src="/icons/aidp/oci-ai-data-platform.svg"
          width="40"
          height="40"
          alt=""
        />
        <div>
          <h2 id="agent-config-title" ref={title} tabIndex={-1}>
            Oracle AI Data Platform Agent Flows
          </h2>
          <p>Configura la conexión con tu Agent Flow publicado.</p>
        </div>
      </header>
      <form
        className="agent-config-form"
        noValidate
        onAnimationEnd={fields.onAnimationEnd}
        onSubmit={(event) => void save(event)}
      >
        <ConfigurationTabs
          fieldId={fieldId}
          step={step}
          connectionManaged={connectionManaged !== false}
          disabled={fieldState.disabled}
          onChange={(next) => {
            setStep(next);
            setNotice("");
          }}
        />
        {!connectionManaged && (
          <ConnectionPanel
            fieldId={fieldId}
            active={step === 0}
            files={files}
            stored={credentials.stored}
            disabled={fieldState.disabled}
            errors={fieldErrors}
            profiles={discovery.profiles}
            selectedProfile={selection.profile}
            compartments={options.compartments}
            fieldState={fieldState}
            onFileError={(kind, message) => {
              discovery.reset();
              fields.report(kind, message);
            }}
            onFileSelect={(kind, file) => {
              edited.current = true;
              discovery.reset();
              fields.selectFile(kind, file);
              setError("");
              setNotice("");
            }}
          />
        )}
        <AgentFlowPanel
          fieldId={fieldId}
          active={step === 1}
          discovery={discovery}
          busy={busy}
          error={fieldErrors.agent_ids}
          agentsRef={agentsRef}
          fieldState={fieldState}
          onToggle={(id) => {
            discovery.toggle(id);
            fields.toggleAgent();
            setError("");
          }}
        />
        <AudioPanel
          fieldId={fieldId}
          active={step === 2}
          obsoleteAudio={sections[2].obsolete}
          options={options}
          fieldState={fieldState}
        />
        <div
          role="tabpanel"
          id={`${fieldId}-panel-3`}
          aria-labelledby={`${fieldId}-step-3`}
          hidden={step !== 3}
          className="config-step-panel"
        >
          {suggestionsVisited && (
            <SuggestionsEditor profiles={profiles} selected={selected} />
          )}
        </div>
        <DiscoveryNotices
          discovery={discovery}
          validFiles={validFiles}
          step={step}
        />
        <ConfigurationFeedback
          error={error}
          loadError={loadError}
          notice={notice}
          onRetry={restoration.retry}
        />
        <ConfigurationFooter
          step={step}
          busy={busy}
          restoring={restoring}
          ready={ready}
          saved={section.saved}
          canCancel={section.canCancel}
          cancelButton={cancelButton}
          onCancel={() => cancelDialog.current?.showModal()}
        />
      </form>
      <ConfigurationCancelDialog
        cancelDialog={cancelDialog}
        cancelButton={cancelButton}
        fieldId={fieldId}
        step={step}
        busy={busy}
        error={error}
        onConfirm={() => void cancelSection()}
      />
    </section>
  );
}
