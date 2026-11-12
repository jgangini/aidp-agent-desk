import { useEffect, type RefObject } from "react";
import { gsap } from "gsap";

export function usePanelEntrance(
  surface: RefObject<HTMLElement | null>,
  groups: string,
) {
  useEffect(() => {
    if (!surface.current || typeof window.matchMedia !== "function") return;
    const motion = gsap.matchMedia();
    motion.add("(prefers-reduced-motion: no-preference)", () => {
      gsap
        .timeline({ defaults: { ease: "expo.out" } })
        .addLabel("enter", 0)
        .fromTo(
          surface.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.25, clearProps: "opacity" },
          "enter",
        )
        .fromTo(
          surface.current!.querySelectorAll(groups),
          { y: 8 },
          { y: 0, duration: 0.32, stagger: 0.04, clearProps: "transform" },
          "enter",
        );
    });
    return () => motion.revert();
  }, [surface, groups]);
}
