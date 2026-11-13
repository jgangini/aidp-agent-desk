import { storageKey, useIdentity } from "../../shared/identity";
import { AccessEditor } from "../../shared/AccessEditor";
import { lazy, Suspense, useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { useSwarm } from "./useSwarm";
import { useRemoteAgent } from "./useRemoteAgent";
import { Results } from "./Results";
import { Chat } from "./Chat";
import { AgentConfig } from "./AgentConfig";
import {
  ScheduledWorkspacePanel,
  useScheduledReports,
} from "./useScheduledReports";
import { useProfiles } from "./profiles";
import { agentChoices, agentDisplayName, profileIdentity } from "./agentTarget";
import { createVoiceSignal } from "./voice";
import { Tooltips } from "../../shared/Tooltips";
import { ChatResizeHandle, useChatResize } from "./ChatResize";
import { readChatStorage, writeChatStorage } from "./chatStorage";

const Brain = lazy(() =>
  import("./Brain").then((module) => ({ default: module.Brain })),
);
export function Desk() {
  const identity = useIdentity();
  const [usersOpen, setUsersOpen] = useState(false);
  const managingUsers =
    usersOpen && identity.hosted && identity.authenticated && identity.admin;
  const closeUsers = () => {
    setUsersOpen(false);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          '.chat-header button[aria-label="Mi cuenta"]',
        )
        ?.focus(),
    );
  };
  const chatResize = useChatResize();
  const {
    snapshot: demoSnapshot,
    act,
    history,
    newConversation,
    selectConversation,
    deleteConversation,
    selectedConversation,
    restoredAgent,
    draft,
    setDraft,
    setTitle,
    renameConversation,
    setAgent,
  } = useSwarm();
  const [voice] = useState(createVoiceSignal);
  const profileState = useProfiles(restoredAgent);
  useEffect(() => {
    setAgent(profileState.selected);
  }, [profileState.selected, setAgent]);
  const agentName = agentDisplayName(
    profileState.active,
    profileState.selected,
  );
  const remote = useRemoteAgent(
    profileState.selected,
    selectedConversation,
    (question) => setTitle(question, profileState.selected),
  );
  const isRemote = profileState.selected !== "demo";
  const snapshot = isRemote ? remote.snapshot : demoSnapshot;
  const startConversation = () => {
    voice.stop();
    newConversation(profileState.selected);
  };
  const selectAgent = (id: string) => {
    voice.stop();
    profileState.setSelected(id);
    if (snapshot.conversations.length) newConversation(id);
    else setAgent(id);
  };
  const [connection, setConnection] = useConfigurationPanel();
  const [closeRequest, setCloseRequest] = useState(0);
  const [scheduled, setScheduled] = useState(() => {
    const saved = readChatStorage("tasks-open");
    if (typeof saved === "boolean") return saved;
    try {
      return !!localStorage.getItem(storageKey("agent-desk.report-task"));
    } catch {
      return false;
    }
  });
  useEffect(() => {
    writeChatStorage("tasks-open", scheduled);
  }, [scheduled]);
  useEffect(() => {
    const clear = () => setScheduled(false);
    window.addEventListener("agent-desk-session-changed", clear);
    return () =>
      window.removeEventListener("agent-desk-session-changed", clear);
  }, []);
  const [scheduledEditorTitle, setScheduledEditorTitle] = useState<
    string | null
  >(null);
  const [closeTaskRequest, setCloseTaskRequest] = useState(0);
  const [newTaskRequest, setNewTaskRequest] = useState(0);
  const newReportTask = () => {
    setUsersOpen(false);
    setScheduled(true);
    setNewTaskRequest((value) => value + 1);
  };
  const {
    reportOpen,
    reportTask,
    openReports,
    closeReport,
    selectedTask,
    selectReportTask,
    selectReportRun,
    removeReportRun,
    reportArea,
  } = useScheduledReports(() => {
    setScheduled(false);
    setConnection(false);
    setUsersOpen(false);
    setResultsExpanded(false);
  });
  const closeScheduled = () => {
    setScheduled(false);
    closeReport();
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          '.chat-header button[aria-label="Tareas"]',
        )
        ?.focus(),
    );
  };
  const [voiceTarget, setVoiceTarget] = useState<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const { resultsExpanded, setResultsExpanded, viewPhase, changeView } =
    useResultsView(snapshot.findings.length, reducedMotion);
  const resultsFocused = resultsExpanded && snapshot.findings.length > 0;
  return (
    <div className="app">
      <a href="#chat-input" className="skip-link">
        Ir al chat
      </a>
      <main
        ref={chatResize.layoutRef}
        className="desk-layout chat-resizable"
        style={chatResize.style}
      >
        <section
          className={`workspace${snapshot.findings.length ? " has-results" : ""}`}
          aria-label="Visualización y actividad de agentes"
          data-results-expanded={resultsFocused}
          data-view-transition={viewPhase}
          data-users-open={managingUsers}
          data-report-open={reportOpen && !managingUsers}
          data-report-detail={!!reportTask}
        >
          {!managingUsers && reportArea}
          {managingUsers && (
            <AccessEditor
              branding={
                <button
                  type="button"
                  className="desk-wordmark"
                  data-playing={snapshot.playing}
                  aria-label="Volver al escritorio"
                  data-tooltip-disabled="true"
                  onClick={closeUsers}
                >
                  <span>Agent </span>
                  <span className="t-gradient-text">Desk</span>
                </button>
              }
              onClose={closeUsers}
            />
          )}
          <section
            className="activity-section"
            id="results-region"
            aria-labelledby="results-title"
            hidden={!snapshot.findings.length}
          >
            <Results
              findings={snapshot.findings}
              conversations={snapshot.conversations}
              reducedMotion={reducedMotion}
            />
          </section>
          <section
            className="network-stage"
            id="network-region"
            aria-label="Actividad del agente en 3D"
          >
            <button
              type="button"
              className="desk-wordmark"
              data-playing={snapshot.playing}
              aria-label="Ir al inicio"
              data-tooltip-disabled="true"
              onClick={() => {
                setConnection(false);
                setScheduled(false);
                setResultsExpanded(false);
                startConversation();
              }}
            >
              <span>Agent </span>
              <span className="t-gradient-text">Desk</span>
            </button>
            {snapshot.findings.length > 0 && (
              <button
                type="button"
                className="icon-button stage-swap"
                data-tooltip="Cambiar vista"
                aria-label={
                  resultsFocused ? "Mostrar animación" : "Ampliar resultados"
                }
                aria-controls="network-region results-region"
                aria-pressed={resultsFocused}
                aria-busy={viewPhase !== "idle"}
                onClick={changeView}
              >
                <ArrowLeftRight size={18} aria-hidden="true" />
              </button>
            )}
            {!resultsFocused && (
              <Suspense
                fallback={
                  <div className="brain-loading">Preparando la red 3D…</div>
                }
              >
                <Brain
                  realtime={isRemote}
                  voice={voice}
                  snapshot={snapshot}
                  reducedMotion={reducedMotion}
                />
              </Suspense>
            )}
            <div className="voice-dock-slot" ref={setVoiceTarget} />
          </section>
        </section>
        <Chat
          snapshot={snapshot}
          act={act}
          onSend={isRemote ? remote.send : undefined}
          onCancel={isRemote ? remote.cancel : undefined}
          onRecover={isRemote ? remote.recover : undefined}
          onFeedback={isRemote ? remote.feedback : undefined}
          reset={startConversation}
          history={history.filter(
            (item) =>
              item.agentId === "demo" ||
              item.id === selectedConversation ||
              profileState.profiles.some(
                (profile) => profile.id === profileIdentity(item.agentId),
              ),
          )}
          selectedConversation={selectedConversation}
          onRenameConversation={renameConversation}
          onDeleteConversation={(id) => {
            if (
              id === selectedConversation &&
              snapshot.conversations.some((turn) => turn.status === "running")
            )
              return;
            if (!remote.deleteConversation(id)) return;
            if (id === selectedConversation) voice.stop();
            deleteConversation(id);
          }}
          initialDraft={draft}
          onDraftChange={setDraft}
          onSelectConversation={(id) => {
            const session = history.find((item) => item.id === id);
            if (!session) return;
            voice.stop();
            profileState.setSelected(session.agentId);
            selectConversation(id);
          }}
          agentName={agentName}
          agentChoices={[
            { id: "demo", name: "Demostración local" },
            ...agentChoices(profileState.profiles),
          ]}
          selectedAgent={profileState.selected}
          onSelectAgent={selectAgent}
          configuration={
            scheduled ? (
              <ScheduledWorkspacePanel
                canManageReports={
                  identity.admin && (!identity.hosted || identity.authenticated)
                }
                createRequest={newTaskRequest}
                closeRequest={closeTaskRequest}
                onEditingChange={setScheduledEditorTitle}
                onRemoveReport={removeReportRun}
                selectedTask={selectedTask}
                onSelectReport={(task, runId) => {
                  setUsersOpen(false);
                  selectReportRun(task, runId);
                }}
                onFormatReport={(task, runId) => {
                  setUsersOpen(false);
                  selectReportRun(task, runId, true);
                }}
                onSelectTask={(task) => {
                  setUsersOpen(false);
                  selectReportTask(task);
                }}
                onRemoveTask={(id) => {
                  if (selectedTask?.id === id) selectReportTask(null);
                }}
                onClose={closeScheduled}
                selectedAgent={profileState.selected}
                agents={[
                  { id: "demo", name: "Demostración local" },
                  ...agentChoices(profileState.profiles),
                ]}
              />
            ) : connection ? (
              <AgentConfig
                closeRequest={closeRequest}
                profiles={profileState.profiles}
                selected={profileIdentity(profileState.selected)}
                error={profileState.error}
                onSelect={selectAgent}
                onSaved={profileState.refresh}
                onClose={() => {
                  setConnection(false);
                  requestAnimationFrame(() =>
                    document
                      .querySelector<HTMLButtonElement>(
                        '.chat-header button[aria-label="Configurar agentes"]',
                      )
                      ?.focus(),
                  );
                }}
              />
            ) : null
          }
          voice={voice}
          voiceTarget={voiceTarget}
          reducedMotion={reducedMotion}
          scheduledOpen={scheduled}
          scheduledEditing={!!scheduledEditorTitle}
          scheduledEditorTitle={scheduledEditorTitle ?? undefined}
          onScheduled={() => {
            voice.stop();
            setUsersOpen(false);
            setNewTaskRequest(0);
            setScheduled(true);
            openReports();
          }}
          onNewScheduled={newReportTask}
          onUsers={() => {
            if (!identity.hosted || !identity.authenticated || !identity.admin)
              return;
            voice.stop();
            setUsersOpen(true);
          }}
          onConfigure={() => {
            if (scheduled) {
              if (scheduledEditorTitle) {
                setCloseTaskRequest((value) => value + 1);
                return;
              }
              closeScheduled();
              return;
            }
            if (connection) {
              setCloseRequest((value) => value + 1);
              return;
            }
            setCloseRequest(0);
            voice.stop();
            setConnection(true);
          }}
        />
        <ChatResizeHandle resize={chatResize} />
      </main>
      <Tooltips rootSelector=".app" />
    </div>
  );
}

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reducedMotion;
}

