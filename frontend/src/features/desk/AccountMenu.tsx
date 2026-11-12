import { useId, type CSSProperties } from "react";
import { CircleUserRound, LogOut, Users, X } from "lucide-react";
import { useIdentity } from "../../shared/identity";
import { useHeaderMenu } from "./useHeaderMenu";
import "./ConversationMenu.css";

export function AccountMenu({ onUsers }: { onUsers?: () => void }) {
  const identity = useIdentity();
  const canManageUsers =
    identity.hosted && identity.authenticated && identity.admin && !!onUsers;
  const {
    expanded,
    open,
    setOpen,
    root,
    trigger,
    menu,
    close,
    onBlur,
    onKeyDown,
  } = useHeaderMenu(identity.authenticated);
  const id = useId();
  return (
    <div className="chat-options-anchor account-menu">
      <div
        ref={root}
        className="chat-options t-morph"
        data-open={expanded}
        style={
          {
            "--morph-height": canManageUsers ? "120px" : "84px",
          } as CSSProperties
        }
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        <button
          ref={trigger}
          className="t-morph-plus"
          type="button"
          aria-label="Mi cuenta"
          aria-haspopup={identity.authenticated ? "menu" : undefined}
          aria-expanded={identity.authenticated ? expanded : undefined}
          aria-controls={identity.authenticated ? id : undefined}
          tabIndex={expanded ? -1 : 0}
          onClick={() => {
            if (identity.authenticated) setOpen(!open);
            else identity.openAccount();
          }}
        >
          <CircleUserRound size={18} aria-hidden="true" />
        </button>
        {identity.authenticated && (
          <div
            ref={menu}
            className="t-morph-menu"
            data-tooltip-disabled="true"
            aria-hidden={!expanded}
            inert={!expanded}
          >
            <h3 className="history-title">Perfil</h3>
            <button
              className="history-close icon-button"
              type="button"
              aria-label="Cerrar perfil"
              onClick={() => close()}
            >
              <X size={15} aria-hidden="true" />
            </button>
            <div
              id={id}
              className="header-menu-actions"
              role="menu"
              aria-label="Perfil"
            >
              {canManageUsers && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={identity.leaving}
                  onClick={() => {
                    close();
                    onUsers?.();
                  }}
                >
                  <Users size={17} aria-hidden="true" />
                  Usuarios
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={identity.leaving}
                onClick={() => {
                  close();
                  void identity.logout();
                }}
              >
                <LogOut size={17} aria-hidden="true" />
                {identity.leaving ? "Cerrando sesión…" : "Cerrar sesión"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
