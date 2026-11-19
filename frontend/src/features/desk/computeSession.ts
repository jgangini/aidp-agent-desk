import {
  computeRequest,
  ComputeRequestError,
  computePending,
  isComputeActive,
  isComputeStartable,
  type AgentCompute,
  type ComputeContext,
  type ComputeStatus,
} from "./computeApi";

export interface ComputeView {
  key: string;
  status: ComputeStatus | null;
  error: string;
  startRejection: string;
  reading: boolean;
  submitting: boolean;
  pendingCompute: string | undefined;
  timedOut: boolean;
}
interface StartIntent {
  requestId: string;
  computeId: string;
  rejection?: string;
  uncertain: boolean;
}
export const initialComputeView = (key: string): ComputeView => ({
  key,
  status: null,
  error: "",
  startRejection: "",
  reading: true,
  submitting: false,
  pendingCompute: undefined,
  timedOut: false,
});
function intentSettled(intent: StartIntent | undefined, status: ComputeStatus) {
  if (!intent)
    return status.computes.length > 0 && status.computes.every(isComputeActive);
  const compute = status.computes.find(
    (entry) => entry.id === intent.computeId,
  );
  if (!compute) return false;
  return (
    isComputeActive(compute) ||
    (!!intent.rejection && isComputeStartable(compute))
  );
}
const errorText = (reason: unknown, fallback: string) =>
  reason instanceof Error ? reason.message : fallback;

/** One session owns its intent, cancellation, snapshot and polling deadline. */
export class ComputeSession {
  private controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  private deadline?: number;
  private intent?: StartIntent;
  private computeIds = new Set<string>();
  private view: ComputeView;
  constructor(
    readonly context: ComputeContext,
    readonly key: string,
    private publish: (view: ComputeView) => void,
  ) {
    this.view = initialComputeView(key);
  }
  private get active() {
    return !this.controller.signal.aborted;
  }
  private update(patch: Partial<ComputeView>) {
    if (!this.active) return;
    this.view = { ...this.view, ...patch };
    this.publish(this.view);
  }
  mount() {
    this.publish(this.view);
    window.addEventListener("agent-desk-session-changed", this.stop);
    window.addEventListener(
      "agent-desk-compute-status-changed",
      this.sharedChange,
    );
    void this.refresh();
  }
  dispose() {
    this.stop();
    window.removeEventListener("agent-desk-session-changed", this.stop);
    window.removeEventListener(
      "agent-desk-compute-status-changed",
      this.sharedChange,
    );
  }
  private stop = () => {
    this.controller.abort();
    clearTimeout(this.timer);
  };
  private sharedChange = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    if (event.detail?.origin === this.key) return;
    if (this.computeIds.has(event.detail?.id)) void this.refresh();
  };
  private schedule() {
    clearTimeout(this.timer);
    this.deadline ??= Date.now() + 15 * 60_000;
    if (Date.now() >= this.deadline) {
      this.update({ timedOut: true });
      return;
    }
    this.timer = setTimeout(() => void this.refresh(), 5000);
  }
  private accept(status: ComputeStatus) {
    if (!this.active) return;
    this.computeIds = new Set(status.computes.map((compute) => compute.id));
    const settled = intentSettled(this.intent, status);
    const rejection = settled ? this.intent?.rejection : undefined;
    if (settled) {
      this.intent = undefined;
      this.deadline = undefined;
    }
    this.update({
      status,
      reading: false,
      error: "",
      pendingCompute: this.intent?.computeId,
      startRejection: rejection ?? this.view.startRejection,
      timedOut: settled ? false : this.view.timedOut,
    });
    if (computePending(status) || this.intent?.uncertain) this.schedule();
    else clearTimeout(this.timer);
  }
  async refresh() {
    if (!this.active) return;
    clearTimeout(this.timer);
    this.update({ reading: true });
    try {
      this.accept(await computeRequest(this.context, this.controller.signal));
    } catch (reason) {
      this.update({
        reading: false,
        error: errorText(reason, "No se pudo consultar el compute."),
      });
    }
  }
  private startAllowed(compute: AgentCompute) {
    if (!this.active || this.intent) return false;
    if (this.view.reading || this.view.error || this.view.submitting)
      return false;
    return isComputeStartable(compute);
  }
  private startFailed(reason: unknown) {
    if (!this.active || !this.intent) return;
    this.intent.uncertain = true;
    const message = errorText(reason, "No se pudo confirmar el inicio.");
    if (
      reason instanceof ComputeRequestError &&
      [409, 422].includes(reason.status)
    ) {
      this.intent.rejection = message;
    }
    this.update({
      error: `${message} Se consultará el estado sin repetir el inicio.`,
    });
    this.schedule();
  }
  private startFinished(computeId: string) {
    if (!this.active) return;
    this.update({ submitting: false });
    window.dispatchEvent(
      new CustomEvent("agent-desk-compute-status-changed", {
        detail: { id: computeId, origin: this.key },
      }),
    );
  }
  async start(compute: AgentCompute, requestId: string, confirmation: string) {
    if (!this.startAllowed(compute)) return;
    this.intent = {
      computeId: compute.id,
      requestId,
      uncertain: false,
    };
    clearTimeout(this.timer);
    this.update({
      submitting: true,
      pendingCompute: compute.id,
      error: "",
      startRejection: "",
    });
    try {
      this.accept(
        await computeRequest(this.context, this.controller.signal, {
          compute_id: compute.id,
          compute_name: compute.name,
          request_id: requestId,
          confirmed: true,
          confirmation,
        }),
      );
    } catch (reason) {
      this.startFailed(reason);
    } finally {
      this.startFinished(compute.id);
    }
  }
}
