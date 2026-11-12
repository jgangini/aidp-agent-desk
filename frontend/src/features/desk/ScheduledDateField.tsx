import {
  useCallback,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import "./ScheduledDateField.css";

function localISO(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDate(value: string) {
  return new Date(`${value}T12:00:00`);
}

function keyboardDate(first: Date, day: number, key: string): Date | undefined {
  const shifts: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
  };
  const shift = shifts[key];
  if (shift === undefined && key !== "Home" && key !== "End") return;
  const weekday =
    (new Date(first.getFullYear(), first.getMonth(), day, 12).getDay() + 6) % 7;
  const next = new Date(
    first.getFullYear(),
    first.getMonth(),
    day + (shift ?? (key === "Home" ? -weekday : 6 - weekday)),
    12,
  );
  return next;
}

export function ScheduledDateField({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() =>
    parseDate(value || localISO(new Date())),
  );
  const today = localISO(new Date());
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const count = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
    12,
  ).getDate();
  const offset = (first.getDay() + 6) % 7;
  const heading = first.toLocaleDateString("es", {
    month: "long",
    year: "numeric",
  });

  const close = () => {
    popup.current?.hidePopover?.();
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (next: string) => {
    if (next && min && next < min) return;
    onChange(next);
    close();
  };
  const place = useDatePlacement(field, popup, open);

  return (
    <div
      className="scheduled-date-field"
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <label htmlFor={`${id}-input`}>{label}</label>
      <div className="scheduled-date-control" ref={field}>
        <input
          id={`${id}-input`}
          className="t-input"
          type="date"
          value={value}
          min={min}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          ref={trigger}
          type="button"
          className="scheduled-date-trigger"
          aria-label={`Abrir calendario: ${label}`}
          aria-expanded={open}
          aria-controls={`${id}-calendar`}
          aria-haspopup="dialog"
          popoverTarget={`${id}-calendar`}
          onClick={() => setMonth(parseDate(value || today))}
        >
          <CalendarDays size={16} aria-hidden="true" />
        </button>
      </div>
      <div
        id={`${id}-calendar`}
        ref={popup}
        popover="auto"
        role="dialog"
        aria-label={`Calendario: ${label}`}
        className="scheduled-calendar"
        onBeforeToggle={(event) => {
          if (event.newState === "open") place();
        }}
        onToggle={(event) => {
          const nextOpen = event.newState === "open";
          setOpen(nextOpen);
          if (nextOpen)
            requestAnimationFrame(() => {
              const selected = popup.current?.querySelector<HTMLButtonElement>(
                `[data-date="${value || today}"]:not(:disabled)`,
              );
              (
                selected ??
                popup.current?.querySelector<HTMLButtonElement>(
                  ".scheduled-calendar-day:not(:disabled)",
                )
              )?.focus();
            });
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <header>
          <button
            type="button"
            aria-label="Mes anterior"
            onClick={() =>
              setMonth(
                new Date(first.getFullYear(), first.getMonth() - 1, 1, 12),
              )
            }
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <strong aria-live="polite">{heading}</strong>
          <button
            type="button"
            aria-label="Mes siguiente"
            onClick={() =>
              setMonth(
                new Date(first.getFullYear(), first.getMonth() + 1, 1, 12),
              )
            }
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="scheduled-calendar-grid">
          {["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"].map((day) => (
            <span className="scheduled-calendar-weekday" key={day}>
              {day}
            </span>
          ))}
          {Array.from({ length: offset }, (_, index) => (
            <span key={`empty-${index}`} aria-hidden="true" />
          ))}
          {Array.from({ length: count }, (_, index) => {
            const day = index + 1;
            const date = new Date(
              first.getFullYear(),
              first.getMonth(),
              day,
              12,
            );
            const iso = localISO(date);
            return (
              <button
                key={iso}
                type="button"
                className="scheduled-calendar-day"
                data-date={iso}
                disabled={!!min && iso < min}
                aria-label={date.toLocaleDateString("es", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
                aria-pressed={iso === value}
                aria-current={iso === today ? "date" : undefined}
                onClick={() => choose(iso)}
                onKeyDown={(event) =>
                  navigateDate(event, day, { first, min, setMonth, popup })
                }
              >
                {day}
              </button>
            );
          })}
        </div>
        <footer>
          <button
            type="button"
            disabled={!!min && today < min}
            onClick={() => choose(today)}
          >
            Hoy
          </button>
          <button type="button" onClick={() => choose("")}>
            Borrar
          </button>
        </footer>
      </div>
    </div>
  );
}

function useDatePlacement(
  field: RefObject<HTMLDivElement | null>,
  popup: RefObject<HTMLDivElement | null>,
  open: boolean,
) {
  const place = useCallback(() => {
    const bounds = field.current?.getBoundingClientRect();
    if (!bounds || !popup.current) return;
    const width = Math.min(280, innerWidth - 16);
    popup.current.style.setProperty(
      "--date-left",
      `${Math.max(8, Math.min(bounds.left, innerWidth - width - 8))}px`,
    );
    popup.current.style.setProperty("--date-top", `${bounds.bottom + 6}px`);
    popup.current.style.setProperty(
      "--date-height",
      `${Math.max(0, innerHeight - bounds.bottom - 14)}px`,
    );
  }, [field, popup]);
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

  return place;
}

function navigateDate(
  event: KeyboardEvent<HTMLButtonElement>,
  day: number,
  {
    first,
    min,
    setMonth,
    popup,
  }: {
    first: Date;
    min?: string;
    setMonth: (value: Date) => void;
    popup: RefObject<HTMLDivElement | null>;
  },
) {
  const next = keyboardDate(first, day, event.key);
  if (!next) return;
  event.preventDefault();
  const nextValue = localISO(next);
  if (min && nextValue < min) return;
  setMonth(next);
  requestAnimationFrame(() =>
    popup.current
      ?.querySelector<HTMLButtonElement>(`[data-date="${nextValue}"]`)
      ?.focus(),
  );
}
