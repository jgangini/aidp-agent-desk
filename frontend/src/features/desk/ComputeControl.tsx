import { useEffect, useId, useRef, useState } from "react";
import { Power, RefreshCw, TriangleAlert, X } from "lucide-react";
import {
  useComputeControl,
  type AgentCompute,
  type ComputeContext,
} from "./computeLifecycle";
import { isComputeStartable } from "./computeApi";
import "./ComputeControl.css";

type ComputeController = ReturnType<typeof useComputeControl>;
interface Confirmation {
  compute: AgentCompute;
  requestId: string;
  revision: string;
}
const stateLabels: Record<string, string> = {
  ACTIVE: "Activo",
  STOPPED: "Detenido",
  STARTING: "Iniciando",
  CREATING: "Creando",
  STOPPING: "Deteniendo",
  FAILED: "Error",
  DELETED: "Eliminado",
  DELETING: "Eliminando",
};
function controlsBlocked(compute: ComputeController, disabled: boolean) {
  return (
    disabled ||
    compute.reading ||
    !!compute.error ||
    compute.submitting ||
    compute.submitted ||
    compute.timedOut
  );
}
function canConfirm(
  item: AgentCompute,
  compute: ComputeController,
  disabled: boolean,
) {
  if (controlsBlocked(compute, disabled)) return false;
  const current = compute.status?.computes.find(
    (entry) => entry.id === item.id,
  );
  return !!current && isComputeStartable(current) && isComputeStartable(item);
}
function qualifier(item: AgentCompute, submitted: boolean) {
  if (item.operation === "uncertain") return " · Por confirmar";
  if (item.state !== "STOPPED") return "";
  if (item.operation === "starting") return " · Inicio solicitado";
  if (submitted && item.operation === "idle") return " · Inicio por confirmar";
  return "";
}
export function ComputeControl({
  context,
  agentName,
  disabled = false,
}: {
  context: ComputeContext;
  agentName: string;
  disabled?: boolean;
}) {
  const compute = useComputeControl(context);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const key = JSON.stringify(context);
  useEffect(() => {
    setConfirmation(null);
  }, [key]);
  const close = () => {
    if (compute.submitting) return;
    setConfirmation(null);
    opener.current?.focus();
  };
  const choose = (item: AgentCompute, button: HTMLButtonElement) => {
    opener.current = button;
    setConfirmation({
      compute: item,
      requestId: crypto.randomUUID().replaceAll("-", ""),
      revision: item.confirmation,
    });
  };
  const confirm = () => {
    if (!confirmation) return;
    void compute
      .start(
        confirmation.compute,
        confirmation.requestId,
        confirmation.revision,
      )
      .then(() => setConfirmation(null));
  };
  return (
    <div
      className="compute-control"
      role="group"
      aria-label={`Compute de ${agentName}`}
    >
      {!compute.status && !compute.error && (
        <small role="status">Consultando compute…</small>
      )}
      {compute.status?.computes.map((item) => (
        <ComputeItem
          key={item.id}
          item={item}
          multiple={compute.status!.computes.length > 1}
          error={!!compute.error}
          submitted={compute.submitted}
          canStart={canConfirm(item, compute, disabled)}
          onChoose={choose}
        />
      ))}
      <ComputeFeedback
        compute={compute}
        agentName={agentName}
        disabled={disabled}
      />
      <ComputeStartDialog
        confirmation={confirmation}
        busy={compute.submitting}
        canConfirm={
          confirmation
            ? canConfirm(confirmation.compute, compute, disabled)
            : false
        }
        onClose={close}
        onConfirm={confirm}
      />
    </div>
  );
}
function ComputeItem({
  item,
  multiple,
  error,
  submitted,
  canStart,
  onChoose,
}: {
  item: AgentCompute;
  multiple: boolean;
  error: boolean;
  submitted: boolean;
  canStart: boolean;
  onChoose: (item: AgentCompute, button: HTMLButtonElement) => void;
}) {
  const label = error
    ? "Estado no disponible"
    : (stateLabels[item.state] ?? item.state);
  return (
    <div className="compute-control-state">
      <small aria-label={`Compute ${item.name}: ${label}`}>
        {multiple && `${item.name}: `}
        {label}
        {!error && qualifier(item, submitted)}
      </small>
      {canStart && (
        <button
          type="button"
          className="compute-start-button"
          aria-label={`Iniciar compute ${item.name}`}
          onClick={(event) => onChoose(item, event.currentTarget)}
        >
          <Power size={14} aria-hidden="true" /> Iniciar
        </button>
      )}
      {item.message && (
        <small className="compute-message">{item.message}</small>
      )}
    </div>
  );
}
function ComputeFeedback({
  compute,
  agentName,
  disabled,
}: {
  compute: ComputeController;
  agentName: string;
  disabled: boolean;
}) {
  return (
    <>
      {compute.status?.warning && (
        <small className="compute-message">{compute.status.warning}</small>
      )}
      {compute.error && (
        <small role="alert" className="compute-error">
          {compute.error}
        </small>
      )}
      {compute.timedOut && (
        <small role="status" className="compute-message">
          La espera de inicio agotó los 15 minutos. Consulta el estado; no se
          enviará otro inicio.
        </small>
      )}
      {(compute.error || compute.timedOut) && (
        <button
          type="button"
          className="icon-button"
          aria-label={`Consultar compute de ${agentName}`}
          data-tooltip="Actualizar"
          disabled={compute.reading || compute.submitting || disabled}
          onClick={() => compute.refresh()}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      )}
    </>
  );
}
function ComputeStartDialog({
  confirmation,
  busy,
  canConfirm,
  onClose,
  onConfirm,
}: {
  confirmation: Confirmation | null;
  busy: boolean;
  canConfirm: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    if (confirmation) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [confirmation]);
  return (
    <dialog
      ref={dialog}
      className="config-cancel-dialog compute-start-dialog"
      aria-labelledby={headingId}
      aria-describedby={`${headingId}-cost`}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      <header>
        <h2 id={headingId}>Iniciar compute</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Cerrar confirmación de inicio"
          disabled={busy}
          onClick={onClose}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </header>
      {confirmation && (
        <>
          <ComputeConfirmationDetails
            confirmation={confirmation}
            costId={`${headingId}-cost`}
          />
          <footer>
            <button type="button" disabled={busy} onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="config-cancel-accept"
              disabled={busy || !canConfirm}
              onClick={onConfirm}
            >
              {busy ? "Iniciando…" : "Iniciar"}
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}
function ComputeConfirmationDetails({
  confirmation,
  costId,
}: {
  confirmation: Confirmation;
  costId: string;
}) {
  return (
    <>
      <p>
        Se iniciará <strong>{confirmation.compute.name}</strong>.
      </p>
      <p className="compute-targets-heading">Destinos que usan este compute:</p>
      <ul className="compute-targets">
        {confirmation.compute.targets.map((target) => (
          <li key={`${target.agent_id}-${target.surface}`}>
            <span>{target.name}</span>
            <small>{target.surface}</small>
          </li>
        ))}
      </ul>
      <div className="compute-cost-warning">
        <TriangleAlert size={17} aria-hidden="true" />
        <p id={costId}>Iniciar este compute puede generar costes en OCI.</p>
      </div>
    </>
  );
}
