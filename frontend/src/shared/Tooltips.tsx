import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";

const triggers =
  'button, summary, [role="option"], [role="menuitem"], [data-tooltip]';

function available(target: HTMLElement) {
  if (
    !target.isConnected ||
    target.matches(':disabled, [disabled], [aria-disabled="true"]') ||
    target.closest('[hidden], [inert], [aria-hidden="true"]')
  )
    return false;
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (
      style.display === "none" ||
      ["hidden", "collapse"].includes(style.visibility)
    )
      return false;
  }
  return true;
}

function label(target: HTMLElement, title: string | null) {
  return (
    target.getAttribute("data-tooltip") ||
    target.getAttribute("aria-label") ||
    title ||
    target.textContent ||
    ""
  ).trim();
}

interface TooltipView {
  target: HTMLElement;
  text: string;
  open: boolean;
  travel: boolean;
  x: number;
  y: number;
  width: number;
  side: "top" | "bottom";
}

class TooltipController {
  private active: {
    target: HTMLElement;
    title: string | null;
    description: string | null;
  } | null = null;
  private keyboard = true;
  private visible = false;
  private hover: ReturnType<typeof setTimeout> | undefined = undefined;
  private leave: ReturnType<typeof setTimeout> | undefined = undefined;
  private removal: ReturnType<typeof setTimeout> | undefined = undefined;
  private observer = new MutationObserver(() => {
    if (this.active && !available(this.active.target)) this.hide();
    else if (this.visible) this.show();
  });
  private restore = () => {
    if (!this.active) return;
    if (this.active.title !== null && !this.active.target.hasAttribute("title"))
      this.active.target.setAttribute("title", this.active.title);
    const described = (
      this.active.target.getAttribute("aria-describedby") || ""
    )
      .split(/\s+/u)
      .filter((token) => token && token !== this.id)
      .join(" ");
    if (described)
      this.active.target.setAttribute("aria-describedby", described);
    else if (this.active.description !== null)
      this.active.target.setAttribute(
        "aria-describedby",
        this.active.description,
      );
    else this.active.target.removeAttribute("aria-describedby");
    this.active = null;
  };
  private hide = () => {
    clearTimeout(this.hover);
    clearTimeout(this.leave);
    clearTimeout(this.removal);
    this.observer.disconnect();
    this.restore();
    this.visible = false;
    this.setView((current) => (current ? { ...current, open: false } : null));
    this.removal = setTimeout(() => this.setView(null), 50);
  };
  private show = () => {
    if (!this.active || !available(this.active.target)) {
      this.hide();
      return;
    }
    const text = label(this.active.target, this.active.title);
    if (!text) {
      this.hide();
      return;
    }
    this.visible = true;
    const target = this.active.target;
    const described = new Set(
      (target.getAttribute("aria-describedby") || "")
        .split(/\s+/u)
        .filter(Boolean),
    );
    described.add(this.id);
    target.setAttribute("aria-describedby", [...described].join(" "));
    this.setView((current) =>
      current?.target === target && current.text === text && current.open
        ? current
        : {
            target,
            text,
            open: true,
            travel: current?.open === true,
            x: current?.x ?? 8,
            y: current?.y ?? 8,
            width: current?.width ?? 0,
            side: current?.side ?? "top",
          },
    );
  };
  private trigger = (target: EventTarget | null) => {
    const control =
      target instanceof Element ? target.closest<HTMLElement>(triggers) : null;
    return control?.closest(this.rootSelector) &&
      !control.closest('[data-tooltip-disabled="true"]') &&
      available(control)
      ? control
      : null;
  };
  private prepare = (target: HTMLElement, immediate: boolean) => {
    clearTimeout(this.hover);
    clearTimeout(this.leave);
    clearTimeout(this.removal);
    if (this.active?.target === target) {
      if (immediate || this.visible) this.show();
      else this.hover = setTimeout(this.show, 80);
      return;
    }
    this.observer.disconnect();
    this.restore();
    this.active = {
      target,
      title: target.getAttribute("title"),
      description: target.getAttribute("aria-describedby"),
    };
    target.removeAttribute("title");
    const root = target.closest(this.rootSelector)!;
    this.observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "hidden",
        "inert",
        "aria-hidden",
        "disabled",
        "aria-disabled",
        "aria-label",
        "data-tooltip",
        "class",
        "style",
      ],
    });
    if (root.parentElement)
      this.observer.observe(root.parentElement, { childList: true });
    if (immediate || this.visible) this.show();
    else this.hover = setTimeout(this.show, 80);
  };
  private over = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    if (
      event.target instanceof Node &&
      this.bubble.current?.contains(event.target)
    ) {
      clearTimeout(this.leave);
      return;
    }
    const target = this.trigger(event.target);
    if (target) this.prepare(target, false);
  };
  private out = (event: PointerEvent) => {
    if (
      !this.active ||
      !(event.target instanceof Node) ||
      !(
        this.active.target.contains(event.target) ||
        this.bubble.current?.contains(event.target)
      )
    )
      return;
    if (
      event.relatedTarget instanceof Node &&
      (this.active.target.contains(event.relatedTarget) ||
        this.bubble.current?.contains(event.relatedTarget))
    )
      return;
    clearTimeout(this.hover);
    clearTimeout(this.leave);
    this.leave = setTimeout(this.hide, 80);
  };
  private focus = (event: FocusEvent) => {
    const target = this.trigger(event.target);
    if (this.keyboard && target) this.prepare(target, true);
  };
  private blur = (event: FocusEvent) => {
    if (
      this.active &&
      event.target instanceof Node &&
      this.active.target.contains(event.target) &&
      !(
        event.relatedTarget instanceof Node &&
        this.active.target.contains(event.relatedTarget)
      )
    )
      this.hide();
  };
  private key = (event: KeyboardEvent) => {
    this.keyboard = true;
    if (event.key === "Escape") this.hide();
  };
  private pointer = () => {
    this.keyboard = false;
    this.hide();
  };
  constructor(
    private id: string,
    private rootSelector: string,
    private bubble: { current: HTMLDivElement | null },
    private setView: Dispatch<SetStateAction<TooltipView | null>>,
  ) {
    this.setView(null);
    document.addEventListener("pointerover", this.over);
    document.addEventListener("pointerout", this.out);
    document.addEventListener("pointerleave", this.out, true);
    document.addEventListener("focusin", this.focus);
    document.addEventListener("focusout", this.blur);
    document.addEventListener("keydown", this.key, true);
    document.addEventListener("pointerdown", this.pointer, true);
    document.addEventListener("click", this.hide, true);
    document.addEventListener("scroll", this.hide, true);
    window.addEventListener("resize", this.hide);
  }
  dispose() {
    clearTimeout(this.hover);
    clearTimeout(this.leave);
    clearTimeout(this.removal);
    this.observer.disconnect();
    this.restore();
    document.removeEventListener("pointerover", this.over);
    document.removeEventListener("pointerout", this.out);
    document.removeEventListener("pointerleave", this.out, true);
    document.removeEventListener("focusin", this.focus);
    document.removeEventListener("focusout", this.blur);
    document.removeEventListener("keydown", this.key, true);
    document.removeEventListener("pointerdown", this.pointer, true);
    document.removeEventListener("click", this.hide, true);
    document.removeEventListener("scroll", this.hide, true);
    window.removeEventListener("resize", this.hide);
  }
}

