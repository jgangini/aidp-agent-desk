import { record } from "../../shared/record";
import { storageKey } from "../../shared/identity";
export type Repeat =
  "once" | "hourly" | "daily" | "weekdays" | "weekly" | "monthly" | "custom";

export interface ScheduledTask {
  id: string;
  name: string;
  instructions: string;
  agentId: string;
  agentName: string;
  notify: boolean;
  repeat: Repeat;
  startDate: string;
  time: string;
  timeZone: string;
  days: number[];
  monthDay: number;
  interval: number;
  unit: "minutes" | "hours" | "days" | "weeks" | "months";
  endDate: string;
  status: "active" | "paused" | "completed";
  createdAt: string;
}

export interface ScheduledTaskStore {
  version: 1;
  nextId: number;
  tasks: ScheduledTask[];
}

const key = "agent-desk.scheduled-tasks";
const repeats: readonly string[] = [
  "once",
  "hourly",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "custom",
];
const units: readonly string[] = [
  "minutes",
  "hours",
  "days",
  "weeks",
  "months",
];

const boundedText = (value: unknown, limit: number): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= limit;
const integer = (
  value: unknown,
  minimum: number,
  maximum: number,
): value is number =>
  Number.isSafeInteger(value) &&
  Number(value) >= minimum &&
  Number(value) <= maximum;
const calendarDate = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value.startsWith("0000")
  )
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};
const timeZone = (value: unknown): value is string => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 100 ||
    value.trim() !== value ||
    /^[+-]/.test(value)
  )
    return false;
  try {
    new Intl.DateTimeFormat("es", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export function emptyScheduledTasks(): ScheduledTaskStore {
  return { version: 1, nextId: 1, tasks: [] };
}

export function validateTask(task: unknown): string | undefined {
  if (!record(task)) return "La tarea guardada no es válida.";
  return (
    validateTaskDescription(task) ||
    validateTaskSchedule(task) ||
    validateTaskMetadata(task)
  );
}

function validateTaskDescription(
  task: Record<string, unknown>,
): string | undefined {
  if (
    typeof task.id !== "string" ||
    !/^\d{4,}$/.test(task.id) ||
    !integer(Number(task.id), 1, Number.MAX_SAFE_INTEGER - 1)
  )
    return "El identificador de la tarea no es válido.";
  if (!boundedText(task.name, 120))
    return "Escribe un nombre de hasta 120 caracteres.";
  if (!boundedText(task.instructions, 10000))
    return "Escribe instrucciones de hasta 10000 caracteres.";
  if (!boundedText(task.agentId, 256) || !boundedText(task.agentName, 256))
    return "Selecciona un agente válido.";
  if (typeof task.notify !== "boolean")
    return "La opción de notificación no es válida.";
  return undefined;
}

function validateTaskSchedule(
  task: Record<string, unknown>,
): string | undefined {
  if (typeof task.repeat !== "string" || !repeats.includes(task.repeat))
    return "Selecciona una repetición válida.";
  if (!calendarDate(task.startDate))
    return "Selecciona una fecha de inicio válida.";
  if (
    typeof task.time !== "string" ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(task.time)
  )
    return "Selecciona una hora válida.";
  if (!timeZone(task.timeZone)) return "Selecciona una zona horaria válida.";
  const recurrenceError = validateTaskRecurrence(task);
  if (recurrenceError) return recurrenceError;
  if (
    task.endDate !== "" &&
    (!calendarDate(task.endDate) || task.endDate < task.startDate)
  )
    return "La fecha de fin debe ser válida e igual o posterior al inicio.";
  return undefined;
}

function validateTaskRecurrence(
  task: Record<string, unknown>,
): string | undefined {
  if (
    !Array.isArray(task.days) ||
    task.days.length > 7 ||
    !task.days.every((day) => integer(day, 0, 6)) ||
    new Set(task.days).size !== task.days.length
  )
    return "Los días seleccionados no son válidos.";
  if (task.repeat === "weekdays" && !task.days.length)
    return "Selecciona al menos un día de la semana.";
  if (task.repeat === "weekly" && task.days.length !== 1)
    return "Selecciona un único día para la repetición semanal.";
  if (!integer(task.monthDay, 1, 31))
    return "Selecciona un día del mes entre 1 y 31.";
  if (!integer(task.interval, 1, 365))
    return "El intervalo debe estar entre 1 y 365.";
  if (typeof task.unit !== "string" || !units.includes(task.unit))
    return "Selecciona una unidad de intervalo válida.";
  return undefined;
}

function validateTaskMetadata(
  task: Record<string, unknown>,
): string | undefined {
  if (
    typeof task.status !== "string" ||
    !["active", "paused", "completed"].includes(task.status)
  )
    return "El estado de la tarea no es válido.";
  if (
    typeof task.createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(task.createdAt) ||
    !Number.isFinite(Date.parse(task.createdAt)) ||
    new Date(task.createdAt).toISOString() !== task.createdAt
  )
    return "La fecha de creación no es válida.";
  const fields: (keyof ScheduledTask)[] = [
    "id",
    "name",
    "instructions",
    "agentId",
    "agentName",
    "notify",
    "repeat",
    "startDate",
    "time",
    "timeZone",
    "days",
    "monthDay",
    "interval",
    "unit",
    "endDate",
    "status",
    "createdAt",
  ];
  if (
    Object.keys(task).some(
      (field) => !fields.includes(field as keyof ScheduledTask),
    )
  )
    return "La tarea contiene campos no compatibles.";
  return undefined;
}

function validateStore(value: unknown): asserts value is ScheduledTaskStore {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > 200 ||
    !integer(value.nextId, 1, Number.MAX_SAFE_INTEGER) ||
    Object.keys(value).some(
      (field) => !["version", "nextId", "tasks"].includes(field),
    )
  )
    throw new Error(
      "El archivo local de tareas no es compatible o no es válido.",
    );
  const ids = new Set<number>();
  for (const task of value.tasks) {
    const error = validateTask(task);
    if (error) throw new Error(error);
    const id = Number(task.id);
    if (ids.has(id) || id >= value.nextId)
      throw new Error(
        "Los identificadores o el contador de tareas no son válidos.",
      );
    ids.add(id);
  }
}

function readStore(): ScheduledTaskStore {
  const raw = localStorage.getItem(storageKey(key));
  if (raw === null) return emptyScheduledTasks();
  const value: unknown = JSON.parse(raw);
  validateStore(value);
  return value;
}

export function loadScheduledTasks(): {
  store: ScheduledTaskStore;
  error?: string;
} {
  try {
    return { store: readStore() };
  } catch {
    return {
      store: emptyScheduledTasks(),
      error:
        "No se pudieron leer las tareas guardadas. Se conservaron los datos locales; no guardes cambios hasta resolver el problema.",
    };
  }
}

export function saveScheduledTasks(
  store: ScheduledTaskStore,
  expected?: ScheduledTaskStore,
): void {
  validateStore(store);
  try {
    const current = readStore();
    if (expected && JSON.stringify(current) !== JSON.stringify(expected))
      throw new Error(
        "Las tareas cambiaron en otra pestaña. Recarga las tareas antes de guardar.",
      );
    localStorage.setItem(storageKey(key), JSON.stringify(store));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Las tareas cambiaron")
    )
      throw error;
    throw new Error(
      "No se pudieron guardar las tareas. Los datos guardados previamente se conservaron.",
    );
  }
}
