import { storageKey } from "../../shared/identity";
import {
  resumeConfigurationDraft,
  type ConfigStep,
} from "./configurationDraft";
import type {
  ConfigurationDraft,
  CredentialFiles,
  DiscoverySelection,
} from "./discovery";

export function readConfigurationStep(): ConfigStep {
  try {
    const saved = Number(
      sessionStorage.getItem(storageKey("agent-desk.configuration-step")),
    );
    return saved === 1 || saved === 2 || saved === 3 ? saved : 0;
  } catch {
    return 0;
  }
}

export function storeConfigurationStep(step: ConfigStep) {
  try {
    sessionStorage.setItem(
      storageKey("agent-desk.configuration-step"),
      String(step),
    );
  } catch {
    /* The form remains usable without browser storage. */
  }
}

export function pendingConfiguration(saved: ConfigurationDraft) {
  try {
    const resumed = resumeConfigurationDraft(
      saved,
      sessionStorage.getItem(storageKey("agent-desk.configuration-selection")),
    );
    if (
      saved.connection_managed &&
      (resumed.profile !== saved.profile ||
        resumed.compartment_id !== saved.compartment_id)
    )
      return saved;
    return resumed;
  } catch {
    return saved;
  }
}

export function storeConfigurationSelection(
  draft: ConfigurationDraft | undefined,
  selection: DiscoverySelection,
  restoring: boolean,
  files: CredentialFiles,
) {
  if (restoring || !draft?.has_credentials || files.config || files.key) return;
  try {
    sessionStorage.setItem(
      storageKey("agent-desk.configuration-selection"),
      JSON.stringify({
        connection: JSON.stringify([draft.profile, draft.compartment_id]),
        selection,
      }),
    );
  } catch {
    /* Credentials are never stored in browser storage. */
  }
}

export function clearConfigurationSelection() {
  try {
    sessionStorage.removeItem(storageKey("agent-desk.configuration-selection"));
    sessionStorage.removeItem(storageKey("agent-desk.configuration-step"));
  } catch {
    /* Browser storage may be unavailable. */
  }
}
