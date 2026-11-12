import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { Snapshot } from "./types";
import { brainGeometry } from "./brainGeometry";
import { createVoiceEnvelope, type VoiceSignal } from "./voice";
import {
  coreDeformation,
  createCoreMotion,
  createOutputSignal,
  createSceneClock,
  createRealtimeSceneClock,
} from "./coreMotion";

// Palette and 16s drift follow the existing Desk wordmark; audio owns activation.
const voiceColorShader = `
uniform float uListening;
uniform float uSpeaking;
uniform float uVoiceColorTime;
vec3 deskVoiceColor(vec3 p) {
  float phase = fract(dot(p, vec3(.12, .10, .09)) - uVoiceColorTime / 16.);
  vec3 blue = vec3(0., .43137, .96078);
  vec3 magenta = vec3(.8, 0., .65490);
  vec3 warm = vec3(1., .67843, .33333);
  vec3 green = vec3(0., .8, .26667);
  vec3 cyan = vec3(0., .66667, .8);
  vec3 tint;
  if (phase < .2) tint = mix(blue, magenta, smoothstep(0., .2, phase));
  else if (phase < .4) tint = mix(magenta, warm, smoothstep(.2, .4, phase));
  else if (phase < .6) tint = mix(warm, green, smoothstep(.4, .6, phase));
  else if (phase < .8) tint = mix(green, cyan, smoothstep(.6, .8, phase));
  else tint = mix(cyan, blue, smoothstep(.8, 1., phase));
  return mix(tint, vec3(1.), .34);
}
vec3 audioColor(vec3 p, vec3 resting) {
  vec3 listening = mix(resting, vec3(1.), uListening);
  return mix(listening, deskVoiceColor(p), uSpeaking);
}
`;

