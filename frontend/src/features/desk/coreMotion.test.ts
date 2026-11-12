import { expect, it } from "vitest";
import {
  createCoreMotion,
  createOutputSignal,
  createSceneClock,
  createRealtimeSceneClock,
} from "./coreMotion";
import { SwarmEngine } from "./engine";

it("keeps the live core moving while an agent waits without any new packets", () => {
  const clock = createRealtimeSceneClock();
  const motion = createCoreMotion();
  const first = { ...motion.sample(clock(true, 1000)) };
  const later = { ...motion.sample(clock(true, 4000)) };
  expect(later).not.toEqual(first);
  expect(clock(true, 61000)).toBe(60000);
  const paused = clock(false, 62000);
  expect(clock(false, 90000)).toBe(paused);
  expect(clock(true, 91000)).toBe(paused);
  expect(clock(true, 91050)).toBe(paused + 50);
  motion.dispose();
});

it("interpolates dispatcher ticks smoothly but freezes exactly on pause and resets with the simulation", () => {
  const clock = createSceneClock();
  clock(0, true, 0);
  clock(50, true, 50);
  expect(clock(50, true, 75)).toBe(25);
  expect(clock(50, true, 90)).toBe(40);
  expect(clock(50, false, 100)).toBe(50);
  expect(clock(50, false, 1000)).toBe(50);
  expect(clock(0, true, 1100)).toBe(0);
});
it("keeps authored GSAP poses bounded, continuous at the loop and static under reduced motion", () => {
  const motion = createCoreMotion();
  const initial = { ...motion.sample(0) };
  expect(Math.abs(initial.x)).toBeGreaterThan(0.3);
  expect(Math.abs(initial.y)).toBeGreaterThan(0.4);
  const changed = { ...motion.sample(3000) };
  expect(changed).not.toEqual(initial);
  const nearEnd = { ...motion.sample(15999) };
  expect(Math.abs(nearEnd.y - initial.y)).toBeLessThan(0.001);
  for (let time = 0; time < 32000; time += 250) {
    const pose = motion.sample(time);
    expect(Math.abs(pose.x)).toBeLessThan(0.55);
    expect(Math.abs(pose.y)).toBeLessThan(1.2);
    expect(Math.abs(pose.z)).toBeLessThan(0.2);
    expect(Math.abs(pose.lift)).toBeLessThan(0.06);
  }
  expect({ ...motion.sample(7000, true) }).toEqual(initial);
  motion.dispose();
});

it("turns through an informative oblique view while preserving continuity at authored pose boundaries", () => {
  const motion = createCoreMotion();
  const start = { ...motion.sample(0) };
  const turned = { ...motion.sample(10000) };
  expect(turned.y - start.y).toBeGreaterThan(1.4);
  for (const boundary of [5200, 10000, 16000]) {
    const before = { ...motion.sample(boundary - 1) };
    const after = { ...motion.sample(boundary + 1) };
    for (const axis of ["x", "y", "z", "lift"] as const) {
      expect(Math.abs(after[axis] - before[axis])).toBeLessThan(0.001);
    }
  }
  motion.dispose();
});

it("pulses from newly received response text, decays without retriggering and freezes with presentation time", () => {
  const signal = createOutputSignal();
  const engine = new SwarmEngine();
  engine.inject("Investigar");
  const initial = engine.snapshot();
  expect(signal(initial, 0)).toBe(0);
  const streamed = {
    ...initial,
    conversations: initial.conversations.map((item) => ({
      ...item,
      answer: "Respuesta nueva",
    })),
  };
  const level = signal(streamed, 50);
  expect(level).toBeGreaterThan(0.4);
  expect(signal(streamed, 50)).toBe(level);
  expect(signal({ ...streamed }, 170)).toBeLessThan(level);
  expect(signal(streamed, 3000)).toBe(0);
  expect(signal(streamed, 0)).toBe(0);
});

it("reacts to public findings but does not replay existing history when the scene mounts", () => {
  const engine = new SwarmEngine();
  const requestId = engine.inject("Investigar");
  const before = engine.snapshot();
  const after = {
    ...before,
    findings: [
      {
        id: "new",
        requestId,
        source: "web" as const,
        title: "Fuente",
        text: "Hallazgo público recibido",
        at: 50,
      },
    ],
  };
  const signal = createOutputSignal();
  expect(signal(before, 0)).toBe(0);
  expect(signal(after, 50)).toBeGreaterThan(0);
  const restored = createOutputSignal();
  expect(restored(after, 50)).toBe(0);
  expect(restored(after, 100)).toBe(0);
});
