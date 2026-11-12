import { describe, expect, it } from "vitest";
import { SwarmEngine } from "./engine";

describe("dispatcher", () => {
  it("runs independent queues concurrently and gates analysis and streaming on dependencies", () => {
    const engine = new SwarmEngine();
    const id = engine.inject("Investigar IA");
    expect(
      engine.snapshot().tasks.filter((t) => t.status === "running"),
    ).toHaveLength(3);
    engine.advance(2600);
    expect(engine.snapshot().findings.map((f) => f.source)).toEqual(["web"]);
    expect(
      engine.snapshot().tasks.find((t) => t.role === "analysis")!.status,
    ).toBe("waiting");
    engine.advance(8500);
    expect(
      engine.snapshot().tasks.find((t) => t.role === "writing")!.status,
    ).toBe("running");
    engine.advance(800);
    const partial = engine.snapshot().conversations[0].answer;
    expect(partial.length).toBeGreaterThan(0);
    expect(engine.snapshot().conversations[0].status).toBe("running");
    engine.advance(6000);
    expect(engine.snapshot().conversations[0]).toMatchObject({
      id,
      status: "completed",
    });
    expect(engine.snapshot().conversations[0].answer).toContain(
      "Estos datos son simulados.",
    );
    expect(engine.snapshot().tasks.every((t) => t.status === "completed")).toBe(
      true,
    );
  });
  it("delivers asynchronous messages only after their scheduled delay", () => {
    const engine = new SwarmEngine();
    engine.inject("Prueba");
    engine.advance(2500);
    const sent = engine
      .snapshot()
      .events.find((e) => e.type === "message.sent")!;
    expect(sent).toBeTruthy();
    expect(
      engine.snapshot().events.some((e) => e.type === "message.delivered"),
    ).toBe(false);
    engine.advance(200);
    expect(
      engine.snapshot().events.find((e) => e.type === "message.delivered")!.at,
    ).toBe(sent.at + 200);
  });
  it("reassigns work after worker loss without duplicate completion", () => {
    const engine = new SwarmEngine();
    engine.inject("Recuperar");
    const task = engine.snapshot().tasks.find((t) => t.source === "facebook")!;
    engine.setAgentOnline(task.worker!, false);
    engine.advance(600);
    expect(engine.snapshot().tasks.find((t) => t.id === task.id)!.status).toBe(
      "queued",
    );
    engine.advance(20000);
    expect(engine.snapshot().tasks.find((t) => t.id === task.id)).toMatchObject(
      { status: "completed", attempts: 2 },
    );
    expect(
      engine.snapshot().findings.filter((f) => f.id === task.id),
    ).toHaveLength(1);
    expect(engine.snapshot().failures).toBe(1);
  });
  it("holds a retry until its specialist recovers", () => {
    const engine = new SwarmEngine();
    engine.inject("Prueba");
    const task = engine.snapshot().tasks.find((t) => t.source === "web")!;
    engine.setAgentOnline(task.worker!, false);
    engine.advance(5000);
    expect(engine.snapshot().tasks.find((t) => t.id === task.id)!.status).toBe(
      "retrying",
    );
    engine.setAgentOnline(task.worker!, true);
    engine.advance(20000);
    expect(engine.snapshot().conversations[0].status).toBe("completed");
  });
  it("backs off exponentially and propagates terminal failures to dependents", () => {
    const engine = new SwarmEngine();
    const parent = engine.addTask("r", {
      title: "Fallará",
      role: "research",
      source: "web",
      duration: 100,
      failAttempts: 3,
      maxAttempts: 3,
    });
    const child = engine.addTask("r", {
      title: "Depende",
      role: "analysis",
      source: "analysis",
      dependencies: [parent],
    });
    engine.advance(100);
    const first = engine.snapshot().tasks[0];
    expect(first.status).toBe("retrying");
    expect(first.readyAt - engine.snapshot().time).toBe(500);
    engine.advance(600);
    expect(engine.snapshot().tasks[0].readyAt - engine.snapshot().time).toBe(
      1000,
    );
    engine.advance(1100);
    expect(engine.snapshot().tasks.find((t) => t.id === parent)!.status).toBe(
      "failed",
    );
    expect(engine.snapshot().tasks.find((t) => t.id === child)!.status).toBe(
      "failed",
    );
    expect(engine.snapshot().failures).toBe(3);
  });
  it("freezes virtual time and streaming on pause; speed multiplies elapsed time", () => {
    const engine = new SwarmEngine();
    engine.inject("Pausa");
    engine.advance(7800);
    engine.setPlaying(false);
    const before = engine.snapshot();
    engine.advance(50000);
    expect(engine.snapshot()).toEqual(before);
    engine.setPlaying(true);
    engine.setSpeed(4);
    engine.advance(100);
    expect(engine.snapshot().time).toBe(before.time + 400);
  });
  it("cancels only the selected request and removes its scheduled deliveries", () => {
    const engine = new SwarmEngine();
    const a = engine.inject("Primera");
    const b = engine.inject("Segunda");
    engine.advance(2500);
    engine.cancel(a);
    engine.advance(40000);
    expect(
      engine.snapshot().conversations.find((c) => c.id === a)!.status,
    ).toBe("cancelled");
    expect(
      engine.snapshot().conversations.find((c) => c.id === b)!.status,
    ).toBe("completed");
    expect(
      engine
        .snapshot()
        .agents.every((agent) => !agent.current && agent.queue.length === 0),
    ).toBe(true);
  });
  it("rejects unknown dependencies and keeps snapshots isolated", () => {
    const engine = new SwarmEngine();
    expect(() => engine.inject(" ")).toThrow();
    expect(() =>
      engine.addTask("r", {
        title: "Invalid",
        role: "analysis",
        source: "analysis",
        dependencies: ["missing"],
      }),
    ).toThrow();
    const snapshot = engine.snapshot();
    snapshot.agents[0].online = false;
    expect(engine.snapshot().agents[0].online).toBe(true);
  });
  it("allows new specialists to consume previously waiting work", () => {
    const engine = new SwarmEngine();
    const worker = engine.snapshot().agents.find((a) => a.role === "analysis")!;
    engine.setAgentOnline(worker.id, false);
    engine.addTask("r", {
      title: "Esperando analista",
      role: "analysis",
      source: "analysis",
      duration: 100,
    });
    engine.advance(200);
    expect(engine.snapshot().tasks[0].status).toBe("waiting");
    engine.addAgent("analysis", "Nuevo");
    engine.advance(100);
    expect(engine.snapshot().tasks[0].status).toBe("completed");
  });
  it("regenerates in place without stale findings, deliveries or duplicated turns", () => {
    const engine = new SwarmEngine();
    const first = engine.inject("Primera");
    engine.advance(30000);
    const second = engine.inject("Segunda");
    engine.advance(30000);
    const prior = engine.snapshot();
    engine.setFeedback(first, "positive");
    engine.regenerate(first);
    let state = engine.snapshot();
    expect(state.conversations.map((c) => c.id)).toEqual([first, second]);
    expect(state.conversations[0].feedback).toBeUndefined();
    expect(state.conversations[0].chunks).toBe(0);
    expect(state.findings.filter((f) => f.requestId === first)).toHaveLength(0);
    expect(state.findings.filter((f) => f.requestId === second)).toHaveLength(
      7,
    );
    expect(
      state.events
        .filter((e) => e.requestId === first)
        .every((e) => e.at >= prior.time),
    ).toBe(true);
    expect(() => engine.regenerate(second)).toThrow(/Espera/);
    engine.advance(30000);
    state = engine.snapshot();
    expect(state.conversations[0].status).toBe("completed");
    expect(state.findings.filter((f) => f.requestId === first)).toHaveLength(7);
    expect(state.tasks.filter((t) => t.requestId === first)).toHaveLength(8);
    expect(state.conversations[0].firstChunkAt).toBeGreaterThan(prior.time);
    expect(state.conversations[0].completedAt).toBeGreaterThan(
      state.conversations[0].firstChunkAt!,
    );
    expect(state.conversations[0].chunks).toBeGreaterThan(0);
    expect(
      state.agents.every((agent) => !agent.current && agent.queue.length === 0),
    ).toBe(true);
  });
});
