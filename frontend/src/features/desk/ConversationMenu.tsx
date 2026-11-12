import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Plus, MessageSquare, Trash2, X } from "lucide-react";
import { useHeaderMenu } from "./useHeaderMenu";
import "./ConversationMenu.css";

export function ConversationMenu({
  history,
  selected,
  onNew,
  onSelect,
  onDelete,
  busyId,
}: {
  history: { id: string; title: string }[];
  selected?: string;
  onNew: () => void;
  onSelect?: (id: string) => void;
  onDelete?: (id: string) => void;
  busyId?: string;
}) {
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
  }>();
  const hasHistory = history.length > 0;
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
  } = useHeaderMenu(hasHistory);
  const id = useId();
  return (
    <div className="chat-options-anchor">
      <div
        ref={root}
        className="chat-options t-morph"
        data-open={expanded}
        style={
          {
            "--morph-height": `${90 + Math.min(5, history.length) * 42}px`,
          } as CSSProperties
        }
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        <button
          ref={trigger}
          className="t-morph-plus"
          type="button"
          aria-label="Opciones del chat"
          data-tooltip="Nuevo Chat"
          aria-haspopup={hasHistory ? "menu" : undefined}
          aria-expanded={hasHistory ? expanded : undefined}
          aria-controls={hasHistory ? id : undefined}
          tabIndex={expanded ? -1 : 0}
          onClick={() => {
            if (hasHistory) setOpen(!open);
            else onNew();
          }}
        >
          <Plus size={17} aria-hidden="true" />
        </button>
        {hasHistory && (
          <div
            ref={menu}
            className="t-morph-menu"
            data-tooltip-disabled="true"
            aria-hidden={!expanded}
            inert={!expanded}
          >
            <h3 className="history-title">Conversaciones</h3>
            <button
              className="history-close icon-button"
              type="button"
              aria-label="Cerrar historial"
              onClick={() => close()}
            >
              <X size={15} />
            </button>
            <div
              className="header-menu-actions"
              id={id}
              role="menu"
              aria-label="Conversaciones"
            >
              <div
                className="history-items"
                data-scrollable={history.length > 5}
                role="none"
              >
                {history.map((item) => (
                  <div className="history-row" key={item.id} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className="history-select"
                      aria-current={item.id === selected ? "page" : undefined}
                      onClick={() => {
                        close();
                        onSelect?.(item.id);
                      }}
                    >
                      <MessageSquare size={14} />
                      <span>{item.title}</span>
                    </button>
                    {onDelete && (
                      <button
                        type="button"
                        role="menuitem"
                        className="history-delete"
                        aria-label={`Eliminar conversación: ${item.title}`}
                        disabled={item.id === busyId}
                        onClick={() => {
                          close(false);
                          setPendingDelete(item);
                        }}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                role="menuitem"
                className="history-new"
                onClick={() => {
                  close();
                  onNew();
                }}
              >
                <Plus size={15} />
                <span>Nueva conversación</span>
              </button>
            </div>
          </div>
        )}
      </div>
      <ConversationDeleteDialog
        id={id}
        pendingDelete={pendingDelete}
        busyId={busyId}
        onDelete={onDelete}
        onClose={() => {
          setPendingDelete(undefined);
          trigger.current?.focus();
        }}
      />
    </div>
  );
}

function ConversationDeleteDialog({
  id,
  pendingDelete,
  busyId,
  onDelete,
  onClose,
}: {
  id: string;
  pendingDelete: { id: string; title: string } | undefined;
  busyId?: string;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (pendingDelete) dialog.current?.showModal();
  }, [pendingDelete]);
  return (
    <dialog
      ref={dialog}
      className="history-delete-dialog"
      aria-labelledby={`${id}-delete-title`}
      aria-describedby={`${id}-delete-description`}
      data-tooltip-disabled="true"
      onClose={() => {
        onClose();
      }}
    >
      <h2 id={`${id}-delete-title`}>¿Eliminar conversación?</h2>
      <p id={`${id}-delete-description`}>
        Se eliminará del historial de este navegador la conversación{" "}
        <span className="history-delete-name">{pendingDelete?.title}</span>.{" "}
        Esta acción no se puede deshacer.
      </p>
      <footer>
        <button type="button" autoFocus onClick={() => dialog.current?.close()}>
          Cancelar
        </button>
        <button
          type="button"
          className="history-confirm-delete"
          disabled={pendingDelete?.id === busyId}
          onClick={() => {
            if (pendingDelete && pendingDelete.id !== busyId)
              onDelete?.(pendingDelete.id);
            dialog.current?.close();
          }}
        >
          Eliminar
        </button>
      </footer>
    </dialog>
  );
}
