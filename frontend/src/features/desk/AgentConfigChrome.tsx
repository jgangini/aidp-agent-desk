import type { CSSProperties, RefObject } from "react";
import { CircleCheck } from "lucide-react";
import { configSteps, type ConfigStep } from "./configurationDraft";
import type { DiscoveryOptions, DiscoverySelection } from "./discovery";

interface DiscoveryNoticesState {
  loading: boolean;
  stage: string;
  selection: DiscoverySelection;
  options: DiscoveryOptions;
  profiles: { name: string; region: string }[];
  warnings: string[];
  error: string;
  retry: () => void;
}

const loadingMessages: Record<string, string> = {
  profiles: "Leyendo perfiles OCI…",
  compartments: "Buscando compartimentos…",
  resources: "",
  agents: "",
};

export function DiscoveryNotices({
  discovery,
  validFiles,
  step,
}: {
  discovery: DiscoveryNoticesState;
  validFiles: boolean;
  step: ConfigStep;
}) {
  const { selection, options } = discovery;
  const loadingMessage =
    loadingMessages[discovery.stage] ?? "Buscando workspaces y agentes…";
  return (
    <>
      {discovery.loading && loadingMessage && (
        <p className="config-discovery-status" role="status">
          {loadingMessage}
        </p>
      )}
      {!discovery.loading && !discovery.error && (
        <>
          {selection.profile &&
            !selection.compartment_id &&
            !options.compartments.length && (
              <p className="config-discovery-status" role="status">
                No se encontraron compartimentos accesibles para este perfil.
              </p>
            )}
          {validFiles && !discovery.profiles.length && (
            <p className="config-discovery-status" role="status">
              No se encontraron perfiles OCI en el archivo config.
            </p>
          )}
        </>
      )}
      {step === 2 &&
        discovery.warnings.map((warning) => (
          <p className="config-discovery-warning" key={warning}>
            {warning}
          </p>
        ))}
      {discovery.error && (
        <div className="config-discovery-error">
          <p className="form-error" role="alert">
            {discovery.error}
          </p>
          <button
            type="button"
            onClick={discovery.retry}
            data-tooltip-disabled="true"
          >
            Reintentar
          </button>
        </div>
      )}
    </>
  );
}

export function ConfigurationFeedback({
  error,
  loadError,
  notice,
  onRetry,
}: {
  error: string;
  loadError: string;
  notice: string;
  onRetry?: () => void;
}) {
  return (
    <>
      {(error || loadError) && (
        <p className="form-error" role="alert">
          {error || loadError}
        </p>
      )}
      {error && onRetry && (
        <button type="button" data-tooltip-disabled="true" onClick={onRetry}>
          Reintentar configuración
        </button>
      )}
      {notice && (
        <p
          className="config-notice config-feedback config-feedback-success"
          role="status"
        >
          <CircleCheck size={16} aria-hidden="true" />
          <span>{notice}</span>
        </p>
      )}
    </>
  );
}

export function ConfigurationFooter({
  step,
  busy,
  restoring,
  ready,
  saved,
  canCancel,
  cancelButton,
  onCancel,
}: {
  step: ConfigStep;
  busy: boolean;
  restoring: boolean;
  ready: boolean;
  saved: boolean;
  canCancel: boolean;
  cancelButton: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
}) {
  return (
    <footer hidden={step === 3}>
      {canCancel && (
        <button
          ref={cancelButton}
          type="button"
          className="config-cancel"
          disabled={busy || restoring}
          data-tooltip-disabled="true"
          onClick={onCancel}
        >
          Cancelar
        </button>
      )}
      <button
        className="save-profile"
        type="submit"
        disabled={busy || !ready || saved}
        data-tooltip-disabled="true"
      >
        {busy ? "Guardando…" : "Guardar"}
      </button>
    </footer>
  );
}

export function ConfigurationTabs({
  fieldId,
  step,
  connectionManaged = false,
  disabled,
  onChange,
}: {
  fieldId: string;
  step: ConfigStep;
  connectionManaged?: boolean;
  disabled: boolean;
  onChange: (step: ConfigStep) => void;
}) {
  const steps: ConfigStep[] = connectionManaged ? [1, 2, 3] : [0, 1, 2, 3];
  const activeIndex = steps.indexOf(step);
  return (
    <div
      className="config-step-tabs"
      role="tablist"
      aria-label="Pasos de configuración"
      data-tooltip-disabled="true"
      style={{ "--config-tab-count": steps.length } as CSSProperties}
    >
      <span
        className="config-step-pill"
        aria-hidden="true"
        style={{ transform: `translateX(${activeIndex * 100}%)` }}
      />
      {steps.map((id, index) => (
        <button
          type="button"
          role="tab"
          key={id}
          id={`${fieldId}-step-${id}`}
          aria-controls={`${fieldId}-panel-${id}`}
          aria-selected={step === id}
          tabIndex={step === id ? 0 : -1}
          disabled={disabled}
          onClick={() => {
            onChange(id);
          }}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % steps.length
                : event.key === "ArrowLeft"
                  ? (index + steps.length - 1) % steps.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? steps.length - 1
                      : -1;
            if (next < 0) return;
            event.preventDefault();
            onChange(steps[next]);
            document.getElementById(`${fieldId}-step-${steps[next]}`)?.focus();
          }}
        >
          {configSteps[id]}
        </button>
      ))}
    </div>
  );
}

export function ConfigurationCancelDialog({
  cancelDialog,
  cancelButton,
  fieldId,
  step,
  busy,
  error,
  onConfirm,
}: {
  cancelDialog: RefObject<HTMLDialogElement | null>;
  cancelButton: RefObject<HTMLButtonElement | null>;
  fieldId: string;
  step: ConfigStep;
  busy: boolean;
  error: string;
  onConfirm: () => void;
}) {
  return (
    <dialog
      ref={cancelDialog}
      className="config-cancel-dialog"
      aria-labelledby={`${fieldId}-cancel-title`}
      aria-describedby={`${fieldId}-cancel-description`}
      data-tooltip-disabled="true"
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={() => cancelButton.current?.focus()}
    >
      <h2 id={`${fieldId}-cancel-title`}>
        {step === 0
          ? "¿Eliminar los datos de esta conexión?"
          : `¿Limpiar ${configSteps[step]}?`}
      </h2>
      <p id={`${fieldId}-cancel-description`}>
        {step === 0 ? (
          <>
            Se eliminarán las credenciales y selecciones de configuración
            guardadas en Agent Desk, incluidos los cambios pendientes. Tendrás
            que cargar config y key.pem de nuevo. Los agentes ya agregados se
            conservarán.
          </>
        ) : step === 1 ? (
          "Se limpiarán Workbench, Workspace y la selección de Agent Flow. Conexión, Audio, los agentes agregados y sus sugerencias se conservarán."
        ) : (
          "Se limpiarán STT y TTS de este formulario y de sus agentes asociados. Conexión, Agent Flow y Sugerencias se conservarán."
        )}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer hidden={step === 3}>
        <button
          type="button"
          disabled={busy}
          autoFocus
          onClick={() => cancelDialog.current?.close()}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="config-cancel-accept"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "Eliminando…" : "Aceptar"}
        </button>
      </footer>
    </dialog>
  );
}
