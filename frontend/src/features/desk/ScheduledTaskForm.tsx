import { useId, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { ScheduledDateField } from "./ScheduledDateField";
import { ScheduledDayPicker } from "./ScheduledDayPicker";
import { SelectValue } from "../../shared/SelectValue";
import {
  validateTask,
  type Repeat,
  type ScheduledTask,
} from "./scheduledTasks";

const repeats: { value: Repeat; label: string }[] = [
  { value: "once", label: "Nunca" },
  { value: "hourly", label: "Cada hora" },
  { value: "daily", label: "Diario" },
  { value: "weekdays", label: "Días de semana" },
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensual" },
  { value: "custom", label: "Personalizado" },
];
const zones = [
  "America/Lima",
  "America/Bogota",
  "America/Mexico_City",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "Europe/Madrid",
  "UTC",
  ...(typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : []),
]
  .filter((zone, index, all) => all.indexOf(zone) === index)
  .sort();

export function ScheduledTaskForm({
  task,
  agents,
  onSave,
  error,
  warning = false,
  onAgentChange,
  submitLabel = "Guardar",
  disabled = false,
  onCancel,
}: {
  task: ScheduledTask;
  agents: { id: string; name: string }[];
  onSave: (task: ScheduledTask) => void;
  error?: string;
  warning?: boolean;
  onAgentChange?: () => void;
  submitLabel?: string;
  disabled?: boolean;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<ScheduledTask>(() => ({
    ...task,
    days: [...task.days],
  }));
  const [validation, setValidation] = useState<string>();
  const [validationField, setValidationField] = useState<
    "name" | "instructions"
  >();
  const [endOnDate, setEndOnDate] = useState(!!task.endDate);
  const update = (patch: Partial<ScheduledTask>) => {
    setValidation(undefined);
    setValidationField(undefined);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const notice = validation ?? error;
  return (
    <form
      className="scheduled-task-form agent-config-form"
      noValidate
      data-tooltip-disabled="true"
      onSubmit={(event) => {
        event.preventDefault();
        const field =
          !draft.name.trim() || draft.name.length > 120
            ? "name"
            : !draft.instructions.trim() || draft.instructions.length > 500
              ? "instructions"
              : undefined;
        const problem =
          field === "name"
            ? "Escribe un nombre de hasta 120 caracteres."
            : field === "instructions"
              ? "Escribe instrucciones de hasta 500 caracteres."
              : draft.repeat !== "once" && endOnDate && !draft.endDate
                ? "Selecciona una fecha de fin válida."
                : validateTask(draft);
        setValidationField(field);
        setValidation(problem);
        if (!problem && !disabled) onSave({ ...draft, days: [...draft.days] });
      }}
    >
      <div className="config-fields">
        <ScheduledDescription
          draft={draft}
          update={update}
          validation={validation}
          validationField={validationField}
        />
        <label className="scheduled-full">
          Agent Flow
          <select
            className="t-input"
            aria-label="Agent Flow"
            value={draft.agentId}
            onChange={(event) => {
              const agent = agents.find(
                (item) => item.id === event.target.value,
              );
              if (agent) {
                onAgentChange?.();
                update({ agentId: agent.id, agentName: agent.name });
              }
            }}
          >
            <SelectValue />
            {!agents.some((agent) => agent.id === draft.agentId) && (
              <option value={draft.agentId}>
                {draft.agentName} (no disponible)
              </option>
            )}
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <ScheduledTiming
          draft={draft}
          update={update}
          endOnDate={endOnDate}
          setEndOnDate={setEndOnDate}
        />
      </div>
      {notice && !validationField && (
        <p
          className={`config-feedback ${validation || warning ? "config-feedback-warning" : "config-feedback-error"}`}
          role="alert"
        >
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{notice}</span>
        </p>
      )}
      <footer className="scheduled-task-footer">
        {onCancel && (
          <button
            type="button"
            className="config-cancel"
            onClick={onCancel}
            disabled={disabled}
          >
            Cancelar
          </button>
        )}
        <button type="submit" className="save-profile" disabled={disabled}>
          {submitLabel}
        </button>
      </footer>
    </form>
  );
}

type UpdateTask = (patch: Partial<ScheduledTask>) => void;
function ScheduledDescription({
  draft,
  update,
  validation,
  validationField,
}: {
  draft: ScheduledTask;
  update: UpdateTask;
  validation?: string;
  validationField?: "name" | "instructions";
}) {
  const nameErrorId = useId();
  const instructionErrorId = useId();
  const wordCountId = useId();
  const characters = draft.instructions.length;
  return (
    <>
      <label className="scheduled-full">
        Nombre de la tarea
        <input
          className={`t-input${validationField === "name" ? " is-warning" : ""}`}
          aria-label="Nombre de la tarea"
          autoFocus
          aria-invalid={validationField === "name" || undefined}
          aria-describedby={
            validationField === "name" ? nameErrorId : undefined
          }
          value={draft.name}
          maxLength={120}
          onChange={(event) => update({ name: event.target.value })}
        />
        {validationField === "name" && (
          <span
            id={nameErrorId}
            role="alert"
            className="config-feedback config-feedback-warning scheduled-field-warning"
          >
            <TriangleAlert size={16} aria-hidden="true" />
            {validation}
          </span>
        )}
      </label>
      <label className="scheduled-full">
        <span>Instrucciones</span>
        <span className="scheduled-instructions">
          <textarea
            className={`t-input${validationField === "instructions" ? " is-warning" : ""}`}
            value={draft.instructions}
            maxLength={500}
            aria-label="Instrucciones"
            aria-describedby={`${wordCountId}${validationField === "instructions" ? ` ${instructionErrorId}` : ""}`}
            aria-invalid={validationField === "instructions" || undefined}
            rows={4}
            onChange={(event) => update({ instructions: event.target.value })}
          />
          <span id={wordCountId} className="scheduled-word-count" role="status">
            {characters} / 500 caracteres
          </span>
        </span>
        {validationField === "instructions" && (
          <span
            id={instructionErrorId}
            role="alert"
            className="config-feedback config-feedback-warning scheduled-field-warning"
          >
            <TriangleAlert size={16} aria-hidden="true" />
            {validation}
          </span>
        )}
      </label>
    </>
  );
}

function ScheduledTiming({
  draft,
  update,
  endOnDate,
  setEndOnDate,
}: {
  draft: ScheduledTask;
  update: UpdateTask;
  endOnDate: boolean;
  setEndOnDate: (value: boolean) => void;
}) {
  const changeRepeat = (repeat: Repeat) => {
    if (repeat === "once") setEndOnDate(false);
    const startDay = new Date(`${draft.startDate}T00:00:00Z`).getUTCDay();
    update({
      repeat,
      days:
        repeat === "weekly"
          ? [draft.days[0] ?? (Number.isFinite(startDay) ? startDay : 1)]
          : repeat === "weekdays" && !draft.days.length
            ? [1, 2, 3, 4, 5]
            : draft.days,
      ...(repeat === "once" ? { endDate: "" } : {}),
    });
  };
  return (
    <>
      <label className="scheduled-full">
        Repetir
        <select
          className="t-input"
          aria-label="Repetir"
          value={draft.repeat}
          onChange={(event) => changeRepeat(event.target.value as Repeat)}
        >
          <SelectValue />
          {repeats.map((repeat) => (
            <option key={repeat.value} value={repeat.value}>
              {repeat.label}
            </option>
          ))}
        </select>
      </label>
      <ScheduledDateField
        label="Fecha de inicio"
        value={draft.startDate}
        onChange={(startDate) => update({ startDate })}
      />
      <label>
        Hora
        <input
          className="t-input"
          type="time"
          value={draft.time}
          onChange={(event) => update({ time: event.target.value })}
        />
      </label>
      <label className={draft.repeat === "once" ? "scheduled-full" : undefined}>
        Zona horaria
        <select
          className="t-input"
          aria-label="Zona horaria"
          value={draft.timeZone}
          onChange={(event) => update({ timeZone: event.target.value })}
        >
          <SelectValue />
          {!zones.includes(draft.timeZone) && (
            <option value={draft.timeZone}>{draft.timeZone}</option>
          )}
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>
      {draft.repeat !== "once" && (
        <label>
          Finalizar
          <select
            className="t-input"
            aria-label="Finalizar"
            value={endOnDate ? "date" : "never"}
            onChange={(event) => {
              setEndOnDate(event.target.value === "date");
              update({
                endDate: event.target.value === "date" ? draft.startDate : "",
              });
            }}
          >
            <SelectValue />
            <option value="never">Nunca</option>
            <option value="date">En una fecha</option>
          </select>
        </label>
      )}
      {(draft.repeat === "weekdays" || draft.repeat === "weekly") && (
        <ScheduledDayPicker
          selected={draft.days}
          multiple={draft.repeat === "weekdays"}
          onChange={(days) => update({ days })}
        />
      )}
      {draft.repeat === "monthly" && (
        <label className="scheduled-full">
          Día del mes
          <input
            className="t-input"
            type="number"
            min={1}
            max={31}
            value={draft.monthDay || ""}
            onChange={(event) =>
              update({ monthDay: Number(event.target.value) })
            }
          />
        </label>
      )}
      {draft.repeat === "custom" && (
        <>
          <label>
            Cada
            <input
              className="t-input"
              type="number"
              min={1}
              max={365}
              value={draft.interval || ""}
              onChange={(event) =>
                update({ interval: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Unidad
            <select
              className="t-input"
              aria-label="Unidad"
              value={draft.unit}
              onChange={(event) =>
                update({ unit: event.target.value as ScheduledTask["unit"] })
              }
            >
              <SelectValue />
              {(
                [
                  ["minutes", "Minutos"],
                  ["hours", "Horas"],
                  ["days", "Días"],
                  ["weeks", "Semanas"],
                  ["months", "Meses"],
                ] as const
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {draft.repeat !== "once" && (
        <>
          {endOnDate && (
            <ScheduledDateField
              label="Fecha de fin"
              value={draft.endDate}
              min={draft.startDate}
              onChange={(endDate) => update({ endDate })}
            />
          )}
        </>
      )}
    </>
  );
}
