import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Heart, LogOut } from "lucide-react";
import { IdentityContext, setStoragePrincipal, apiFetch } from "./identity";
import "./AccountGate.css";

interface Session {
  mode: "local" | "oracle";
  user: { id: string; email: string; role: string } | null;
}

async function loadSession(): Promise<Session> {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  if (!response.ok) throw new Error();
  const value: Session = await response.json();
  if (!["oracle", "local"].includes(value.mode)) throw new Error();
  return value;
}

function useOracleSession() {
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let known: Session | undefined;
    let active = true;
    let refreshing = false;
    const reload = () => window.location.reload();
    const refresh = () => {
      if (refreshing) return;
      refreshing = true;
      void loadSession()
        .then((value) => {
          if (!active) return;
          if (
            known &&
            (known.mode !== value.mode || known.user?.id !== value.user?.id)
          ) {
            reload();
            return;
          }
          known = value;
          setStoragePrincipal(
            value.mode === "oracle" ? (value.user?.id ?? "signed-out") : "",
          );
          setSession(value);
          setError("");
          setBlocked(false);
        })
        .catch(() => {
          if (!active) return;
          setBlocked(true);
          setError(
            "No se pudo comprobar la sesión. Recarga la página para reintentar.",
          );
        })
        .finally(() => {
          refreshing = false;
        });
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("agent-desk-session-changed", reload);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("agent-desk-session-changed", reload);
    };
  }, []);
  return { session, blocked, error, setError };
}

export function AccountGate({ children }: { children: ReactNode }) {
  const { session, blocked, error, setError } = useOracleSession();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const hosted = session?.mode === "oracle";
  const authenticated = !!session?.user;
  async function logout() {
    setLeaving(true);
    try {
      const response = await apiFetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      window.location.replace("/");
    } catch {
      setLeaving(false);
      setOpen(true);
      setError("No se pudo cerrar la sesión. Inténtalo otra vez.");
    }
  }
  if (!session)
    return (
      <main className="account-loading" role="status">
        {error || "Comprobando acceso…"}
      </main>
    );
  const showAccount = open || (hosted && !authenticated);
  return (
    <IdentityContext.Provider
      value={{
        hosted,
        admin: !hosted || session.user?.role === "admin",
        authenticated,
        leaving,
        logout,
        openAccount: () => setOpen(true),
      }}
    >
      {(!hosted || authenticated) && (
        <div hidden={showAccount || blocked} key={session.user?.id ?? "local"}>
          {children}
        </div>
      )}
      {blocked && (
        <main className="account-loading" role="status">
          {error || "Comprobando acceso…"}
        </main>
      )}
      {showAccount && (
        <AccountPage
          session={session}
          hosted={hosted}
          authenticated={authenticated}
          leaving={leaving}
          error={error}
          onClose={() => setOpen(false)}
          logout={logout}
        />
      )}
    </IdentityContext.Provider>
  );
}

function AccountPage({
  session,
  hosted,
  authenticated,
  leaving,
  error,
  onClose,
  logout,
}: {
  session: Session;
  hosted: boolean;
  authenticated: boolean;
  leaving: boolean;
  error: string;
  onClose: () => void;
  logout: () => Promise<void>;
}) {
  return (
    <div className="account-page">
      <main className="account-layout">
        <section className="account-hero" aria-label="Agent Desk">
          <div className="account-hero-copy">
            <h1 aria-label="Agent Desk">
              <button
                className="desk-wordmark account-wordmark"
                aria-label="Ir al inicio"
                onClick={onClose}
              >
                <span>Agent </span>
                <span className="t-gradient-text">Desk</span>
              </button>
            </h1>
            <p className="account-tagline">Your Agent Flows, in one place.</p>
            <p>
              Conversa con los agentes publicados en Oracle AI Data Platform
              Agent Flows y consulta sus resultados desde Agent Desk.
            </p>
          </div>
        </section>
        <section className="account-content">
          <div className="account-oracle-brand">
            <img
              src="/icons/oracle/skill-icons-oracle-dark.svg"
              alt=""
              width="28"
              height="28"
            />
            <span>Oracle Cloud Infrastructure</span>
          </div>
          {authenticated && <h2>Mi cuenta</h2>}
          {authenticated ? (
            <>
              <p>{session.user!.email || "Cuenta Oracle"}</p>
              <button
                className="account-secondary"
                disabled={leaving}
                onClick={() => void logout()}
              >
                <LogOut size={17} />
                Cerrar sesión
              </button>
            </>
          ) : (
            <>
              <p>
                Inicia sesión con tu cuenta Oracle en la página de acceso de tu
                organización.
              </p>
              {new URLSearchParams(window.location.search).has("login") && (
                <p className="account-notice" role="alert">
                  No se pudo completar el acceso. Verifica tu cuenta y solicita
                  al administrador que te habilite.
                </p>
              )}
              <form action="/api/auth/login" method="post">
                <button
                  className="account-primary"
                  type="submit"
                  disabled={!hosted}
                >
                  Continuar con Oracle
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </form>
            </>
          )}
          {error && (
            <p className="account-notice" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
      <footer className="account-footer">
        Made with <Heart size={13} fill="currentColor" aria-label="love" /> at
        AI Cloud Tech Next <span>·</span> Developed by{" "}
        <a
          href="https://www.linkedin.com/in/jgangini/"
          target="_blank"
          rel="noreferrer"
        >
          Joel Ganggini
        </a>
      </footer>
    </div>
  );
}
