import { record } from "../../shared/record";
import type { Conversation, Role, SimEvent, Snapshot, Task } from "./types";
import { sourceWork } from "./scenario";
import { isSnapshot, isEvent } from "./snapshot";

type TaskInput = Pick<Task, "title" | "role" | "source"> &
  Partial<
    Pick<
      Task,
      "duration" | "dependencies" | "failAttempts" | "maxAttempts" | "output"
    >
  >;
const terminal = (task: Task) =>
  ["completed", "failed", "cancelled"].includes(task.status);

interface EngineCheckpoint {
  state: Snapshot;
  serial: number;
  eventSerial: number;
  mailbox: { due: number; event: Omit<SimEvent, "id" | "at"> }[];
}
function isEngineCheckpoint(value: unknown): value is EngineCheckpoint {
  return !(
    !record(value) ||
    !isSnapshot(value.state) ||
    !Number.isSafeInteger(value.serial) ||
    (value.serial as number) < 0 ||
    !Number.isSafeInteger(value.eventSerial) ||
    (value.eventSerial as number) < 0 ||
    !Array.isArray(value.mailbox) ||
    !value.mailbox.every(
      (item: unknown) =>
        record(item) &&
        typeof item.due === "number" &&
        Number.isFinite(item.due) &&
        record(item.event) &&
        isEvent({ ...item.event, id: 0, at: 0 }),
    )
  );
}

function consistentAssignments(
  state: Snapshot,
  agents: Set<string>,
  tasks: Set<string>,
) {
  return !(
    state.tasks.some(
      (task) =>
        task.duration < 100 ||
        (task.worker && !agents.has(task.worker)) ||
        (task.status === "running" &&
          !state.agents.some(
            (agent) => agent.id === task.worker && agent.current === task.id,
          )) ||
        task.dependencies.some((id) => !tasks.has(id)),
    ) ||
    state.agents.some(
      (agent) =>
        (agent.current && !tasks.has(agent.current)) ||
        (agent.current &&
          !state.tasks.some(
            (task) =>
              task.id === agent.current &&
              task.status === "running" &&
              task.worker === agent.id,
          )) ||
        agent.queue.some((id) => !tasks.has(id)),
    )
  );
}

