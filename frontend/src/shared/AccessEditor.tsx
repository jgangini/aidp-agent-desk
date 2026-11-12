import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Check, Pencil, Plus, X } from "lucide-react";
import { apiFetch as fetch, useIdentity } from "./identity";
import { SelectValue } from "./SelectValue";
import { DirectoryEmail } from "./DirectoryEmail";
import "./UsersPanel.css";

interface Member {
  id: string;
  subject: string;
  email: string;
  role: string;
  enabled: boolean;
  profiles: string[];
}
interface Profile {
  id: string;
  name: string;
}
interface Management {
  directory_available: boolean;
  allow_create: boolean;
}

async function checked(response: Response) {
  if (response.ok) return response;
  const body = await response.json().catch(() => null);
  throw new Error(
    typeof body?.detail === "string"
      ? body.detail
      : "No se pudo completar la solicitud. Inténtalo otra vez.",
  );
}

export function AccessEditor({
  onClose,
  branding,
}: {
  onClose: () => void;
  branding?: ReactNode;
}) {
  const identity = useIdentity();
  return identity.hosted && identity.authenticated && identity.admin ? (
    <UsersPanel onClose={onClose} branding={branding} />
  ) : null;
}

function UsersPanel({
  onClose,
  branding,
}: {
  onClose: () => void;
  branding?: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [management, setManagement] = useState<Management>();
  const [dialog, setDialog] = useState<{
    member?: Member;
    trigger: HTMLButtonElement;
  }>();
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  async function load() {
    const responses = await Promise.all([
      fetch("/api/admin/users").then(checked),
      fetch("/api/desk/profiles").then(checked),
      fetch("/api/admin/user-management").then(checked),
    ]);
    const [users, agents, options] = await Promise.all(
      responses.map((response) => response.json()),
    );
    setMembers(users);
    setProfiles(agents);
    setManagement(options);
    setRefreshNeeded(false);
  }
  async function refresh() {
    setBusy(true);
    setNotice("");
    try {
      await load();
    } catch {
      setError(true);
      setRefreshNeeded(true);
      setNotice(
        "No se pudo actualizar la lista de usuarios. Reintenta la carga.",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    heading.current?.focus();
    void refresh();
  }, []);
  async function afterSaved() {
    setBusy(true);
    setError(false);
    setNotice("");
    try {
      await load();
      setNotice("Permisos guardados. El usuario debe volver a iniciar sesión.");
    } catch {
      setError(true);
      setRefreshNeeded(true);
      setNotice(
        "Los permisos se guardaron, pero no se pudo actualizar la lista. Reintenta la carga.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="users-panel"
      id="users-panel"
      aria-labelledby="users-heading"
      aria-busy={busy}
      data-tooltip-disabled="true"
    >
      <header className="users-heading">
        {branding}
        <div className="users-heading-tools">
          <h1
            className="sr-only"
            id="users-heading"
            ref={heading}
            tabIndex={-1}
          >
            Usuarios
          </h1>
          <button
            type="button"
            className="icon-button"
            aria-label="Agregar usuario"
            disabled={busy || !management?.directory_available}
            onClick={(event) => setDialog({ trigger: event.currentTarget })}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Cerrar usuarios"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="users-body">
        <p className="users-intro">
          Habilita usuarios de tu organización y elige qué agentes pueden
          utilizar.
        </p>
        {management && !management.directory_available && (
          <p className="config-feedback" role="status">
            La búsqueda de usuarios del dominio no está disponible. Puedes
            editar los usuarios ya habilitados.
          </p>
        )}
        {notice && (
          <div
            className={`config-feedback${error ? " users-error" : " users-success"}`}
            role={error ? "alert" : "status"}
          >
            <p>{notice}</p>
            {refreshNeeded && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Reintentar carga
              </button>
            )}
          </div>
        )}
        <UsersList
          members={members}
          profiles={profiles}
          busy={busy}
          loading={!management}
          onEdit={(member, trigger) => setDialog({ member, trigger })}
        />
      </div>
      {dialog && (
        <UserAccessDialog
          member={dialog.member}
          allowCreate={management?.allow_create === true}
          profiles={profiles}
          onSaved={afterSaved}
          onClose={() => setDialog(undefined)}
          returnFocus={dialog.trigger}
        />
      )}
    </section>
  );
}
function UsersList({
  members,
  profiles,
  busy,
  loading,
  onEdit,
}: {
  members: Member[];
  profiles: Profile[];
  busy: boolean;
  loading: boolean;
  onEdit: (member: Member, trigger: HTMLButtonElement) => void;
}) {
  return (
    <section className="users-list">
      {busy && loading && <p role="status">Cargando usuarios…</p>}
      {!busy && !loading && !members.length && (
        <p>No hay usuarios registrados.</p>
      )}
      <div
        className="users-table-scroll"
        role="region"
        aria-label="Tabla de usuarios"
        tabIndex={0}
      >
        <table aria-label="Usuarios">
          <thead>
            <tr>
              <th scope="col">Usuario</th>
              <th scope="col">Acceso</th>
              <th scope="col">Agentes</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <MemberRow
                key={member.id || member.subject}
                member={member}
                profiles={profiles}
                busy={busy}
                onEdit={onEdit}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MemberRow({
  member,
  profiles,
  busy,
  onEdit,
}: {
  member: Member;
  profiles: Profile[];
  busy: boolean;
  onEdit: (member: Member, trigger: HTMLButtonElement) => void;
}) {
  const administrator = member.role === "admin";
  const label = member.email || "Cuenta sin correo";
  const agents = member.profiles
    .map(
      (id) => profiles.find((p) => p.id === id)?.name ?? "Agente no disponible",
    )
    .join(", ");
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>
        {administrator
          ? "Administrador"
          : member.enabled
            ? "Habilitado"
            : "Deshabilitado"}
      </td>
      <td>
        {administrator
          ? "Acceso a todos los agentes"
          : agents || "Sin agentes permitidos"}
      </td>
      <td className="users-row-actions">
        {!administrator && (
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label={`Editar permisos de ${label}`}
            onClick={(event) => onEdit(member, event.currentTarget)}
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
        )}
      </td>
    </tr>
  );
}

function AllowedAgents({
  profiles,
  selected,
  onChange,
}: {
  profiles: Profile[];
  selected: string[];
  onChange: (profiles: string[]) => void;
}) {
  return (
    <fieldset className="users-agents config-agent-choices t-input field-wide">
      <legend>Agent Flow</legend>
      <div
        className="config-agent-options"
        role="group"
        aria-label="Agent Flow"
      >
        {profiles.map((profile) => (
          <label className="config-agent-choice" key={profile.id}>
            <input
              type="checkbox"
              checked={selected.includes(profile.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, profile.id]
                    : selected.filter((id) => id !== profile.id),
                )
              }
            />
            <Check
              className="config-agent-check"
              size={12}
              aria-hidden="true"
            />
            <span className="config-agent-copy">
              <strong>{profile.name}</strong>
            </span>
          </label>
        ))}
        {!profiles.length && (
          <p className="users-help">No hay agentes configurados.</p>
        )}
      </div>
    </fieldset>
  );
}

function UserAccessDialog({
  member,
  allowCreate,
  profiles,
  onSaved,
  onClose,
  returnFocus,
}: {
  member?: Member;
  allowCreate: boolean;
  profiles: Profile[];
  onSaved: () => Promise<void>;
  onClose: () => void;
  returnFocus: HTMLButtonElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState("");
  const [enabled, setEnabled] = useState(member?.enabled ?? true);
  const [selected, setSelected] = useState(member?.profiles ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current
      ?.querySelector<HTMLElement>(member ? "select" : "input")
      ?.focus();
    return () => {
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await checked(
        await fetch("/api/admin/users", {
          method: member ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Desk": "configure",
          },
          body: JSON.stringify(
            member
              ? {
                  subject: member.subject,
                  email: member.email,
                  enabled,
                  profiles: selected,
                }
              : {
                  email: email.trim(),
                  profiles: selected,
                  create_in_directory: allowCreate,
                },
          ),
        }),
      );
      await onSaved();
      dialog.current?.close();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "No se pudieron guardar los permisos.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="users-edit-dialog"
      aria-labelledby="users-edit-title"
      aria-busy={busy}
      data-tooltip-disabled="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) dialog.current?.close();
      }}
      onClose={() => {
        onClose();
      }}
    >
      <h2 id="users-edit-title">
        {member ? "Editar permisos" : "Agregar usuario"}
      </h2>
      <form className="users-edit-form" onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy}>
          <div
            className={`config-fields users-email-fields${member ? " users-edit-fields" : ""}`}
          >
            {member ? (
              <>
                <label>
                  Correo electrónico
                  <input
                    className="t-input"
                    type="email"
                    value={member.email}
                    readOnly
                    placeholder={
                      !member.email ? "Cuenta sin correo" : undefined
                    }
                  />
                </label>
                <label>
                  Acceso
                  <select
                    className="t-input"
                    value={enabled ? "enabled" : "disabled"}
                    onChange={(event) =>
                      setEnabled(event.target.value === "enabled")
                    }
                  >
                    <SelectValue />
                    <option value="enabled">Habilitado</option>
                    <option value="disabled">Deshabilitado</option>
                  </select>
                </label>
              </>
            ) : (
              <DirectoryEmail
                value={email}
                onChange={setEmail}
                disabled={busy}
              />
            )}
          </div>
          {!member && allowCreate && (
            <p className="users-help" role="status">
              Si la cuenta no existe, se creará en Oracle y se enviará una
              invitación.
            </p>
          )}
          <div className="config-fields users-choice-fields">
            <AllowedAgents
              profiles={profiles}
              selected={selected}
              onChange={setSelected}
            />
          </div>
          {error && (
            <p className="config-feedback users-error" role="alert">
              {error}
            </p>
          )}
          <footer className="users-form-actions">
            <button
              type="button"
              className="config-cancel"
              onClick={() => dialog.current?.close()}
            >
              Cancelar
            </button>
            <button type="submit" className="save-profile">
              {busy ? "Guardando…" : "Guardar"}
            </button>
          </footer>
        </fieldset>
      </form>
    </dialog>
  );
}
