import { useLayoutEffect, useMemo, useRef, useState } from "react";

type Notice = { kind: "warning" | "error"; message: string };

export function useChatNotice(
  agent: string,
  conversation: string | undefined,
  configuring: boolean,
) {
  const scope = useMemo(() => ({}), [agent, conversation, configuring]);
  const current = useRef<object | null>(scope);
  current.current = scope;
  useLayoutEffect(() => {
    current.current = scope;
    return () => {
      if (current.current === scope) current.current = null;
    };
  }, [scope]);
  const [state, setState] = useState<{ scope: object; notice: Notice }>();
  const actions = useMemo(() => {
    const isCurrent = () => current.current === scope;
    const show = (message: string, kind: Notice["kind"]) => {
      if (isCurrent())
        setState(message ? { scope, notice: { kind, message } } : undefined);
    };
    return {
      isCurrent,
      error: (message: string) => show(message, "error"),
      warning: (message: string) => show(message, "warning"),
      clear: () => {
        if (isCurrent()) setState(undefined);
      },
      clearWarning: () => {
        if (isCurrent())
          setState((previous) =>
            previous?.notice.kind === "warning" ? undefined : previous,
          );
      },
    };
  }, [scope]);
  return {
    notice: state?.scope === scope ? state.notice : undefined,
    ...actions,
  };
}
