import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { gsap } from "gsap";

function clearGlow(text: string, input: HTMLInputElement) {
  const canvas = document.createElement("canvas").getContext("2d");
  if (!canvas) return "";
  const style = getComputedStyle(input);
  canvas.font = style.font;
  const width = input.parentElement?.clientWidth || input.clientWidth || 280;
  const padding =
    input.offsetLeft + (Number.parseFloat(style.paddingLeft) || 0);
  const gradients: string[] = [];
  let x = 0;
  for (const segment of text.split(/(\s+)/u)) {
    const wordWidth = canvas.measureText(segment).width;
    if (segment.trim()) {
      const center = padding + x + wordWidth / 2;
      const spread = Math.max(wordWidth * 0.45, 8) * 1.5;
      for (const [dx, scale, height, alpha] of [
        [0, 0.8, 7, 0.22],
        [spread * 0.45, 0.55, 8, 0.18],
        [-spread * 0.4, 0.65, 6, 0.16],
        [spread * 0.15, 0.9, 5, 0.14],
      ]) {
        gradients.push(
          `radial-gradient(ellipse ${Math.max(spread * scale, 2)}px ${height}px at ${((center + dx) / width) * 100}% 100%, rgba(255,255,255,${alpha}), transparent)`,
        );
      }
    }
    x += wordWidth;
  }
  return gradients.join(", ");
}

function animateClear(
  panel: HTMLElement,
  input: HTMLInputElement,
  text: string,
  onComplete: () => void,
) {
  return gsap.context(() => {
    const echo = panel.querySelector(".results-clear-echo");
    const placeholder = panel.querySelector(".results-clear-placeholder");
    const glow = panel.querySelector(".results-clear-glow");
    gsap.set(glow, { backgroundImage: clearGlow(text, input) });
    gsap
      .timeline({ onComplete })
      .fromTo(
        echo,
        { y: 0, opacity: 1, filter: "blur(0px)" },
        {
          y: 12,
          opacity: 0,
          filter: "blur(2px)",
          duration: 0.4,
          ease: "expo.out",
        },
        0,
      )
      .fromTo(
        placeholder,
        { y: -12, opacity: 0.9, filter: "blur(2px)" },
        {
          y: 0,
          opacity: 1,
          filter: "blur(0px)",
          duration: 0.4,
          ease: "expo.out",
        },
        0,
      )
      .fromTo(
        glow,
        { opacity: 0 },
        {
          opacity: 0.85,
          duration: 0.1425,
          ease: "none",
        },
        0.05,
      )
      .to(glow, { opacity: 0, duration: 0.8075, ease: "none" }, 0.1925);
  }, panel);
}

export function useResultsSearch(
  root: RefObject<HTMLDivElement | null>,
  query: string,
  reducedMotion: boolean,
  changeQuery: (next: string) => void,
) {
  const input = useRef<HTMLInputElement>(null);
  const clearID = useRef(0);
  const [clearEcho, setClearEcho] = useState<{
    id: number;
    text: string;
  } | null>(null);
  useLayoutEffect(() => {
    if (!clearEcho || !input.current || !root.current) return;
    if (reducedMotion) {
      setClearEcho(null);
      return;
    }
    const context = animateClear(
      root.current,
      input.current,
      clearEcho.text,
      () =>
        setClearEcho((current) =>
          current?.id === clearEcho.id ? null : current,
        ),
    );
    return () => context.revert();
  }, [clearEcho, reducedMotion]);
  const clear = () => {
    if (!query) return;
    setClearEcho(reducedMotion ? null : { id: ++clearID.current, text: query });
    changeQuery("");
    input.current?.focus({ preventScroll: true });
  };
  return {
    input,
    clearEcho,
    clear,
    type: (next: string) => {
      setClearEcho(null);
      changeQuery(next);
    },
  };
}
