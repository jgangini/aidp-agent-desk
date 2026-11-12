import { apiFetch as fetch } from "../../shared/identity";
import { deskHeaders } from "./deskHttp";
import type { ConfigurationDraft } from "./discovery";
import { configSteps } from "./configurationDraft";

export async function readConfigurationDraft(signal: AbortSignal) {
  const response = await fetch("/api/desk/discovery/draft/read", {
    method: "POST",
    headers: deskHeaders,
    signal,
  });
  if (!response.ok)
    throw new Error("No se pudo recuperar la configuración guardada.");
  return (await response.json()) as ConfigurationDraft;
}

export async function clearConfigurationSection(step: 1 | 2) {
  const section: "agents" | "audio" = step === 1 ? "agents" : "audio";
  const response = await fetch("/api/desk/discovery/draft/clear", {
    method: "POST",
    headers: { ...deskHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ step: section }),
  });
  if (!response.ok)
    throw new Error(
      `No se pudo limpiar ${configSteps[step]}. Inténtalo de nuevo.`,
    );
  return { section, draft: (await response.json()) as ConfigurationDraft };
}

export async function deleteConfigurationDraft() {
  const response = await fetch("/api/desk/discovery/draft", {
    method: "DELETE",
    headers: deskHeaders,
  });
  if (!response.ok)
    throw new Error("No se pudo eliminar la conexión. Inténtalo de nuevo.");
}
