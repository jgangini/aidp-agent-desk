import { afterEach, expect, it, vi } from "vitest";
import {
  emptyScheduledTasks,
  loadScheduledTasks,
  saveScheduledTasks,
  validateTask,
  type ScheduledTask,
  type ScheduledTaskStore,
} from "./scheduledTasks";

const key = "agent-desk.scheduled-tasks";
function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "0001",
    name: "Informe",
    instructions: "Revisar resultados.",
    agentId: "test:profile",
    agentName: "Agente TEST",
    notify: true,
    repeat: "weekly",
    startDate: "2028-02-29",
    time: "09:30",
    timeZone: "America/Lima",
    days: [2],
    monthDay: 29,
    interval: 1,
    unit: "weeks",
    endDate: "",
    status: "active",
    createdAt: "2026-11-09T12:00:00.000Z",
    ...overrides,
  };
}
function store(tasks = [task()]): ScheduledTaskStore {
  return { version: 1, nextId: 2, tasks };
}
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("starts empty and persists metadata without executing anything or changing TEST identity", () => {
  expect(loadScheduledTasks()).toEqual({ store: emptyScheduledTasks() });
  const fetch = vi.spyOn(window, "fetch");
  const value = store();
  saveScheduledTasks(value);
  expect(loadScheduledTasks()).toEqual({ store: value });
  expect(fetch).not.toHaveBeenCalled();
  const empty = emptyScheduledTasks();
  empty.tasks.push(task());
  expect(emptyScheduledTasks().tasks).toEqual([]);
});

it.each([
  { id: "0000" },
  { id: "12" },
  { id: "9007199254740992" },
  { name: " " },
  { name: "a".repeat(121) },
  { instructions: "" },
  { instructions: "a".repeat(10001) },
  { agentId: "" },
  { agentName: " " },
  { notify: "true" },
  { repeat: "yearly" },
  { startDate: "2027-02-29" },
  { startDate: "2028-04-31" },
  { startDate: "2028-2-01" },
  { time: "24:00" },
  { time: "12:60" },
  { timeZone: "Europe/Unknown" },
  { timeZone: "+01:00" },
  { days: [1, 1] },
  { days: [7] },
  { days: [1.5] },
  { days: [] },
  { days: [1, 2] },
  { repeat: "weekdays", days: [] },
  { monthDay: 0 },
  { monthDay: 32 },
  { interval: 0 },
  { interval: 366 },
  { interval: 1.5 },
  { unit: "years" },
  { endDate: "2028-02-28" },
  { endDate: "2028-02-30" },
  { status: "running" },
  { createdAt: "2028-02-30T12:00:00.000Z" },
  { createdAt: "not a date" },
])("rejects malformed task fields: %j", (overrides) => {
  expect(validateTask({ ...task(), ...overrides })).toEqual(expect.any(String));
});

it("reports the first invalid field and validates the start date before end-date comparisons", () => {
  expect(
    validateTask(task({ name: "", startDate: "invalid", endDate: "invalid" })),
  ).toBe("Escribe un nombre de hasta 120 caracteres.");
  expect(validateTask(task({ startDate: "invalid", endDate: "invalid" }))).toBe(
    "Selecciona una fecha de inicio válida.",
  );
  expect(
    validateTask(task({ days: [], endDate: "invalid", createdAt: "invalid" })),
  ).toBe("Selecciona un único día para la repetición semanal.");
});

it("accepts calendar boundaries, weekday selections and explicit statuses without simulating completion", () => {
  expect(validateTask(task({ endDate: "2028-02-29" }))).toBeUndefined();
  for (const repeat of [
    "once",
    "hourly",
    "daily",
    "monthly",
    "custom",
  ] as const)
    expect(
      validateTask(
        task({
          repeat,
          days: [],
          interval: 365,
          monthDay: 31,
          time: "23:59",
          timeZone: "UTC",
        }),
      ),
    ).toBeUndefined();
  expect(
    validateTask(task({ repeat: "weekdays", days: [1, 3, 5] })),
  ).toBeUndefined();
  saveScheduledTasks(store([task({ status: "paused" })]));
  expect(loadScheduledTasks().store.tasks[0].status).toBe("paused");
});

it.each([
  "{",
  JSON.stringify({ version: 2, nextId: 1, tasks: [] }),
  JSON.stringify({ ...store(), nextId: 1 }),
  JSON.stringify(store([task(), task()])),
  JSON.stringify(store([task(), task({ id: "00001" })])),
  JSON.stringify({
    ...store(),
    nextId: 202,
    tasks: Array.from({ length: 201 }, (_, index) =>
      task({ id: String(index + 1).padStart(4, "0") }),
    ),
  }),
  JSON.stringify({ ...store(), nextId: 1.5 }),
  JSON.stringify({ ...store(), unsupported: true }),
  JSON.stringify(store([{ ...task(), unsupported: true } as ScheduledTask])),
])(
  "fails closed and never overwrites malformed or unsupported saved data",
  (raw) => {
    localStorage.setItem(key, raw);
    const loaded = loadScheduledTasks();
    expect(loaded.store).toEqual(emptyScheduledTasks());
    expect(loaded.error).toEqual(expect.any(String));
    expect(() => saveScheduledTasks(emptyScheduledTasks())).toThrow();
    expect(localStorage.getItem(key)).toBe(raw);
  },
);

it("rejects invalid writes and preserves existing metadata on quota errors", () => {
  saveScheduledTasks(store());
  const raw = localStorage.getItem(key);
  expect(() => saveScheduledTasks({ ...store(), nextId: 1 })).toThrow();
  expect(localStorage.getItem(key)).toBe(raw);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota", "QuotaExceededError");
  });
  expect(() =>
    saveScheduledTasks(store([task({ name: "Otro informe" })])),
  ).toThrow("No se pudieron guardar");
  expect(localStorage.getItem(key)).toBe(raw);
});

it("reports blocked storage and never attempts a write after a failed read", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Blocked", "SecurityError");
  });
  const setter = vi.spyOn(Storage.prototype, "setItem");
  expect(loadScheduledTasks().error).toEqual(expect.any(String));
  expect(() => saveScheduledTasks(emptyScheduledTasks())).toThrow();
  expect(setter).not.toHaveBeenCalled();
});

it("rejects stale writes from a second editor without losing the first task", () => {
  const first = emptyScheduledTasks();
  const second = emptyScheduledTasks();
  const changed = { ...first, nextId: 2 };
  saveScheduledTasks(changed, first);
  expect(() => saveScheduledTasks(second, second)).toThrow("otra pestaña");
  expect(loadScheduledTasks().store.nextId).toBe(2);
});
