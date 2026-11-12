import { Settings, Clock, X, Plus } from "lucide-react";
import { useIdentity } from "../../shared/identity";
import { AccountMenu } from "./AccountMenu";
import { ConversationMenu } from "./ConversationMenu";
import { ConversationTitle } from "./ConversationTitle";

function panelHeading(
  configuring: boolean,
  scheduledOpen: boolean,
  scheduledEditing: boolean,
  title?: string,
  editorTitle?: string,
) {
  if (scheduledOpen)
    return {
      title: scheduledEditing ? editorTitle || "Nueva tarea" : "Tareas",
      close: scheduledEditing ? "Volver a Tareas" : "Cerrar Tareas",
    };
  if (configuring)
    return { title: "Configuración", close: "Cerrar configuración" };
  return { title: title || "Nuevo Chat", close: "Configurar agentes" };
}

export function ChatHeader({
  configuring,
  history,
  selectedConversation,
  onRenameConversation,
  onSelectConversation,
  onDeleteConversation,
  reset,
  busyId,
  scheduledOpen,
  scheduledEditing,
  scheduledEditorTitle,
  onScheduled,
  onNewScheduled,
  onConfigure,
  onUsers,
}: {
  configuring: boolean;
  history: { id: string; title: string }[];
  selectedConversation?: string;
  onRenameConversation?: (title: string) => void;
  onSelectConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  reset: () => void;
  busyId?: string;
  scheduledOpen: boolean;
  scheduledEditing: boolean;
  scheduledEditorTitle?: string;
  onScheduled?: () => void;
  onNewScheduled?: () => void;
  onConfigure?: () => void;
  onUsers?: () => void;
}) {
  const identity = useIdentity();
  const conversation = history.find((item) => item.id === selectedConversation);
  const heading = panelHeading(
    configuring,
    scheduledOpen,
    scheduledEditing,
    conversation?.title,
    scheduledEditorTitle,
  );
  return (
    <div className="chat-header" data-configuring={configuring}>
      {!configuring &&
      onRenameConversation &&
      selectedConversation &&
      conversation ? (
        <ConversationTitle
          key={selectedConversation}
          title={conversation.title}
          onRename={onRenameConversation}
        />
      ) : (
        <h2 id="chat-title">{heading.title}</h2>
      )}
      {!configuring && (
        <ConversationMenu
          history={history}
          selected={selectedConversation}
          onNew={reset}
          onSelect={onSelectConversation}
          onDelete={onDeleteConversation}
          busyId={busyId}
        />
      )}
      {!configuring && onScheduled && (
        <button
          className="icon-button"
          aria-label="Tareas"
          data-tooltip="Tareas"
          aria-controls="scheduled-panel"
          aria-expanded={scheduledOpen}
          onClick={onScheduled}
        >
          <Clock size={18} aria-hidden="true" />
        </button>
      )}
      {scheduledOpen && !scheduledEditing && onNewScheduled && (
        <button
          type="button"
          className="icon-button"
          aria-label="Nueva tarea"
          onClick={onNewScheduled}
        >
          <Plus size={18} aria-hidden="true" />
        </button>
      )}
      <button
        className="icon-button"
        aria-label={heading.close}
        data-tooltip={configuring ? heading.close : "Configuración"}
        onClick={onConfigure}
        disabled={!onConfigure || (!identity.admin && !scheduledOpen)}
        aria-expanded={configuring}
        aria-controls={scheduledOpen ? "scheduled-panel" : "agent-config-title"}
      >
        <span
          className="t-icon-swap"
          data-state={configuring ? "b" : "a"}
          aria-hidden="true"
        >
          <Settings className="t-icon" data-icon="a" size={18} />
          <X className="t-icon" data-icon="b" size={18} />
        </span>
      </button>
      {!configuring && <AccountMenu onUsers={onUsers} />}
    </div>
  );
}
