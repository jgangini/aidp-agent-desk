import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";

export function useHeaderMenu(available = true) {
  const [open, setOpen] = useState(false);
  const expanded = available && open;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = (restore = true) => {
    setOpen(false);
    if (restore) trigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => {
    if (!available && open) close();
  }, [available, open]);
  useEffect(() => {
    if (expanded)
      menu.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
        ?.focus({ preventScroll: true });
  }, [expanded]);
  return {
    expanded,
    open,
    setOpen,
    root,
    trigger,
    menu,
    close,
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) close(false);
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (
        available &&
        ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
      ) {
        event.preventDefault();
        if (!open) setOpen(true);
        else if (menu.current) focusMenuItem(menu.current, event.key);
      }
    },
  };
}

function focusMenuItem(menu: HTMLDivElement, key: string) {
  const items = Array.from(
    menu.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled)',
    ),
  );
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const index =
    key === "Home"
      ? 0
      : key === "End"
        ? items.length - 1
        : (current + (key === "ArrowDown" ? 1 : items.length - 1)) %
          items.length;
  items[index]?.focus({ preventScroll: true });
  items[index]?.scrollIntoView?.({ block: "nearest" });
}
