import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  validateConfigurationDraft,
  type FieldErrors,
} from "./configurationDraft";
import type { CredentialKind } from "./credentialFiles";
import type { CredentialFiles } from "./discovery";

function shake(input: HTMLElement | null) {
  if (!input) return;
  input.classList.remove("is-shaking");
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  void input.offsetWidth;
  input.classList.add("is-shaking");
}

type ValidationInput = Omit<
  Parameters<typeof validateConfigurationDraft>[0],
  "files" | "fieldErrors"
>;

export function useConfigurationFields(surface: RefObject<HTMLElement | null>) {
  const [files, setFiles] = useState<CredentialFiles>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const pendingShake = useRef(new Set<keyof FieldErrors>());
  useEffect(() => {
    if (!files.config && !files.key) return;
    const protectUploads = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUploads);
    return () => window.removeEventListener("beforeunload", protectUploads);
  }, [files.config, files.key]);
  useLayoutEffect(() => {
    for (const name of pendingShake.current) {
      const input = surface.current?.querySelector<
        HTMLInputElement | HTMLSelectElement
      >(`[name="${name}"]`);
      if (input)
        shake(
          input instanceof HTMLInputElement && input.type === "file"
            ? input.closest("label")
            : input,
        );
    }
    pendingShake.current.clear();
  }, [errors]);
  const report = (name: keyof FieldErrors, message: string) => {
    pendingShake.current.add(name);
    setErrors((current) => ({ ...current, [name]: message }));
  };
  const validate = (form: HTMLFormElement, input: ValidationInput) => {
    const invalid = validateConfigurationDraft({
      ...input,
      files,
      fieldErrors: errors,
    });
    setErrors(invalid);
    const firstInvalid = Object.keys(invalid)[0];
    if (!firstInvalid) return true;
    for (const name of Object.keys(invalid))
      pendingShake.current.add(name as keyof FieldErrors);
    (form.elements.namedItem(firstInvalid) as HTMLElement | null)?.focus();
    return false;
  };
  return {
    files,
    errors,
    report,
    validate,
    clearFiles: () => setFiles({}),
    clearErrors: () => setErrors({}),
    selectFile: (kind: CredentialKind, file: File) => {
      setFiles((current) => ({ ...current, [kind]: file }));
      setErrors((current) => ({
        config: current.config,
        key: current.key,
        [kind]: "",
      }));
    },
    selectField: () =>
      setErrors((current) => ({ config: current.config, key: current.key })),
    toggleAgent: () => setErrors((current) => ({ ...current, agent_ids: "" })),
    onAnimationEnd: (event: React.AnimationEvent) => {
      if (event.animationName === "agent-config-shake")
        (event.target as HTMLElement).classList.remove("is-shaking");
    },
  };
}
