import { z } from "zod";
import { apiFetch } from "../../shared/identity";
import { deskHeaders } from "./deskHttp";

export interface ComputeContext {
  compartment_id: string;
  instance_id: string;
  workspace_id: string;
  agent_id: string;
}
const targetSchema = z.object({
  agent_id: z.string(),
  name: z.string(),
  surface: z.enum(["PROD", "TEST"]),
});
const computeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  state: z.string(),
  targets: z.array(targetSchema),
  can_start: z.boolean(),
  operation: z.enum(["idle", "starting", "uncertain"]),
  message: z.string(),
  confirmation: z.string().regex(/^[a-f0-9]{64}$/),
});
const inventorySchema = z.object({
  computes: z.array(computeSchema),
  warning: z.string().optional(),
});
const errorSchema = z.object({ detail: z.string() });
export type AgentCompute = z.infer<typeof computeSchema>;
export type ComputeStatus = z.infer<typeof inventorySchema>;
export interface StartConfirmation {
  compute_id: string;
  compute_name: string;
  request_id: string;
  confirmed: true;
  confirmation: string;
}
export class ComputeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function computeRequest(
  context: ComputeContext,
  signal: AbortSignal,
  confirmation?: StartConfirmation,
): Promise<ComputeStatus> {
  const response = await apiFetch(
    `/api/desk/discovery/compute/${confirmation ? "start" : "status"}`,
    {
      method: "POST",
      headers: { ...deskHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ...context, ...confirmation }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorSchema.safeParse(body);
    throw new ComputeRequestError(
      error.success ? error.data.detail : "No se pudo consultar el compute.",
      response.status,
    );
  }
  const result = inventorySchema.safeParse(body);
  if (!result.success)
    throw new Error("La respuesta del compute no es válida.");
  return result.data;
}
export const isComputeActive = (compute: AgentCompute) =>
  compute.state === "ACTIVE" && compute.operation === "idle";
export const isComputeStartable = (compute: AgentCompute) =>
  compute.state === "STOPPED" &&
  compute.operation === "idle" &&
  compute.can_start;
export const computePending = (status: ComputeStatus) =>
  status.computes.some(
    (compute) =>
      compute.operation !== "idle" ||
      ["STARTING", "CREATING"].includes(compute.state),
  );