export function Tooltips({ rootSelector = ".app" }: { rootSelector?: string }) {
  const id = `site-tooltip-${useId().replace(/:/g, "")}`;
  const bubble = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<TooltipView | null>(null);

  useLayoutEffect(() => {
    if (!view?.open || !bubble.current) return;
    const tip = bubble.current;
    const text = tip.querySelector(".site-tooltip-text")!;
    const content = text.getBoundingClientRect();
    const style = getComputedStyle(tip);
    const width = Math.min(
      window.innerWidth - 16,
      Math.ceil(
        content.width +
          (parseFloat(style.paddingLeft) || 12) +
          (parseFloat(style.paddingRight) || 12),
      ),
    );
    const height = Math.ceil(
      content.height +
        (parseFloat(style.paddingTop) || 8) +
        (parseFloat(style.paddingBottom) || 8),
    );
    const target = view.target.getBoundingClientRect();
    const x = Math.max(
      8,
      Math.min(
        window.innerWidth - width - 8,
        target.left + target.width / 2 - width / 2,
      ),
    );
    const side = target.top - height - 8 < 8 ? "bottom" : "top";
    const y = Math.max(
      8,
      Math.min(
        window.innerHeight - height - 8,
        side === "bottom" ? target.bottom + 8 : target.top - height - 8,
      ),
    );
    setView((current) =>
      current?.target === view.target && current.open
        ? { ...current, x, y, width, side }
        : current,
    );
  }, [view?.target, view?.text, view?.open]);

  useEffect(() => {
    const controller = new TooltipController(id, rootSelector, bubble, setView);
    return () => controller.dispose();
  }, [id, rootSelector]);

  return (
    view &&
    createPortal(
      <div
        ref={bubble}
        id={id}
        role="tooltip"
        aria-hidden={!view.open}
        className="site-tooltip"
        data-open={view.open}
        data-travel={view.travel}
        data-side={view.side}
        style={{
          position: "fixed",
          left: view.x,
          top: view.y,
          width: view.width || undefined,
          maxWidth: "calc(100vw - 16px)",
        }}
      >
        <span
          className="site-tooltip-text"
          style={{
            display: "block",
            width: "max-content",
            maxWidth: "calc(100vw - 40px)",
            overflowWrap: "anywhere",
            whiteSpace: "normal",
          }}
        >
          {view.text}
        </span>
      </div>,
      document.body,
    )
  );
}