/** Virtual time owns scheduling and streaming. Rendering never advances the simulation. */
export class SwarmEngine {
  private state: Snapshot = {
    time: 0,
    playing: true,
    speed: 1,
    agents: [],
    tasks: [],
    events: [],
    findings: [],
    conversations: [],
    failures: 0,
    revision: 0,
  };
  private serial = 0;
  private eventSerial = 0;
  private mailbox: { due: number; event: Omit<SimEvent, "id" | "at"> }[] = [];
  constructor() {
    this.addAgent("research", "Atlas");
    this.addAgent("social", "Echo");
    this.addAgent("social", "Iris");
    this.addAgent("analysis", "Prisma");
    this.addAgent("writing", "Nova");
  }
  snapshot(): Snapshot {
    return structuredClone(this.state);
  }
  checkpoint() {
    return structuredClone({
      state: this.state,
      serial: this.serial,
      eventSerial: this.eventSerial,
      mailbox: this.mailbox,
    });
  }
  static restore(value: unknown): SwarmEngine | undefined {
    if (!isEngineCheckpoint(value)) return undefined;
    const state = value.state;
    const agents = new Set(state.agents.map((agent) => agent.id));
    const tasks = new Set(state.tasks.map((task) => task.id));
    const ids = [
      ...agents,
      ...tasks,
      ...state.conversations.map((turn) => turn.id),
    ];
    const maximumId = Math.max(
      0,
      ...ids.map((id) => Number(id.split("-").at(-1)) || 0),
    );
    if (
      agents.size !== state.agents.length ||
      tasks.size !== state.tasks.length ||
      new Set(ids).size !== ids.length ||
      value.serial < maximumId ||
      value.eventSerial <
        Math.max(0, ...state.events.map((event) => event.id)) ||
      !consistentAssignments(state, agents, tasks)
    )
      return undefined;
    const engine = new SwarmEngine();
    engine.state = structuredClone(state);
    engine.serial = value.serial;
    engine.eventSerial = value.eventSerial;
    engine.mailbox = structuredClone(value.mailbox);
    return engine;
  }
  private touch() {
    this.state.revision++;
  }
  private emit(event: Omit<SimEvent, "id" | "at">) {
    const entry = { ...event, id: ++this.eventSerial, at: this.state.time };
    this.state.events.push(entry);
    this.state.events = this.state.events.slice(-240);
    for (const agent of this.state.agents)
      if (agent.id === event.from || agent.id === event.to) {
        agent.history.push(entry);
        agent.history = agent.history.slice(-40);
      }
    this.touch();
  }
  addAgent(role: Role, name?: string): string {
    if (this.state.agents.length >= 12)
      throw new Error("El límite del simulador es de 12 agentes.");
    const id = `agent-${++this.serial}`;
    this.state.agents.push({
      id,
      name: name?.trim() || `Agente ${this.serial}`,
      role,
      online: true,
      queue: [],
      completed: 0,
      history: [],
    });
    this.emit({
      type: "agent.joined",
      text: `${name || id} se une al equipo`,
      from: "desk",
      to: id,
    });
    return id;
  }
  setPlaying(value: boolean) {
    this.state.playing = value;
    this.touch();
  }
  setSpeed(value: number) {
    if (![0.5, 1, 2, 4].includes(value))
      throw new Error("Velocidad no válida.");
    this.state.speed = value;
    this.touch();
  }
  addTask(requestId: string, input: TaskInput): string {
    if (
      !input.title.trim() ||
      (input.duration !== undefined &&
        (!Number.isFinite(input.duration) || input.duration < 100))
    )
      throw new Error("Tarea no válida.");
    const dependencies = input.dependencies ?? [];
    if (
      dependencies.some(
        (id) =>
          !this.state.tasks.some(
            (t) => t.id === id && t.requestId === requestId,
          ),
      )
    )
      throw new Error("Dependencia desconocida o de otra solicitud.");
    const id = `task-${++this.serial}`;
    const duration = input.duration ?? 2200;
    this.state.tasks.push({
      ...input,
      id,
      requestId,
      dependencies: [...dependencies],
      duration,
      remaining: duration,
      status: "waiting",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      readyAt: this.state.time,
      failAttempts: input.failAttempts ?? 0,
      output: input.output ?? "",
      emitted: 0,
    });
    this.touch();
    return id;
  }
  inject(question: string): string {
    question = question.trim();
    if (!question || question.length > 500)
      throw new Error("Escribe una consulta de 1 a 500 caracteres.");
    if (this.state.conversations.length >= 20)
      throw new Error(
        "Se alcanzaron 20 consultas. Reinicia la sesión para continuar.",
      );
    const id = `run-${++this.serial}`;
    this.state.conversations.push({
      id,
      question,
      answer: "",
      createdAt: this.state.time,
      chunks: 0,
      status: "running",
    });
    this.emit({
      type: "request.created",
      text: question,
      from: "desk",
      to: "desk",
      requestId: id,
    });
    this.prepareRequest(id, question);
    return id;
  }
  private prepareRequest(id: string, question: string) {
    const dependencies = sourceWork.map(({ units: _units, ...task }) =>
      this.addTask(id, task),
    );
    const analysis = this.addTask(id, {
      title: "Cruzar señales y evidencias",
      role: "analysis",
      source: "analysis",
      duration: 2800,
      dependencies,
      output:
        "Las seis tareas de investigación terminaron. La comparación utiliza valores ficticios de unidades procesadas.",
    });
    this.addTask(id, {
      title: "Redactar respuesta",
      role: "writing",
      source: "desk",
      duration: 5500,
      dependencies: [analysis],
      output: `Preparé una demostración para «${question}».\n\nEl equipo exploró Web, Facebook, Instagram, YouTube, X y Yahoo Finance mediante sus colas de trabajo. El análisis esperó a reunir las seis fuentes. Las notas y el gráfico de la izquierda provienen de esas tareas.\n\nEstos datos son simulados. Cuando se publique el agente en AIDP, Agent Desk mostrará únicamente los eventos, fuentes y resultados que el agente entregue.`,
    });
    this.schedule();
  }
  regenerate(requestId: string) {
    const conversation = this.state.conversations.find(
      (c) => c.id === requestId,
    );
    if (
      !conversation ||
      this.state.conversations.some((c) => c.status === "running")
    )
      throw new Error(
        "Espera a que termine la consulta activa para regenerar.",
      );
    this.mailbox = this.mailbox.filter((m) => m.event.requestId !== requestId);
    this.state.tasks = this.state.tasks.filter(
      (t) => t.requestId !== requestId,
    );
    this.state.findings = this.state.findings.filter(
      (f) => f.requestId !== requestId,
    );
    this.state.events = this.state.events.filter(
      (event) => event.requestId !== requestId,
    );
    Object.assign(conversation, {
      answer: "",
      status: "running",
      createdAt: this.state.time,
      chunks: 0,
      firstChunkAt: undefined,
      completedAt: undefined,
      feedback: undefined,
      usage: undefined,
    });
    this.emit({
      type: "request.regenerated",
      text: conversation.question,
      from: "desk",
      to: "desk",
      requestId,
    });
    this.prepareRequest(requestId, conversation.question);
  }
  setFeedback(requestId: string, feedback: "positive" | "negative") {
    const conversation = this.state.conversations.find(
      (c) => c.id === requestId,
    );
    if (!conversation || conversation.status === "running") return;
    conversation.feedback =
      conversation.feedback === feedback ? undefined : feedback;
    this.touch();
  }
  cancel(requestId: string) {
    const conversation = this.state.conversations.find(
      (c) => c.id === requestId,
    );
    if (!conversation || conversation.status !== "running") return;
    for (const task of this.state.tasks.filter(
      (t) => t.requestId === requestId && !terminal(t),
    )) {
      this.release(task);
      task.status = "cancelled";
    }
    this.mailbox = this.mailbox.filter((m) => m.event.requestId !== requestId);
    conversation.status = "cancelled";
    conversation.completedAt = this.state.time;
    this.touch();
    this.emit({
      type: "request.cancelled",
      text: "Consulta cancelada",
      from: "desk",
      to: "desk",
      requestId,
    });
  }
  setAgentOnline(id: string, online: boolean) {
    const agent = this.state.agents.find((a) => a.id === id);
    if (!agent || agent.online === online) return;
    agent.online = online;
    if (!online) {
      const active = this.state.tasks.find((t) => t.id === agent.current);
      if (active) this.retry(active, "Trabajador desconectado");
      for (const taskId of agent.queue) {
        const task = this.state.tasks.find((t) => t.id === taskId)!;
        task.worker = undefined;
        task.status = "waiting";
      }
      agent.queue = [];
      agent.current = undefined;
    }
    this.emit({
      type: online ? "agent.recovered" : "agent.failed",
      text: `${agent.name}: ${online ? "recuperado" : "fuera de línea"}`,
      from: "desk",
      to: id,
    });
    this.schedule();
  }
  private release(task: Task) {
    const agent = this.state.agents.find((a) => a.id === task.worker);
    if (agent) {
      if (agent.current === task.id) agent.current = undefined;
      agent.queue = agent.queue.filter((id) => id !== task.id);
    }
    task.worker = undefined;
  }
  private retry(task: Task, reason: string) {
    const from = task.worker ?? "desk";
    this.release(task);
    this.state.failures++;
    task.status = task.attempts >= task.maxAttempts ? "failed" : "retrying";
    task.remaining = task.duration;
    task.emitted = 0;
    if (task.role === "writing") {
      const conversation = this.state.conversations.find(
        (c) => c.id === task.requestId,
      );
      if (conversation) {
        conversation.answer = "";
        conversation.firstChunkAt = undefined;
        conversation.chunks = 0;
      }
    }
    task.readyAt = this.state.time + 500 * 2 ** Math.max(0, task.attempts - 1);
    this.emit({
      type: `task.${task.status}`,
      text: `${reason} · ${task.status === "failed" ? "intentos agotados" : "reintento programado"}`,
      from,
      to: "desk",
      taskId: task.id,
      requestId: task.requestId,
      source: task.source,
    });
  }
  private queueReadyTasks() {
    // Dependencies point only to previously created tasks, so this pass also propagates terminal failures.
    for (const task of this.state.tasks) {
      if (
        terminal(task) ||
        task.status === "running" ||
        task.status === "queued"
      )
        continue;
      const parents = task.dependencies.map((id) =>
        this.state.tasks.find((t) => t.id === id)!,
      );
      if (
        parents.some((t) => t.status === "failed" || t.status === "cancelled")
      ) {
        task.status = "failed";
        this.emit({
          type: "task.blocked",
          text: `${task.title}: dependencia fallida`,
          from: "desk",
          to: "desk",
          taskId: task.id,
          requestId: task.requestId,
        });
        continue;
      }
      if (
        parents.some((t) => t.status !== "completed") ||
        task.readyAt > this.state.time
      )
        continue;
      const agent = this.state.agents
        .filter((a) => a.online && a.role === task.role)
        .sort(
          (a, b) =>
            a.queue.length +
            Number(!!a.current) -
            (b.queue.length + Number(!!b.current)),
        )[0];
      if (!agent) continue;
      task.worker = agent.id;
      task.status = "queued";
      agent.queue.push(task.id);
      this.emit({
        type: "task.queued",
        text: task.title,
        from: "desk",
        to: agent.id,
        taskId: task.id,
        requestId: task.requestId,
        source: task.source,
      });
    }
  }
  private startQueuedTasks() {
    for (const agent of this.state.agents)
      if (agent.online && !agent.current && agent.queue.length) {
        const taskId = agent.queue.shift();
        const task = this.state.tasks.find((t) => t.id === taskId)!;
        agent.current = task.id;
        task.status = "running";
        task.attempts++;
        this.emit({
          type: "task.started",
          text: task.title,
          from: "desk",
          to: agent.id,
          taskId: task.id,
          requestId: task.requestId,
          source: task.source,
        });
      }
  }
  private finishConversations() {
    for (const conversation of this.state.conversations.filter(
      (c) => c.status === "running",
    )) {
      const tasks = this.state.tasks.filter(
        (t) => t.requestId === conversation.id,
      );
      if (tasks.length && tasks.every(terminal)) {
        conversation.completedAt = this.state.time;
        conversation.status = tasks.some((t) => t.status === "failed")
          ? "failed"
          : "completed";
      }
    }
  }
  private schedule() {
    this.queueReadyTasks();
    this.startQueuedTasks();
    this.finishConversations();
  }
  advance(realMilliseconds: number) {
    if (!Number.isFinite(realMilliseconds) || realMilliseconds < 0)
      throw new Error("Tiempo no válido.");
    if (!this.state.playing) return;
    let remaining = realMilliseconds * this.state.speed;
    while (remaining > 0) {
      const delta = Math.min(50, remaining);
      this.tick(delta);
      remaining -= delta;
    }
    this.touch();
  }
  private tick(delta: number) {
    this.schedule();
    this.state.time += delta;
    const ready = this.mailbox.filter((m) => m.due <= this.state.time);
    this.mailbox = this.mailbox.filter((m) => m.due > this.state.time);
    ready.forEach((m) => this.emit(m.event));
    for (const task of this.state.tasks.filter((t) => t.status === "running")) {
      task.remaining = Math.max(0, task.remaining - delta);
      if (task.role === "writing") this.stream(task);
      if (task.remaining > 0) continue;
      if (task.attempts <= task.failAttempts) {
        this.retry(task, "Fallo de ejecución simulado");
        continue;
      }
      const from = task.worker!;
      this.release(task);
      task.status = "completed";
      this.state.agents.find((a) => a.id === from)!.completed++;
      if (task.role !== "writing")
        this.state.findings.push({
          id: task.id,
          requestId: task.requestId,
          source: task.source,
          title: task.title,
          text: task.output,
          at: this.state.time,
        });
      const event = {
        type: "message.sent",
        text: `${task.title}: resultado enviado`,
        from,
        to: "desk",
        taskId: task.id,
        requestId: task.requestId,
        source: task.source,
      };
      this.emit(event);
      this.mailbox.push({
        due: this.state.time + 200,
        event: {
          ...event,
          type: "message.delivered",
          text: `${task.title}: resultado recibido`,
        },
      });
      this.emit({ ...event, type: "task.completed", text: task.title });
    }
    this.schedule();
  }
  private stream(task: Task) {
    const conversation: Conversation | undefined =
      this.state.conversations.find((c) => c.id === task.requestId);
    if (!conversation) return;
    const length = Math.floor(
      (1 - task.remaining / task.duration) * task.output.length,
    );
    if (length <= task.emitted) return;
    conversation.firstChunkAt ??= this.state.time;
    conversation.chunks++;
    conversation.answer += task.output.slice(task.emitted, length);
    task.emitted = length;
    // Text chunks are state updates; only meaningful network messages create visual pulses.
    this.touch();
  }
}
