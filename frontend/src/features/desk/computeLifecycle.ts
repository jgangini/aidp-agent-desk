import { useEffect, useRef, useState } from "react";
import { ComputeSession, initialComputeView } from "./computeSession";
import type { AgentCompute, ComputeContext } from "./computeApi";
export type { AgentCompute, ComputeContext, ComputeStatus } from "./computeApi";

export function useComputeControl(context: ComputeContext) {
  const key = JSON.stringify([
    context.compartment_id,
    context.instance_id,
    context.workspace_id,
    context.agent_id,
  ]);
  const current = useRef<ComputeSession | null>(null);
  const [view, setView] = useState(() => initialComputeView(key));
  useEffect(() => {
    const session = new ComputeSession(context, key, setView);
    current.current = session;
    session.mount();
    return () => {
      session.dispose();
      if (current.current === session) current.current = null;
    };
  }, [key]);
  const start = async (
    compute: AgentCompute,
    requestId: string,
    confirmation: string,
  ) => {
    if (current.current?.key === key)
      await current.current.start(compute, requestId, confirmation);
  };
  return {
    ...view,
    status: view.key === key ? view.status : null,
    start,
    refresh: () =>
      current.current?.key === key && void current.current.refresh(),
  };
}