function useConfigurationPanel() {
  const [connection, setConnection] = useState(() => {
    try {
      return (
        sessionStorage.getItem(storageKey("agent-desk.configuration-open")) ===
        "true"
      );
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(
        storageKey("agent-desk.configuration-open"),
        String(connection),
      );
    } catch {
      /* Storage may be unavailable in private browser contexts. */
    }
  }, [connection]);
  return [connection, setConnection] as const;
}

function useResultsView(findingCount: number, reducedMotion: boolean) {
  const [resultsExpanded, setResultsExpanded] = useState(
    () => readChatStorage("results-expanded") === true,
  );
  useEffect(() => {
    writeChatStorage("results-expanded", resultsExpanded);
  }, [resultsExpanded]);
  const [viewPhase, setViewPhase] = useState<"idle" | "exit" | "enter">("idle");
  useEffect(() => {
    if (viewPhase === "idle") return;
    if (!findingCount) {
      setViewPhase("idle");
      return;
    }
    const token =
      viewPhase === "exit" ? "--motion-close" : "--motion-panel-open";
    const duration = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(token),
    );
    const timer = window.setTimeout(
      () => {
        if (viewPhase === "exit") {
          setResultsExpanded((value) => !value);
          setViewPhase("enter");
        } else setViewPhase("idle");
      },
      reducedMotion ? 0 : duration,
    );
    return () => window.clearTimeout(timer);
  }, [viewPhase, reducedMotion, findingCount]);
  const changeView = () => {
    if (viewPhase !== "idle") return;
    if (reducedMotion) setResultsExpanded((value) => !value);
    else setViewPhase("exit");
  };
  return { resultsExpanded, setResultsExpanded, viewPhase, changeView };
}
