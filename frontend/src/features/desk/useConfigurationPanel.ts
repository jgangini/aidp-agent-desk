import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { gsap } from "gsap";
import { usePanelEntrance } from "./usePanelEntrance";

export function useConfigurationPanel({
  busy,
  cancelDiscovery,
  onClose,
  closeRequest,
  title,
  surface,
}: {
  busy: boolean;
  cancelDiscovery: () => void;
  onClose: () => void;
  closeRequest: number;
  title: RefObject<HTMLHeadingElement | null>;
  surface: RefObject<HTMLElement | null>;
}) {
  const transition = useRef<gsap.core.Tween>(null);
  const closing = useRef(false);
  usePanelEntrance(surface, ":scope > header, :scope > form");
  useEffect(() => {
    title.current?.focus();
    return () => {
      transition.current?.kill();
    };
  }, []);
  useEffect(() => {
    if (closeRequest) close();
  }, [closeRequest]);
  const close = () => {
    if (busy || closing.current) return;
    cancelDiscovery();
    if (
      !window.matchMedia?.("(prefers-reduced-motion: no-preference)").matches
    ) {
      onClose();
      return;
    }
    closing.current = true;
    surface.current!.inert = true;
    transition.current = gsap.to(surface.current, {
      autoAlpha: 0,
      y: 4,
      duration: 0.35,
      ease: "expo.out",
      overwrite: true,
      onComplete: onClose,
    });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.key === "Escape" &&
      window.CSS?.supports?.("selector(select:open)") &&
      (event.target as Element).closest("select")?.matches(":open")
    )
      return;
    if (event.key === "Escape" && !busy) {
      event.stopPropagation();
      close();
    }
  };
  return { onKeyDown };
}
