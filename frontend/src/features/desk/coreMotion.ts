import { gsap } from "gsap";
import type { Snapshot } from "./types";

/** Public text changes drive a visual pulse; this signal does not represent audio. */
export function createOutputSignal() {
  let known = new Map<string, string>();
  let initialized = false;
  let previousTime = 0;
  let emittedAt = -Infinity;
  let strength = 0;
  return (
    state: Pick<Snapshot, "conversations" | "findings">,
    time: number,
  ) => {
    if (time < previousTime) {
      initialized = false;
      emittedAt = -Infinity;
    }
    previousTime = time;
    const current = new Map<string, string>([
      ...state.conversations.map(
        (item) => [`answer:${item.id}`, item.answer] as const,
      ),
      ...state.findings.map(
        (item) => [`finding:${item.id}`, item.text] as const,
      ),
    ]);
    let added = 0;
    for (const [id, text] of current) {
      const previous = known.get(id) ?? "";
      if (initialized && text !== previous)
        added += text.startsWith(previous)
          ? text.length - previous.length
          : text.length;
    }
    known = current;
    initialized = true;
    if (added > 0) {
      strength = Math.min(1, 0.15 + added / 40);
      emittedAt = time;
    }
    const pulse = strength * Math.exp(-Math.max(0, time - emittedAt) / 240);
    return pulse < 0.001 ? 0 : pulse;
  };
}

/** Smooth presentation between dispatcher ticks; the simulation remains the only time owner. */
export function createSceneClock() {
  let previous = 0,
    target = 0,
    receivedAt = 0;
  return (time: number, playing: boolean, now: number) => {
    if (!playing || time < target) {
      previous = time;
      target = time;
      receivedAt = now;
      return time;
    }
    if (time !== target) {
      previous = target;
      target = time;
      receivedAt = now;
    }
    return (
      previous +
      (target - previous) * Math.min(1, Math.max(0, (now - receivedAt) / 50))
    );
  };
}

/** Live agents can wait minutes between packets; visual drift follows animation frames. */
export function createRealtimeSceneClock() {
  let time = 0;
  let previous: number | undefined;
  let wasPlaying = false;
  return (playing: boolean, now: number) => {
    if (previous !== undefined && playing && wasPlaying)
      time += Math.max(0, now - previous);
    previous = now;
    wasPlaying = playing;
    return time;
  };
}

/** Authored GSAP poses create gentle drift rather than a constant mechanical spin. */
export function createCoreMotion() {
  const rest = { x: -0.32, y: -0.45, z: -0.12, lift: 0 };
  const pose = { ...rest };
  const timeline = gsap
    .timeline({ paused: true, defaults: { ease: "sine.inOut" } })
    .to(pose, { x: 0.24, y: 0.5, z: 0.12, lift: 0.025, duration: 5.2 })
    .to(pose, { x: -0.16, y: 1.05, z: -0.05, lift: -0.02, duration: 4.8 })
    .to(pose, { ...rest, duration: 6 });
  return {
    sample(milliseconds: number, reducedMotion = false) {
      timeline.time(reducedMotion ? 0 : (milliseconds / 1000) % 16, true);
      return pose;
    },
    dispose() {
      timeline.kill();
    },
  };
}

// Shared deformation keeps every connection attached to its particle. This is illustrative motion.
export const coreDeformation = `
uniform float uTime;
uniform float uActivity;
uniform float uVoice;
uniform float uOutput;
vec3 corePosition(vec3 p) {
  float r = length(p);
  if (r < .5) return p * (1. + .025 * sin(uTime * .8) + uVoice * .14 + uOutput * .045);
  vec3 n = p / r;
  float wave = sin(n.x * 4. + n.y * 3. + uTime * .72 + r * 1.5) * .028;
  wave += sin(n.z * 5. - n.y * 4. - uTime * .55 + r * 3.) * .018;
  float pressure = uVoice * (.045 + .025 * sin(n.y * 7. - uTime * 2.));
  float swell = 1. + wave * (1. + uActivity * .2 + uVoice * 1.5 + uOutput * .45) + pressure + uOutput * .012;
  vec3 drift = vec3(n.y * n.z, n.z * n.x, n.x * n.y);
  return p * swell + drift * sin(uTime * .42 + r * 3.) * (.055 + uOutput * .02);
}`;
