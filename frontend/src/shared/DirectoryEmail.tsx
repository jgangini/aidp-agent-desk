import { useEffect, useId, useRef, useState } from "react";
import { apiFetch, useIdentity } from "./identity";

export function DirectoryEmail({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (email: string) => void;
  disabled?: boolean;
}) {
  const identity = useIdentity();
  const allowed = identity.hosted && identity.authenticated && identity.admin;
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const query = value.trim();
  useEffect(() => {
    setEmails([]);
    setActive(-1);
    setError("");
    setSearched(false);
    setLoading(false);
    if (!allowed || disabled || !open || query.length < 2 || query.length > 254)
      return;
    const controller = new AbortController();
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void apiFetch(
        `/api/admin/directory-users?q=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      )
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const result: unknown = await response.json();
          if (
            !Array.isArray(result) ||
            result.some(
              (item) =>
                typeof item?.email !== "string" ||
                !item.email ||
                item.email.length > 254,
            )
          )
            throw new Error();
          if (current) {
            setEmails(
              [
                ...new Set(result.map((item: { email: string }) => item.email)),
              ].slice(0, 20),
            );
            setSearched(true);
          }
        })
        .catch(() => {
          if (current)
            setError(
              "No se pudieron consultar los correos. Reintenta la búsqueda.",
            );
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, allowed, disabled, open]);
  useEffect(() => {
    if (active >= 0)
      list.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  const expanded = open && emails.length > 0;
  function choose(email: string) {
    onChange(email);
    setOpen(false);
    setActive(-1);
  }
  return (
    <div className="users-email users-directory-email">
      <label htmlFor={id}>Correo electrónico</label>
      <input
        id={id}
        className="t-input"
        type="email"
        required
        maxLength={254}
        autoComplete="off"
        value={value}
        disabled={disabled || !allowed}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? `${id}-list` : undefined}
        aria-activedescendant={
          expanded && active >= 0 ? `${id}-option-${active}` : undefined
        }
        aria-describedby={error ? `${id}-error` : undefined}
        aria-busy={loading}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && (expanded || loading)) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          } else if (event.key === "Tab") setOpen(false);
          else if (
            expanded &&
            ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
          ) {
            event.preventDefault();
            setActive(
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? emails.length - 1
                  : event.key === "ArrowDown"
                    ? (active + 1) % emails.length
                    : active < 0
                      ? emails.length - 1
                      : (active - 1 + emails.length) % emails.length,
            );
          } else if (event.key === "Enter" && expanded && active >= 0) {
            event.preventDefault();
            choose(emails[active]);
          }
        }}
      />
      {expanded && (
        <div
          ref={list}
          id={`${id}-list`}
          className="users-email-options"
          role="listbox"
          aria-label="Correos del dominio Oracle"
        >
          {emails.map((email, index) => (
            <div
              id={`${id}-option-${index}`}
              key={email}
              role="option"
              aria-selected={index === active}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(email)}
            >
              {email}
            </div>
          ))}
        </div>
      )}
      {open && loading && (
        <p className="users-help" role="status">
          Buscando correos…
        </p>
      )}
      {open && searched && !emails.length && (
        <p className="users-help" role="status">
          No hay sugerencias para esta búsqueda.
        </p>
      )}
      {error && (
        <p
          id={`${id}-error`}
          className="config-feedback users-error"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
