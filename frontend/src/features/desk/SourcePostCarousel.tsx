import { useEffect, useRef, type ReactNode } from "react";

export function SourcePostCarousel({
  postIds,
  activeIndex,
  onSelect,
  children,
  afterNavigation,
}: {
  postIds: string[];
  activeIndex: number;
  onSelect: (index: number) => void;
  children: ReactNode;
  afterNavigation: ReactNode;
}) {
  const dotsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dots = dotsRef.current;
    const selected = dots?.querySelector<HTMLButtonElement>(
      `[data-post-index="${activeIndex}"]`,
    );
    if (!dots || !selected) return;
    const rail = dots.getBoundingClientRect();
    const dot = selected.getBoundingClientRect();
    if (dot.left < rail.left) dots.scrollLeft -= rail.left - dot.left;
    else if (dot.right > rail.right) dots.scrollLeft += dot.right - rail.right;
  }, [activeIndex, postIds.length]);
  return (
    <div
      className="source-posts source-post-carousel"
      role="region"
      aria-roledescription="carrusel"
      aria-label="Publicaciones de la fuente"
      onKeyDown={(event) => {
        if (
          !postIds.length ||
          (event.target as Element).closest(
            "dialog,input,textarea,select,[contenteditable]",
          )
        )
          return;
        const next =
          event.key === "ArrowRight"
            ? (activeIndex + 1) % postIds.length
            : event.key === "ArrowLeft"
              ? (activeIndex + postIds.length - 1) % postIds.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? postIds.length - 1
                  : -1;
        if (next < 0) return;
        event.preventDefault();
        onSelect(next);
        event.currentTarget
          .querySelector<HTMLButtonElement>(`[data-post-index="${next}"]`)
          ?.focus();
      }}
    >
      {children}
      {postIds.length > 0 && (
        <div
          ref={dotsRef}
          className="source-post-dots"
          data-tooltip-disabled="true"
          role="group"
          aria-label="Seleccionar publicación"
        >
          {postIds.map((id, index) => (
            <button
              type="button"
              key={id}
              aria-label={`Ver publicación ${index + 1}`}
              aria-current={activeIndex === index ? "true" : undefined}
              tabIndex={activeIndex === index ? 0 : -1}
              data-post-index={index}
              onClick={() => onSelect(index)}
            />
          ))}
        </div>
      )}
      {afterNavigation}
    </div>
  );
}