export function Brain({
  snapshot,
  reducedMotion,
  voice,
  realtime = false,
}: {
  snapshot: Snapshot;
  reducedMotion: boolean;
  voice?: VoiceSignal;
  realtime?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(snapshot);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const reduced = useRef(reducedMotion);
  latest.current = snapshot;
  reduced.current = reducedMotion;
  const live = useRef(realtime);
  live.current = realtime;
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
    } catch {
      setUnavailable(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    element.append(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 50);
    camera.position.set(0, 0, 6.8);
    const group = new THREE.Group();
    scene.add(group);
    const coreMotion = createCoreMotion();
    const outputSignal = createOutputSignal();
    const sceneClock = createSceneClock();
    const realtimeClock = createRealtimeSceneClock();
    const uniforms = {
      uTime: { value: 0 },
      uActivity: { value: 0 },
      uVoice: { value: 0 },
      uOutput: { value: 0 },
      uListening: { value: 0 },
      uSpeaking: { value: 0 },
      uVoiceColorTime: { value: 0 },
      uViewDistance: { value: camera.position.z },
    };
    const data = brainGeometry();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(data.points, 3),
    );
    geometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3));
    const material = new THREE.ShaderMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms,
      vertexShader:
        coreDeformation +
        voiceColorShader +
        `uniform float uViewDistance;
        varying vec3 vColor;
        varying float vDepth;
        varying float vVoiceTint;
        void main() {
          vec3 local = corePosition(position);
          vec4 p = modelViewMatrix * vec4(local, 1.);
          vec3 facing = normalize(normalMatrix * normalize(local));
          float light = .38 + .62 * max(0., dot(facing, normalize(vec3(-.5, .7, 1.))));
          vColor = audioColor(local, color) * light;
          vVoiceTint = max(uListening, uSpeaking);
          vDepth = clamp(.5 + (p.z + uViewDistance) * .22, .08, 1.);
          gl_Position = projectionMatrix * p;
          gl_PointSize = (1.35 + uVoice * .45 + uOutput * .12) * clamp(uViewDistance / -p.z, .65, 1.6);
        }`,
      fragmentShader:
        "varying vec3 vColor; varying float vDepth; varying float vVoiceTint; void main(){float d=length(gl_PointCoord-vec2(.5)); if(d>.5)discard; gl_FragColor=vec4(vColor,(1.-smoothstep(.08,.5,d))*(.1+vDepth*.65)*(1.+vVoiceTint*.35));}",
    });
    group.add(new THREE.Points(geometry, material));
    const edges = new THREE.BufferGeometry();
    edges.setAttribute("position", new THREE.BufferAttribute(data.edges, 3));
    const edgeMaterial = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader:
        coreDeformation +
        voiceColorShader +
        "uniform float uViewDistance; varying float vDepth; varying vec3 vColor; varying float vVoiceTint; void main(){vec3 local=corePosition(position); vec4 p=modelViewMatrix*vec4(local,1.); vColor=audioColor(local,vec3(.72)); vVoiceTint=max(uListening,uSpeaking); vDepth=clamp(.5+(p.z+uViewDistance)*.22,.08,1.);gl_Position=projectionMatrix*p;}",
      fragmentShader:
        "varying float vDepth; varying vec3 vColor; varying float vVoiceTint; void main(){gl_FragColor=vec4(vColor,(.012+vDepth*.065)*(1.+vVoiceTint*.9));}",
    });
    group.add(new THREE.LineSegments(edges, edgeMaterial));
    let width = 1;
    let height = 1;
    let dirty = true;
    const size = () => {
      ({ width, height } = element.getBoundingClientRect());
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      camera.position.z = Math.max(
        6.8,
        1.25 + 2.9 / (Math.tan(halfFov) * Math.min(camera.aspect, 1)),
      );
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      uniforms.uViewDistance.value = camera.position.z;
      dirty = true;
    };
    const observer = new ResizeObserver(size);
    observer.observe(element);
    size();
    let frame = 0;
    const contextLost = (event: Event) => {
      event.preventDefault();
      setUnavailable(true);
      cancelAnimationFrame(frame);
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    let previousRevision = -1;
    let previousReduced = reduced.current;
    let previousDisplayTime = -1;
    const voiceEnvelope = createVoiceEnvelope(performance.now());
    const render = (now = performance.now()) => {
      const state = latest.current;
      const liveTime = realtimeClock(state.playing && !reduced.current, now);
      const displayTime = live.current
        ? liveTime
        : sceneClock(state.time, state.playing, now);
      const signal = voiceRef.current?.sample(now);
      const audio = voiceEnvelope(signal, now, state.playing, reduced.current);
      uniforms.uListening.value = audio.listening;
      uniforms.uSpeaking.value = audio.speaking;
      uniforms.uVoiceColorTime.value = audio.colorTime;
      element.dataset.voiceMode = audio.mode;
      element.dataset.voiceLevel = audio.level.toFixed(3);
      element.dataset.listeningTint = audio.listening.toFixed(3);
      element.dataset.speakingTint = audio.speaking.toFixed(3);
      element.dataset.voiceColorTime = audio.colorTime.toFixed(3);
      if (
        audio.changed ||
        dirty ||
        previousReduced !== reduced.current ||
        displayTime !== previousDisplayTime ||
        state.revision !== previousRevision
      ) {
        const pose = coreMotion.sample(displayTime, reduced.current);
        const output = outputSignal(state, displayTime);
        group.rotation.set(pose.x, pose.y, pose.z);
        group.position.y = pose.lift;
        group.scale.setScalar(1.12);
        uniforms.uVoice.value = reduced.current ? 0 : audio.level;
        uniforms.uOutput.value = reduced.current ? 0 : output;
        element.dataset.outputLevel = uniforms.uOutput.value.toFixed(3);
        uniforms.uTime.value = reduced.current ? 0 : displayTime / 1000;
        uniforms.uActivity.value =
          state.tasks.filter((task) => task.status === "running").length / 3;
        renderer.render(scene, camera);
        previousDisplayTime = displayTime;
        previousRevision = state.revision;
        previousReduced = reduced.current;
        dirty = false;
      }
      frame = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(frame);
      coreMotion.dispose();
      observer.disconnect();
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      geometry.dispose();
      edges.dispose();
      material.dispose();
      edgeMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div
      className="brain-canvas"
      ref={host}
      role="group"
      aria-label="Núcleo de partículas 3D que responde a la voz y a las respuestas del agente."
    >
      {unavailable && (
        <p className="webgl-fallback">
          La vista 3D no está disponible en este navegador. Las tareas, el chat
          y el registro siguen funcionando.
        </p>
      )}
    </div>
  );
}
