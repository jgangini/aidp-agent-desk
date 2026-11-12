import { gsap } from "gsap";
import {
  measureFinding,
  resizeDuration,
  type ExpansionCapture,
  type FindingBounds,
} from "./resultsGeometry";

export function animateFindingExpansion(
  root: { current: HTMLElement | null },
  rail: HTMLElement,
  before: ExpansionCapture,
  cards: HTMLElement[],
  finish: () => void,
) {
  const targets = cards.map((card) => ({
    card,
    ...measureFinding(card, rail.scrollTop),
  }));
  return gsap.context(() => {
    const duration = resizeDuration(rail);
    const timeline = gsap.timeline({ onComplete: finish });
    for (const target of targets) {
      const old = before.bounds.get(target.card)!;
      if (target.card.dataset.findingId === before.id)
        target.card.dataset.resizing = "true";
      const summary =
        target.card.querySelector<HTMLElement>(".finding-summary");
      if (summary && target.card.dataset.findingId === before.id) {
        timeline.fromTo(
          summary,
          { height: old.summaryHeight, overflow: "hidden" },
          {
            height: target.summaryHeight,
            duration,
            ease: "power3.out",
            clearProps: "height,overflow",
          },
          0,
        );
      }
      timeline.fromTo(
        target.card,
        {
          x: old.left - target.left,
          y: old.top - target.top,
          height: old.height,
          maxHeight: "none",
        },
        {
          x: 0,
          y: 0,
          height: target.height,
          duration,
          ease: "power3.out",
          clearProps: "height,transform,maxHeight",
        },
        0,
      );
    }
  }, root);
}

export function animateFindingFilter(
  root: { current: HTMLElement | null },
  rail: HTMLElement,
  before: Map<string, FindingBounds>,
  cards: HTMLElement[],
  finish: () => void,
) {
  const targets = cards.map((card) => ({
    card,
    rect: card.getBoundingClientRect(),
    summary: card.querySelector<HTMLElement>(".finding-summary"),
    summaryHeight:
      card.querySelector(".finding-summary")?.getBoundingClientRect().height ??
      0,
  }));
  return gsap.context(() => {
    const timeline = gsap.timeline({ onComplete: finish });
    const duration = resizeDuration(rail);
    for (const { card, rect, summary, summaryHeight } of targets) {
      const old = before.get(card.dataset.findingId!);
      if (old && summary && Math.abs(old.summaryHeight - summaryHeight) > 0.5) {
        card.dataset.resizing = "true";
        timeline.fromTo(
          summary,
          { height: old.summaryHeight, overflow: "hidden" },
          {
            height: summaryHeight,
            duration,
            ease: "power3.out",
            clearProps: "height,overflow",
          },
          0,
        );
      }
      timeline.fromTo(
        card,
        {
          x: old ? old.left - rect.left : 0,
          y: old ? old.top - rect.top : 8,
          opacity: old ? 1 : 0,
          height: old ? old.height : rect.height,
          maxHeight: "none",
        },
        {
          x: 0,
          y: 0,
          opacity: 1,
          height: rect.height,
          duration,
          ease: "power3.out",
          clearProps: "transform,opacity,height,maxHeight",
        },
        0,
      );
    }
  }, root);
}
