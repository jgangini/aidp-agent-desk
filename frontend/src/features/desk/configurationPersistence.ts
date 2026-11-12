import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from "react";
import {
  discoveryPost,
  type ConfigurationDraft,
  type CredentialFiles,
  type DiscoverySelection,
  type useDiscovery,
} from "./discovery";
import {
  configSteps,
  configurationDraftFields,
  savedConfigurationSteps,
  type ConfigStep,
} from "./configurationDraft";
import {
  clearConfigurationSection,
  deleteConfigurationDraft,
  readConfigurationDraft,
} from "./configurationIO";
import {
  clearConfigurationSelection,
  pendingConfiguration,
  storeConfigurationSelection,
} from "./configurationUIStorage";

export interface ConfigurationDraftState {
  draft: ConfigurationDraft | undefined;
  setDraft: Dispatch<SetStateAction<ConfigurationDraft | undefined>>;
  setSavedSteps: Dispatch<SetStateAction<ConfigStep[]>>;
  restoring: boolean;
  setRestoring: Dispatch<SetStateAction<boolean>>;
  edited: { current: boolean };
}

export interface ConfigurationOperation {
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
}

export function useConfigurationRestore({
  files,
  selection,
  restore,
  state,
  setError,
  onManagedConnection,
  onConnectionMode,
}: {
  files: CredentialFiles;
  selection: DiscoverySelection;
  restore: (draft: ConfigurationDraft, signal: AbortSignal) => Promise<void>;
  state: ConfigurationDraftState;
  setError: ConfigurationOperation["setError"];
  onManagedConnection: () => void;
  onConnectionMode: (managed: boolean) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [readFailed, setReadFailed] = useState(false);
  const { draft, restoring, edited, setDraft, setSavedSteps, setRestoring } =
    state;
  useEffect(() => {
    const controller = new AbortController();
    setReadFailed(false);
    setError("");
    void (async () => {
      try {
        const saved = await readConfigurationDraft(controller.signal);
        if (controller.signal.aborted) return;
        const managed = saved.connection_managed === true;
        onConnectionMode(managed);
        if (edited.current && !managed) return;
        if (managed) onManagedConnection();
        setDraft(saved);
        setSavedSteps(savedConfigurationSteps(saved));
        if (saved.has_credentials) setRestoring(true);
        await restore(pendingConfiguration(saved), controller.signal);
      } catch (reason) {
        if (!controller.signal.aborted) {
          setReadFailed(true);
          setError(
            reason instanceof Error
              ? reason.message
              : "No se pudo recuperar la configuración.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setRestoring(false);
      }
    })();
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    storeConfigurationSelection(draft, selection, restoring, files);
  }, [selection, draft, restoring, files.config, files.key]);
  return {
    retry: readFailed ? () => setAttempt((current) => current + 1) : undefined,
  };
}

export function useConfigurationSave({
  files,
  selection,
  state,
  operation,
  clearFiles,
  selected,
  onSaved,
  onSelect,
}: {
  files: CredentialFiles;
  selection: DiscoverySelection;
  state: ConfigurationDraftState;
  operation: ConfigurationOperation;
  clearFiles: () => void;
  selected: string;
  onSaved: () => Promise<void>;
  onSelect: (id: string) => void;
}) {
  const importing = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      importing.current?.abort();
    },
    [],
  );
  const { draft, setDraft, setSavedSteps } = state;
  const { setBusy, setError, setNotice } = operation;
  const persist = async (step: Exclude<ConfigStep, 3>) => {
    setBusy(true);
    const controller = new AbortController();
    importing.current = controller;
    try {
      const result = await discoveryPost<ConfigurationDraft>(
        "draft",
        files,
        configurationDraftFields(step, selection, draft),
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setDraft(result);
      setSavedSteps((previous) => [...new Set([...previous, step])]);
      if (step === 0) clearFiles();
      if (step > 0) {
        await onSaved();
        if (result.profiles.length) onSelect(result.profiles[0].id);
        else if (draft?.profiles.some((item) => item.id === selected))
          onSelect("demo");
      }
      setNotice(
        step === 0 ? "Conexión guardada." : `${configSteps[step]} guardado.`,
      );
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "No se pudo guardar la configuración.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return { persist, abort: () => importing.current?.abort() };
}

export async function cancelConfiguration({
  step,
  state,
  operation,
  discovery,
  abortSave,
  clearFiles,
  clearErrors,
  resetSteps,
  cancelDialog,
  onSaved,
}: {
  step: ConfigStep;
  state: ConfigurationDraftState;
  operation: ConfigurationOperation;
  discovery: Pick<
    ReturnType<typeof useDiscovery>,
    "cancel" | "clearSection" | "reset"
  >;
  abortSave: () => void;
  clearFiles: () => void;
  clearErrors: () => void;
  resetSteps: () => void;
  cancelDialog: RefObject<HTMLDialogElement | null>;
  onSaved: () => Promise<void>;
}) {
  const { edited, setDraft, setSavedSteps } = state;
  const { busy, setBusy, setError, setNotice } = operation;
  if (busy) return;
  setBusy(true);
  setError("");
  discovery.cancel();
  abortSave();
  try {
    if (step === 1 || step === 2) {
      const { section, draft: result } = await clearConfigurationSection(step);
      edited.current = true;
      setDraft(result);
      discovery.clearSection(section);
      setSavedSteps((previous) => previous.filter((saved) => saved !== step));
      clearErrors();
      setNotice(`${configSteps[step]} limpiado.`);
      await onSaved();
      cancelDialog.current?.close();
      return;
    }
    await deleteConfigurationDraft();
    edited.current = true;
    discovery.reset();
    setDraft(undefined);
    setSavedSteps([]);
    clearFiles();
    clearErrors();
    setNotice("");
    resetSteps();
    clearConfigurationSelection();
    cancelDialog.current?.close();
  } catch (reason) {
    setError(
      reason instanceof Error
        ? reason.message
        : "No se pudo eliminar la conexión.",
    );
  } finally {
    setBusy(false);
  }
}
