import { useEffect, useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";
import "./ConversationTitle.css";

export function ConversationTitle({
  title,
  onRename,
}: {
  title: string;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const startEditing = () => {
    setName(title);
    setEditing(true);
  };
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => action.current?.focus());
  };
  return (
    <div className="conversation-title" data-tooltip-disabled="true">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!editing || !name.trim()) return;
          onRename(name.trim());
          close();
        }}
      >
        <h2 id="chat-title" hidden={editing}>
          <button
            type="button"
            className="conversation-title-label"
            onClick={startEditing}
          >
            {title}
          </button>
        </h2>
        {editing && (
          <input
            ref={input}
            aria-label="Nombre de la conversación"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                close();
              }
            }}
          />
        )}
        <button
          ref={action}
          type="button"
          className={`icon-button${editing ? "" : " conversation-title-edit"}`}
          aria-label={
            editing ? "Guardar nombre" : "Editar nombre de la conversación"
          }
          disabled={editing && !name.trim()}
          onClick={(event) => {
            if (editing) {
              event.currentTarget.form?.requestSubmit();
            } else {
              startEditing();
            }
          }}
        >
          <span
            className="t-icon-swap"
            data-state={editing ? "b" : "a"}
            aria-hidden="true"
          >
            <Pencil className="t-icon" data-icon="a" size={15} />
            <Check className="t-icon" data-icon="b" size={15} />
          </span>
        </button>
      </form>
    </div>
  );
}
