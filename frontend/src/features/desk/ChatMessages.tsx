// Message layout adapted from assistant-ui's MIT-licensed reference, pinned in docs/licenses.
import { useContext } from "react";
import {
  useAuiState,
  MessagePrimitive,
  MessagePartPrimitive,
} from "@assistant-ui/react";
import { ResponseActions } from "./ChatActions";
import { ChatActionsContext } from "./chatContext";
import { MarkdownText } from "./MarkdownText";
import { ToolProgress } from "./ToolProgress";

export function UserMessage() {
  return (
    <MessagePrimitive.Root className="aui-user-message" data-role="user">
      <div className="aui-user-message-content">
        <MessagePrimitive.Parts components={{ Text: LiveText }} />
      </div>
    </MessagePrimitive.Root>
  );
}

export function AssistantMessage() {
  return (
    <MessagePrimitive.Root
      className="aui-assistant-message"
      data-role="assistant"
      tabIndex={0}
    >
      <div className="aui-assistant-message-content answer-text">
        <ToolProgress />
        <MessagePrimitive.Parts components={{ Text: LiveText }} />
      </div>
      <ResponseActions />
    </MessagePrimitive.Root>
  );
}

function LiveText() {
  const actions = useContext(ChatActionsContext);
  const text = useAuiState((state) =>
    state.part.type === "text" ? state.part.text : "",
  );
  const assistant = useAuiState((state) => state.message.role === "assistant");
  const live = useAuiState((state) => state.message.status?.type === "running");
  const id = useAuiState((state) => state.message.id);
  return assistant ? (
    <MarkdownText
      key={id}
      text={text}
      live={live}
      animateInitial={!actions?.initialMessageIds?.has(id)}
    />
  ) : (
    <MessagePartPrimitive.Text smooth={false} />
  );
}
