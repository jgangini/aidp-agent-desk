import { useLayoutEffect, useRef, type RefObject } from "react";
import { gsap } from "gsap";
import type { Finding } from "./types";
import {
  captureFindingBounds,
  observeFindingRows,
  type ExpansionCapture,
  type FindingBounds,
} from "./resultsGeometry";
import {
  animateFindingExpansion,
  animateFindingFilter,
} from "./resultsLayoutMotion";

export function useResultsLayout(
  root: RefObject<HTMLDivElement | null>,
  visibleIDs: string,
  expanded: ReadonlySet<string>,
  query: string,
  reducedMotion: boolean,
) {
  const filterFrom = useRef(new Map<string, FindingBounds>());
  const filterChanged = useRef(false);
  const layoutMotion = useRef<ReturnType<typeof gsap.context> | null>(null);
  const cancelLayout = useRef<() => void>(() => {});
  const resizing = useRef(false);
  const reflow = useRef(() => {});
  const resizeFrom = useRef<ExpansionCapture | null>(null);
  const track = (
    context: ReturnType<typeof gsap.context>,
    finish: () => void,
  ) => {
    layoutMotion.current = context;
    const cleanup = () => {
      if (layoutMotion.current !== context) return;
      layoutMotion.current = null;
      context.revert();
      finish();
    };
    cancelLayout.current = cleanup;
    return cleanup;
  };
  const finishResize = (cards: HTMLElement[]) => () => {
    cards.forEach((card) => delete card.dataset.resizing);
    resizing.current = false;
    reflow.current();
  };
  useLayoutEffect(() => {
    const rail = root.current?.querySelector<HTMLElement>(".findings");
    if (!rail) return;
    return observeFindingRows(rail, resizing, reflow);
  }, [visibleIDs]);
  useLayoutEffect(() => {
    const before = resizeFrom.current;
    resizeFrom.current = null;
    if (!before || reducedMotion) return;
    const rail = root.current?.querySelector<HTMLElement>(".findings");
    if (!rail) return;
    reflow.current();
    const cards = [...before.bounds.keys()].filter((card) => card.isConnected);
    resizing.current = true;
    const finish = finishResize(cards);
    return track(
      animateFindingExpansion(root, rail, before, cards, finish),
      finish,
    );
  }, [expanded, reducedMotion, visibleIDs]);
  useLayoutEffect(() => {
    if (!filterChanged.current) return;
    filterChanged.current = false;
    if (reducedMotion) return;
    const rail = root.current?.querySelector<HTMLElement>(".findings");
    if (!rail) return;
    reflow.current();
    const cards = [...rail.querySelectorAll<HTMLElement>(".finding")];
    resizing.current = true;
    const finish = finishResize(cards);
    return track(
      animateFindingFilter(root, rail, filterFrom.current, cards, finish),
      finish,
    );
  }, [query, reducedMotion]);
  return {
    captureFilter: (changed: boolean) => {
      const rail = root.current?.querySelector<HTMLElement>(".findings");
      filterFrom.current = new Map(
        [
          ...(rail
            ? captureFindingBounds(rail)
            : new Map<HTMLElement, FindingBounds>()),
        ].map(([card, bounds]) => [card.dataset.findingId!, bounds]),
      );
      filterChanged.current = changed;
      cancelLayout.current();
    },
    captureExpansion: (id: string) => {
      const rail = root.current?.querySelector<HTMLElement>(".findings");
      if (!reducedMotion && rail)
        resizeFrom.current = {
          id,
          bounds: captureFindingBounds(rail, rail.scrollTop),
        };
      cancelLayout.current();
    },
  };
}

export function useResultsArrival(
  root: RefObject<HTMLDivElement | null>,
  findings: Finding[],
  reducedMotion: boolean,
) {
  const seenIDs = useRef(new Set<string>());
  const findingIDs = JSON.stringify(findings.map((finding) => finding.id));
  useLayoutEffect(() => {
    const freshIDs = new Set(
      findings
        .filter((finding) => !seenIDs.current.has(finding.id))
        .map((finding) => finding.id),
    );
    findings.forEach((finding) => seenIDs.current.add(finding.id));
    if (!freshIDs.size) return;
    const rail = root.current?.querySelector<HTMLElement>(".findings");
    const follow = () =>
      rail?.scrollTo?.({
        top: rail.scrollHeight,
        behavior: reducedMotion ? "instant" : "smooth",
      });
    if (reducedMotion) {
      follow();
      return;
    }
    const targets = Array.from(
      root.current?.querySelectorAll<HTMLElement>(
        ".finding[data-finding-id]",
      ) ?? [],
    ).filter((card) => freshIDs.has(card.dataset.findingId!));
    if (!targets.length) return;
    const context = gsap.context(() => {
      targets.forEach((card, index) => {
        const skeleton = card.querySelector(".finding-skeleton");
        const content = card.querySelector(".finding-content");
        gsap
          .timeline({
            delay: Math.min(0.24, index * 0.04),
            onStart: follow,
            onComplete: follow,
          })
          .set(skeleton, { display: "flex", opacity: 1 })
          .set(content, { opacity: 0 })
          .fromTo(
            card,
            { height: 72, overflow: "hidden" },
            {
              height: "auto",
              duration: 0.3,
              ease: "expo.out",
              clearProps: "height,overflow",
              onComplete: follow,
            },
          )
          .to(content, { opacity: 1, duration: 0.25, clearProps: "opacity" })
          .to(
            skeleton,
            {
              opacity: 0,
              duration: 0.2,
              onComplete: () => {
                gsap.set(skeleton, { display: "none", clearProps: "opacity" });
              },
            },
            "<",
          );
      });
    }, root);
    return () => context.revert();
  }, [findingIDs, reducedMotion]);
}
