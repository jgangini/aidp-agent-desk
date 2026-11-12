import { gsap } from "gsap";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** One decorative build, interrupted by interaction; the composer remains the real control. */
export function useComposerReveal(
  root: RefObject<HTMLElement | null>,
  enabled: boolean,
  contextKey?: string,
) {
  const played = useRef(false);
  useEffect(() => {
    const shell = root.current?.querySelector<HTMLElement>(
      '.aui-welcome-build[data-empty="true"]',
    );
    if (!enabled || played.current || !document.fonts?.ready) {
      if (shell) {
        shell.dataset.reveal = "instant";
        shell.dataset.build = "ready";
      }
      return;
    }
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!shell) return;
    if (!media || media.matches) {
      shell.dataset.reveal = "instant";
      shell.dataset.build = "ready";
      return;
    }
    let stopped = false;
    let frame = 0;
    const runs: { cancel(): void; finished: Promise<unknown> }[] = [];
    const events = ["pointerdown", "keydown", "resize", "scroll"] as const;
    const detach = () => {
      events.forEach((event) =>
        window.removeEventListener(event, interrupt, true),
      );
      media.removeEventListener("change", change);
    };
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      runs.forEach((run) => run.cancel());
      shell.dataset.reveal = "instant";
      shell.dataset.build = "ready";
      detach();
    };
    const interrupt = () => {
      played.current = true;
      stop();
      shell.dataset.build = "ready";
    };
    const change = () => {
      if (media.matches) interrupt();
    };
    events.forEach((event) => window.addEventListener(event, interrupt, true));
    media.addEventListener("change", change);
    void (async () => {
      await document.fonts.ready;
      const { generate } =
        await import("../../shared/vendor/transitions/ui-generation.js");
      if (stopped) return;
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (stopped || !shell.isConnected) return;
          played.current = true;
          shell.dataset.build = "drawing";
          const blocks = [".aui-composer-shell"];
          try {
            blocks.forEach((selector, index) => {
              const block = shell.querySelector<HTMLElement>(selector);
              if (block)
                runs.push(
                  generate(block, {
                    mode: "skeleton",
                    variant: "ui",
                    duration: 2400,
                    delay: index * 260,
                  }),
                );
            });
          } catch {
            stop();
          }
          void Promise.all(runs.map((run) => run.finished)).then(() => {
            if (stopped) return;
            shell.dataset.reveal = "animated";
            shell.dataset.build = "ready";
            detach();
          });
        });
      });
    })().catch(() => {
      stop();
      shell.dataset.build = "unavailable";
    });
    return stop;
  }, [root, enabled, contextKey]);
}

/** Capture before submission so the same composer can settle into its conversation position. */
export function useComposerTransition(
  root: RefObject<HTMLElement | null>,
  messageCount: number,
  reducedMotion: boolean,
) {
  const previous = useRef<{ form: Element; bounds: DOMRect } | null>(null);
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = null;
    const form = root.current?.querySelector<HTMLElement>(".aui-composer-root");
    if (!before || !form || before.form !== form || reducedMotion) return;
    const after = form.getBoundingClientRect();
    const context = gsap.context(() => {
      gsap.fromTo(
        form,
        { y: before.bounds.top - after.top },
        { y: 0, duration: 0.45, ease: "power3.out", clearProps: "transform" },
      );
      const message = Array.from(
        root.current?.querySelectorAll(".aui-user-message") ?? [],
      ).at(-1);
      if (message)
        gsap.fromTo(
          message,
          { opacity: 0, y: 8 },
          { opacity: 1, y: 0, duration: 0.3, clearProps: "opacity,transform" },
        );
    }, root);
    return () => context.revert();
  }, [messageCount, reducedMotion, root]);
  return () => {
    const form = root.current?.querySelector(".aui-composer-root");
    previous.current = form
      ? { form, bounds: form.getBoundingClientRect() }
      : null;
  };
}
