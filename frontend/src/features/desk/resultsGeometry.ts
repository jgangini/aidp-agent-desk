export interface FindingBounds {
  left: number;
  top: number;
  height: number;
  summaryHeight: number;
}

export interface ExpansionCapture {
  id: string;
  bounds: Map<HTMLElement, FindingBounds>;
}

export function measureFinding(
  card: HTMLElement,
  scrollTop = 0,
): FindingBounds {
  const bounds = card.getBoundingClientRect();
  return {
    left: bounds.left,
    top: bounds.top + scrollTop,
    height: bounds.height,
    summaryHeight:
      card.querySelector(".finding-summary")?.getBoundingClientRect().height ??
      0,
  };
}

export function captureFindingBounds(rail: HTMLElement, scrollTop = 0) {
  return new Map(
    [...rail.querySelectorAll<HTMLElement>(".finding")].map((card) => [
      card,
      measureFinding(card, scrollTop),
    ]),
  );
}

export function observeFindingRows(
  rail: HTMLElement,
  resizing: { current: boolean },
  reflow: { current: () => void },
) {
  const cards = [...rail.querySelectorAll<HTMLElement>(".finding")];
  const measure = () => {
    if (resizing.current) return;
    for (const card of cards) {
      const span = `span ${Math.ceil(card.getBoundingClientRect().height + 12)}`;
      if (card.style.gridRowEnd !== span) card.style.gridRowEnd = span;
    }
  };
  reflow.current = measure;
  measure();
  if (typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(measure);
  observer.observe(rail);
  cards.forEach((card) => observer.observe(card));
  return () => {
    observer.disconnect();
    reflow.current = () => {};
  };
}

export function resizeDuration(element: HTMLElement) {
  const value = getComputedStyle(element)
    .getPropertyValue("--resize-dur")
    .trim();
  const amount = parseFloat(value);
  return Number.isFinite(amount) && amount >= 0
    ? amount * (value.endsWith("ms") ? 0.001 : 1)
    : 0.3;
}
