import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { Check, ChevronDown, Network } from "lucide-react";
import "./AgentPicker.css";

export function AgentPicker({
  choices,
  selected,
  onSelect,
}: {
  choices: { id: string; name: string }[];
  selected: string;
  onSelect?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const anchor = `--agent-picker-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const current =
    choices.find((choice) => choice.id === selected) ?? choices[0];
  const choose = (index: number) => {
    const choice = choices[index];
    if (choice && choice.id !== selected) onSelect?.(choice.id);
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useAgentMenuPlacement(trigger, menu, open, choices);
  useEffect(() => {
    const option = document.getElementById(`${id}-${active}`);
    const popup = menu.current;
    if (!open || !option || !popup) return;
    const bounds = option.getBoundingClientRect();
    const viewport = popup.getBoundingClientRect();
    if (bounds.top < viewport.top) popup.scrollTop += bounds.top - viewport.top;
    else if (bounds.bottom > viewport.bottom)
      popup.scrollTop += bounds.bottom - viewport.bottom;
  }, [open, active, id]);
  return (
    <div
      className="agent-picker"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setOpen(true);
          setActive((index) =>
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? choices.length - 1
                : !open
                  ? Math.max(
                      0,
                      choices.findIndex((choice) => choice.id === selected),
                    )
                  : (index +
                      (event.key === "ArrowDown" ? 1 : choices.length - 1)) %
                    choices.length,
          );
        } else if (["Enter", " "].includes(event.key) && open) {
          event.preventDefault();
          choose(active);
        } else if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label="Elegir agente"
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        className="aui-agent-picker"
        style={{ anchorName: anchor } as CSSProperties}
        onClick={() => {
          setActive(
            Math.max(
              0,
              choices.findIndex((choice) => choice.id === selected),
            ),
          );
          setOpen(!open);
        }}
      >
        <Network size={14} aria-hidden="true" />
        <span>{current?.name}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      <div
        id={id}
        ref={menu}
        popover="manual"
        style={{ positionAnchor: anchor } as CSSProperties}
        role="listbox"
        aria-label="Agentes disponibles"
        className="agent-picker-menu"
        hidden={!open}
        inert={!open}
      >
        {choices.map((choice, index) => (
          <button
            key={choice.id}
            id={`${id}-${index}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={choice.id === selected}
            className={active === index ? "highlighted" : ""}
            onPointerMove={() => setActive(index)}
            onClick={() => choose(index)}
          >
            <Network size={14} aria-hidden="true" />
            <span>{choice.name}</span>
            {choice.id === selected && <Check size={14} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function useAgentMenuPlacement(
  trigger: RefObject<HTMLButtonElement | null>,
  menu: RefObject<HTMLDivElement | null>,
  open: boolean,
  choices: { id: string; name: string }[],
) {
  useLayoutEffect(() => {
    const popup = menu.current;
    if (!popup) return;
    if (!open) {
      popup.hidePopover?.();
      return;
    }
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      popup.style.setProperty(
        "--agent-picker-width",
        `${Math.max(0, innerWidth - bounds.left - 8)}px`,
      );
      const below = Math.max(0, innerHeight - bounds.bottom - 14);
      const above = Math.max(0, bounds.top - 14);
      const desired = Math.min(260, popup.scrollHeight + 2);
      const upward = below < desired && above > below;
      popup.dataset.placement = upward ? "above" : "below";
      popup.style.setProperty("--agent-picker-top", `${bounds.bottom + 6}px`);
      popup.style.setProperty(
        "--agent-picker-bottom",
        `${innerHeight - bounds.top + 6}px`,
      );
      popup.style.setProperty("--agent-picker-left", `${bounds.left}px`);
      popup.style.setProperty(
        "--agent-picker-height",
        `${upward ? above : below}px`,
      );
    };
    popup.showPopover?.();
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      popup.hidePopover?.();
    };
  }, [open, choices, menu, trigger]);
}
