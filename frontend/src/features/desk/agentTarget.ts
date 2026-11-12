export interface AgentTarget {
  id: string;
  name: string;
  surface?: "PROD" | "TEST";
  instance_id?: string;
  workspace_id?: string;
}

export function profileIdentity(selected: string): string {
  return selected.startsWith("test:") ? selected.slice(5) : selected;
}

export function agentChoices(profiles: AgentTarget[]) {
  return profiles.flatMap((profile) => [
    ...(profile.surface !== "TEST"
      ? [{ id: profile.id, name: profile.name }]
      : []),
    ...(profile.surface === "TEST" ||
    (profile.instance_id && profile.workspace_id)
      ? [
          {
            id: `test:${profile.id}`,
            name: `${profile.name} (TEST)`,
          },
        ]
      : []),
  ]);
}

export function agentDisplayName(
  profile: AgentTarget | undefined,
  selected: string,
) {
  if (!profile)
    return selected === "demo" ? "Demostración local" : "Agente no disponible";
  const testing = selected.startsWith("test:") || profile.surface === "TEST";
  return `${profile.name}${testing ? " (TEST)" : ""}`;
}
