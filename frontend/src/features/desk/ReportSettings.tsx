import { useEffect, useRef, useState } from "react";
import { apiFetch, useIdentity } from "../../shared/identity";
import { deskHeaders } from "./deskHttp";
import { profileIdentity } from "./agentTarget";
import type { AgentProfile } from "./profiles";
import "./ReportSettings.css";

interface Settings {
  prod: boolean;
  test: boolean;
}

async function reportSettings(
  identity: string,
  signal: AbortSignal,
  value?: Settings,
): Promise<Settings> {
  if (!/^[a-f0-9]{32}$/.test(identity))
    throw new Error("Selecciona un Agent Flow guardado.");
  const response = await apiFetch(`/api/desk/profiles/${identity}/reports`, {
    method: value ? "PUT" : "GET",
    headers: value
      ? { ...deskHeaders, "Content-Type": "application/json" }
      : undefined,
    body: value ? JSON.stringify(value) : undefined,
    signal,
  });
  if (!response.ok)
    throw new Error("No se pudo actualizar la configuración de informes.");
  const saved = (await response.json()) as Settings;
  if (typeof saved.prod !== "boolean" || typeof saved.test !== "boolean")
    throw new Error("La configuración de informes no es válida.");
  return saved;
}

export function ReportSettings({ profiles }: { profiles: AgentProfile[] }) {
  const identity = useIdentity();
  if (!identity.admin || (identity.hosted && !identity.authenticated))
    return null;
  const saved = profiles.filter((profile) => /^[a-f0-9]{32}$/.test(profile.id));
  if (!saved.length) return null;
  return (
    <section className="report-settings" aria-label="Entrega de informes">
      <h3>Entrega de informes</h3>
      <p className="scheduled-help">
        Habilita sólo los Agent Flows compatibles con el formato de informes de
        Desk. Cada opción se guarda al cambiarla.
      </p>
      {saved.map((profile) => (
        <ProfileReportSettings key={profile.id} profile={profile} />
      ))}
    </section>
  );
}

function ProfileReportSettings({ profile }: { profile: AgentProfile }) {
  const [value, setValue] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    void reportSettings(profile.id, controller.signal)
      .then((saved) => {
        if (!controller.signal.aborted) setValue(saved);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => request.current?.abort();
  }, [profile.id]);
  const change = async (surface: keyof Settings, enabled: boolean) => {
    if (!value || busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const saved = await reportSettings(profile.id, controller.signal, {
        ...value,
        [surface]: enabled,
      });
      if (!controller.signal.aborted) setValue(saved);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "No se pudo guardar.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  const testing =
    profile.surface === "TEST" ||
    !!(profile.instance_id && profile.workspace_id);
  return (
    <fieldset
      className="report-settings-profile"
      aria-busy={(!value && !error) || busy}
    >
      <legend>{profile.name}</legend>
      {(["prod", "test"] as const).map((surface) => (
        <label key={surface}>
          <input
            type="checkbox"
            aria-label={`Informes ${surface.toUpperCase()} de ${profile.name}`}
            checked={value?.[surface] ?? false}
            disabled={
              !value ||
              busy ||
              (surface === "prod" ? profile.surface === "TEST" : !testing)
            }
            onChange={(event) => void change(surface, event.target.checked)}
          />
          {surface.toUpperCase()}
        </label>
      ))}
      {error && (
        <p className="config-feedback config-feedback-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function ReportEnableAction({
  agentId,
  onEnabled,
}: {
  agentId: string;
  onEnabled: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const enable = async () => {
    if (busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const identity = profileIdentity(agentId);
      const current = await reportSettings(identity, controller.signal);
      await reportSettings(identity, controller.signal, {
        ...current,
        [agentId.startsWith("test:") ? "test" : "prod"]: true,
      });
      if (!controller.signal.aborted) await onEnabled();
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "No se pudo habilitar.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <div className="report-enable-action" aria-busy={busy}>
      <p className="scheduled-help">
        Confirma que este Agent Flow entrega informes compatibles con Desk.
        Después podrás guardar la tarea.
      </p>
      <button
        type="button"
        className="report-action"
        disabled={busy}
        onClick={() => void enable()}
      >
        {busy ? "Habilitando…" : "Habilitar informes"}
      </button>
      {error && (
        <p role="alert" className="config-feedback config-feedback-error">
          {error}
        </p>
      )}
    </div>
  );
}
