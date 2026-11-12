import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

const days = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
export function ScheduledDayPicker({
  selected,
  multiple,
  onChange,
}: {
  selected: number[];
  multiple: boolean;
  onChange: (days: number[]) => void;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const place = useCallback(() => {
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds && menu.current)
      menu.current.style.maxHeight = `${Math.min(300, Math.max(0, innerHeight - bounds.bottom - 14))}px`;
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);
  const label = multiple ? "Días de la semana" : "Día de la semana";
  const close = () => {
    menu.current?.hidePopover?.();
    trigger.current?.focus();
  };
  return (
    <div
      className="scheduled-day-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          menu.current?.hidePopover?.();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (
          event.target === trigger.current &&
          event.key === "ArrowDown"
        ) {
          event.preventDefault();
          menu.current?.showPopover?.();
          menu.current
            ?.querySelector<HTMLInputElement>("input:checked,input")
            ?.focus();
        }
      }}
    >
      <span id={`${id}-label`}>{label}</span>
      <button
        type="button"
        ref={trigger}
        className="scheduled-day-trigger"
        role="combobox"
        aria-labelledby={`${id}-label`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        data-tooltip-disabled="true"
      >
        <span>
          {days.filter((_, index) => selected.includes(index)).join(", ") ||
            "Seleccionar…"}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        className="scheduled-day-menu"
        role="dialog"
        aria-label={label}
        data-tooltip-disabled="true"
        onBeforeToggle={(event) => {
          if (event.newState === "open") place();
        }}
        onToggle={(event) => setOpen(event.newState === "open")}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <fieldset>
          <legend className="sr-only">{label}</legend>
          {days.map((day, index) => (
            <label key={day}>
              <span className="scheduled-day-check">
                <input
                  type={multiple ? "checkbox" : "radio"}
                  name={id}
                  checked={selected.includes(index)}
                  onChange={(event) => {
                    onChange(
                      multiple
                        ? event.target.checked
                          ? [...selected, index]
                          : selected.filter((day) => day !== index)
                        : [index],
                    );
                    if (!multiple) close();
                  }}
                />
                <Check size={11} aria-hidden="true" />
              </span>
              {day}
            </label>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
