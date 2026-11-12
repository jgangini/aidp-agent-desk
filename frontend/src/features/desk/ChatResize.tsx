import { storageKey } from "../../shared/identity";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import "./ChatResize.css";

const widthPreference = "agent-desk.chat-narrow-by";

function savedNarrowBy() {
  try {
    const value = Number(localStorage.getItem(storageKey(widthPreference)));
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  } catch {
    return 0;
  }
}

interface WidthRange {
  minimum: number;
  maximum: number;
  enabled: boolean;
}

function measuredRange(layout: HTMLElement): WidthRange | undefined {
  const style = getComputedStyle(layout);
  const share = Number.parseFloat(style.getPropertyValue("--chat-width-share"));
  const floor = Number.parseFloat(style.getPropertyValue("--chat-width-floor"));
  if (!Number.isFinite(share) || !Number.isFinite(floor)) return undefined;
  const maximum = Math.max(floor, layout.getBoundingClientRect().width * share);
  const minimum = Math.min(maximum, Math.max(400, maximum - 100));
  return {
    minimum,
    maximum,
    enabled:
      style.getPropertyValue("--chat-resize-allowed").trim() !== "0" &&
      maximum - minimum > 0.5,
  };
}

export function useChatResize() {
  const layoutRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const rangeRef = useRef<WidthRange>({
    minimum: 0,
    maximum: 0,
    enabled: false,
  });
  const [narrowBy, setNarrowBy] = useState(savedNarrowBy);
  const narrowRef = useRef(narrowBy);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointer: number; x: number; narrowBy: number } | null>(
    null,
  );
  const change = useCallback((value: number, persist = false) => {
    const { minimum, maximum } = rangeRef.current;
    const next = Math.max(0, Math.min(maximum - minimum, value));
    narrowRef.current = next;
    setNarrowBy(next);
    if (persist) {
      try {
        localStorage.setItem(storageKey(widthPreference), String(next));
      } catch {
        /* Session sizing remains available if storage is blocked. */
      }
    }
  }, []);
  const endDrag = useCallback(() => {
    const pointer = drag.current?.pointer;
    drag.current = null;
    setDragging(false);
    const handle = handleRef.current;
    if (pointer !== undefined && handle?.hasPointerCapture?.(pointer))
      handle.releasePointerCapture(pointer);
  }, []);

  const range = useMeasuredWidth(
    layoutRef,
    rangeRef,
    narrowRef,
    change,
    endDrag,
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!range.enabled || event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      narrowBy: narrowRef.current,
    };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start?.pointer !== event.pointerId) return;
    change(start.narrowBy + event.clientX - start.x, true);
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === event.pointerId) endDrag();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!range.enabled) return;
    const step = event.shiftKey ? 25 : 10;
    const values: Record<string, number> = {
      ArrowLeft: narrowRef.current - step,
      ArrowRight: narrowRef.current + step,
      Home: range.maximum - range.minimum,
      End: 0,
    };
    if (!(event.key in values)) return;
    event.preventDefault();
    change(values[event.key], true);
  };
  return {
    layoutRef,
    handleRef,
    style: { "--chat-narrow-by": `${narrowBy}px` } as CSSProperties,
    range,
    width: range.maximum - narrowBy,
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onLostPointerCapture: endDrag,
      onKeyDown,
    },
  };
}

export function ChatResizeHandle({
  resize,
}: {
  resize: ReturnType<typeof useChatResize>;
}) {
  const hint = useId();
  return (
    <>
      <div
        ref={resize.handleRef}
        className="chat-resize-handle"
        role="separator"
        aria-label="Ajustar ancho del chat"
        aria-orientation="vertical"
        aria-valuemin={Math.round(resize.range.minimum)}
        aria-valuemax={Math.round(resize.range.maximum)}
        aria-valuenow={Math.round(resize.width)}
        aria-valuetext={`${Math.round(resize.width)} píxeles`}
        aria-describedby={hint}
        tabIndex={resize.range.enabled ? 0 : -1}
        hidden={!resize.range.enabled}
        data-dragging={resize.dragging || undefined}
        {...resize.handlers}
      />
      <span id={hint} className="sr-only">
        Arrastra el borde para ajustar el chat. Flecha derecha para estrechar;
        izquierda para ampliar. Inicio para el mínimo y Fin para el máximo.
      </span>
    </>
  );
}

function useMeasuredWidth(
  layoutRef: RefObject<HTMLElement | null>,
  rangeRef: RefObject<WidthRange>,
  narrowRef: RefObject<number>,
  change: (value: number) => void,
  endDrag: () => void,
) {
  const [range, setRange] = useState<WidthRange>({
    minimum: 0,
    maximum: 0,
    enabled: false,
  });
  useLayoutEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    const measure = () => {
      const next = measuredRange(layout);
      if (!next) return;
      rangeRef.current = next;
      setRange((previous) =>
        previous.minimum === next.minimum &&
        previous.maximum === next.maximum &&
        previous.enabled === next.enabled
          ? previous
          : next,
      );
      change(narrowRef.current);
      if (!next.enabled) endDrag();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(layout);
    return () => observer.disconnect();
  }, [change, endDrag, layoutRef, rangeRef, narrowRef]);

  return range;
}
