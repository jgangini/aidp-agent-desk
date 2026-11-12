const assert = require("node:assert/strict");
module.exports = async function checkScheduled(page, check) {
  const postRequests = [];
  const observe = (request) => {
    if (request.method() === "POST") postRequests.push(request.url());
  };
  page.on("request", observe);
  try {
    const { panel } = await checkScheduledOpening({ page, check });
    await checkScheduledDescription({ page, check, panel });
    await checkScheduledValidation({ page, check, panel });
    await checkScheduledRepeatPicker({ page, check });
    await checkScheduledWeekdays({ page, check });
    await checkScheduledCalendar({ page, check });
    const { date } = await checkScheduledTiming({ page, check, panel });
    await checkScheduledSaveAndPause({ page, check, date, panel });
    await checkScheduledPersistenceAndUndo({ page, check, panel });
    await checkScheduledCompactLayout({ page, check, panel, postRequests });
  } finally {
    page.off("request", observe);
  }
};

async function checkScheduledOpening({ page, check }) {
  await page.evaluate(() => {
    window.__scheduledWorkspaceBefore = document.querySelector(".workspace");
    window.__scheduledCanvasBefore = document.querySelector(
      ".brain-canvas canvas",
    );
  });
  await page.getByRole("button", { name: "Tareas", exact: true }).click();
  const panel = page.locator("#scheduled-panel");
  const createButton = panel.getByRole("button", {
    name: "Nueva tarea",
    exact: true,
  });
  await createButton.hover();
  await page.waitForTimeout(350);
  check(
    "Nueva tarea keeps a light hover surface and readable text without a tooltip",
    (await createButton.evaluate((button) => {
      const style = getComputedStyle(button);
      return (
        style.backgroundColor === "rgb(238, 238, 239)" &&
        style.color === "rgb(34, 34, 34)" &&
        button.getAttribute("data-tooltip-disabled") === "true" &&
        !button.title
      );
    })) && (await page.getByRole("tooltip").count()) === 0,
  );

  check(
    "Tareas reuses configuration tab styling without removed copy or extra icons",
    (await page
      .locator(".scheduled-tabs.config-step-tabs > .config-step-pill")
      .count()) === 1 &&
      (await page
        .locator(
          ".scheduled-intro,.scheduled-stage-note,.scheduled-recommendations,.scheduled-empty",
        )
        .count()) === 0 &&
      (await page
        .getByRole("button", { name: "Nueva tarea", exact: true })
        .locator("svg")
        .count()) === 0,
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector("#scheduled-panel")).opacity ===
      "1",
  );
  check(
    "opening Tareas preserves the actual left workspace and particle canvas",
    (await page.evaluate(
      () =>
        document.querySelector(".workspace") ===
          window.__scheduledWorkspaceBefore &&
        document.querySelector(".brain-canvas canvas") ===
          window.__scheduledCanvasBefore,
    )) && (await page.locator("#network-region").isVisible()),
  );
  check(
    "scheduled tabs use the configuration pill with three equal columns",
    await panel.locator(".config-step-tabs").evaluate((tabs) => {
      const button = tabs.querySelector("button");
      const pill = tabs.querySelector(".config-step-pill");
      return (
        button.getBoundingClientRect().height === 30 &&
        getComputedStyle(tabs).borderRadius === "48px" &&
        Math.abs(
          pill.getBoundingClientRect().width - (tabs.clientWidth - 6) / 3,
        ) < 1
      );
    }),
  );
  await page.getByRole("button", { name: "Nueva tarea", exact: true }).click();
  return { panel };
}

async function checkScheduledDescription({ page, check, panel }) {
  check(
    "task editor uses Nueva tarea as its only heading without notification or stage copy",
    (await page.locator("#chat-title").textContent()) === "Nueva tarea" &&
      (await panel
        .locator(".scheduled-intro,.scheduled-stage-note")
        .count()) === 0 &&
      (await panel.getByLabel("Notificar al finalizar").count()) === 0,
  );
  await page
    .getByLabel("Nombre de la tarea", { exact: true })
    .fill("Informe semanal QA");
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".scheduled-task-form input"))
        .borderTopColor === "rgb(102, 104, 109)",
  );
  check(
    "scheduled fields use the search/composer border without an inset focus underline",
    await page
      .getByLabel("Nombre de la tarea", { exact: true })
      .evaluate((input) => {
        const style = getComputedStyle(input);
        return (
          style.borderTopColor === "rgb(102, 104, 109)" &&
          style.boxShadow === "none" &&
          style.outlineStyle === "none" &&
          style.borderBottomWidth === style.borderTopWidth
        );
      }),
  );
  await page.getByLabel("Instrucciones", { exact: true }).fill("x".repeat(501));
}

async function checkScheduledValidation({ page, check, panel }) {
  check(
    "instruction counter sits inside the lower right without covering editable text",
    await panel.locator(".scheduled-instructions").evaluate((wrapper) => {
      const input = wrapper.querySelector("textarea");
      const field = input.getBoundingClientRect();
      const count = wrapper
        .querySelector(".scheduled-word-count")
        .getBoundingClientRect();
      return (
        count.right < field.right &&
        count.bottom < field.bottom &&
        count.left > field.left &&
        count.top > field.top &&
        parseFloat(getComputedStyle(input).paddingBottom) >= 32
      );
    }),
  );
  check(
    "task instructions cap input at 500 characters",
    (await page
      .getByLabel("Instrucciones", { exact: true })
      .evaluate(
        (input) => input.value.length === 500 && input.maxLength === 500,
      )) &&
      (await panel.locator(".scheduled-word-count").textContent()).trim() ===
        "500 / 500 caracteres",
  );
  await page.getByLabel("Instrucciones", { exact: true }).fill("");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  check(
    "missing instructions use an associated yellow warning with spacing",
    (await page
      .getByLabel("Instrucciones", { exact: true })
      .evaluate(
        (input) =>
          getComputedStyle(input).borderColor === "rgb(245, 207, 115)" &&
          input.getAttribute("aria-invalid") === "true" &&
          input
            .getAttribute("aria-describedby")
            .includes(document.querySelector(".scheduled-field-warning").id),
      )) &&
      (await panel
        .getByRole("alert")
        .textContent()
        .then((text) => text.includes("500 caracteres"))) &&
      (await panel
        .locator(".scheduled-field-warning")
        .evaluate(
          (warning) =>
            getComputedStyle(warning).color === "rgb(245, 207, 115)" &&
            parseFloat(getComputedStyle(warning).marginTop) >= 6,
        )),
  );
  check(
    "combobox options have breathing room and retain the selected checkmark",
    await panel
      .locator("select")
      .first()
      .evaluate((select) => {
        const option = select.querySelector("option");
        return (
          getComputedStyle(option).marginTop === "3px" &&
          getComputedStyle(option, "::checkmark").order === "1"
        );
      }),
  );
}

async function checkScheduledRepeatPicker({ page, check }) {
  await page
    .getByLabel("Instrucciones", { exact: true })
    .fill("Investiga mi sector y cita las fuentes.");
  await page.getByLabel("Repetir", { exact: true }).click();
  const hoveredOption = page.getByRole("option", {
    name: "Cada hora",
    exact: true,
  });
  await hoveredOption.hover();
  check(
    "combobox hover uses white text without adjacent grey highlight blocks",
    await hoveredOption.evaluate((option) => {
      const style = getComputedStyle(option);
      return (
        style.color === "rgb(238, 238, 239)" &&
        style.backgroundColor === "rgba(0, 0, 0, 0)"
      );
    }),
  );

  await page.keyboard.press("Escape");
  check(
    "Escape closes a schedule picker without discarding edited fields",
    (await page
      .getByLabel("Nombre de la tarea", { exact: true })
      .inputValue()) === "Informe semanal QA",
  );
}

async function checkScheduledWeekdays({ page, check }) {
  await page.getByLabel("Repetir", { exact: true }).selectOption("weekly");
  await page
    .getByRole("combobox", { name: "Día de la semana", exact: true })
    .click();
  await page.getByLabel("Lunes", { exact: true }).check();
  check(
    "weekly days use a floating dropdown with circular checks",
    await page.locator(".scheduled-day-menu").evaluate((menu) => {
      const input = menu.querySelector("input");
      const rect = menu.getBoundingClientRect();
      const trigger = document
        .querySelector(".scheduled-day-trigger")
        .getBoundingClientRect();
      return (
        menu.matches(":popover-open") &&
        rect.top >= trigger.bottom &&
        getComputedStyle(input).borderRadius === "50%"
      );
    }),
  );
  await page.getByLabel("Domingo", { exact: true }).check();
  await page.waitForFunction(
    () =>
      !document.querySelector(".scheduled-day-menu").matches(":popover-open"),
  );
  check(
    "weekly day selection keeps exactly one circular choice",
    (await page.locator(".scheduled-day-menu input:checked").count()) === 1 &&
      (await page.getByLabel("Domingo", { exact: true }).isChecked()),
  );
  await page
    .getByRole("combobox", { name: "Día de la semana", exact: true })
    .click();
  await page.getByLabel("Lunes", { exact: true }).press("Escape");
  check(
    "Escape closes the days dropdown without cancelling the task",
    (await page.locator(".scheduled-task-form").count()) === 1 &&
      (await page
        .locator(".scheduled-day-trigger")
        .getAttribute("aria-expanded")) === "false",
  );

  await page.getByLabel("Repetir", { exact: true }).selectOption("weekdays");
  await page
    .getByRole("combobox", { name: "Días de la semana", exact: true })
    .click();
  await page.getByLabel("Sábado", { exact: true }).check();
  check(
    "multiple days remain selectable without closing the floating menu",
    (await page
      .locator(".scheduled-day-menu")
      .evaluate((menu) => menu.matches(":popover-open"))) &&
      (await page.getByLabel("Domingo", { exact: true }).isChecked()) &&
      (await page.getByLabel("Sábado", { exact: true }).isChecked()),
  );
  await page.getByLabel("Nombre de la tarea", { exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector(".scheduled-day-menu").matches(":popover-open"),
  );
}

async function checkScheduledCalendar({ page, check }) {
  await page.getByLabel("Repetir", { exact: true }).selectOption("weekly");
  await page
    .getByRole("button", {
      name: "Abrir calendario: Fecha de inicio",
      exact: true,
    })
    .click();
  await page.waitForFunction(() => {
    const calendar = document.querySelector(".scheduled-calendar:popover-open");
    if (!calendar) return false;
    const rect = calendar.getBoundingClientRect();
    return (
      calendar.style.getPropertyValue("--date-top") &&
      rect.bottom <= innerHeight
    );
  });
  check(
    "scheduled calendar has seven aligned columns and floats below its field",
    await page
      .getByRole("dialog", {
        name: "Calendario: Fecha de inicio",
        exact: true,
      })
      .evaluate((calendar) => {
        const grid = calendar.querySelector(".scheduled-calendar-grid");
        const rect = calendar.getBoundingClientRect();
        const input = document
          .querySelector(".scheduled-date-field input")
          .getBoundingClientRect();
        return (
          getComputedStyle(grid).gridTemplateColumns.split(" ").length === 7 &&
          rect.top >= input.bottom &&
          rect.right <= innerWidth &&
          rect.bottom <= innerHeight &&
          calendar.matches(":popover-open")
        );
      }),
  );
  await page
    .getByRole("dialog", { name: "Calendario: Fecha de inicio", exact: true })
    .press("Escape");
  check(
    "calendar Escape preserves the task and restores its trigger",
    (await page.locator(".scheduled-task-form").count()) === 1 &&
      (await page
        .getByRole("button", {
          name: "Abrir calendario: Fecha de inicio",
          exact: true,
        })
        .evaluate((button) => button === document.activeElement)),
  );
}

async function checkScheduledTiming({ page, check, panel }) {
  await page.getByLabel("Hora", { exact: true }).fill("14:30");
  check(
    "timezone combobox lists IANA zones and UTC",
    (await page
      .getByLabel("Zona horaria", { exact: true })
      .locator("option")
      .count()) > 100 &&
      (await page
        .getByLabel("Zona horaria", { exact: true })
        .locator('option[value="UTC"]')
        .count()) === 1,
  );
  await page
    .getByLabel("Zona horaria", { exact: true })
    .selectOption("America/Lima");
  check(
    "Finalizar sits to the right of Zona horaria in the same row",
    await panel.evaluate((node) => {
      const zone = node
        .querySelector('select[aria-label="Zona horaria"]')
        .getBoundingClientRect();
      const end = node
        .querySelector('select[aria-label="Finalizar"]')
        .getBoundingClientRect();
      return Math.abs(zone.top - end.top) < 2 && end.left > zone.right;
    }),
  );
  await page.getByLabel("Finalizar", { exact: true }).selectOption("date");
  check(
    "Fecha de fin sits beside the day selector",
    await panel.evaluate((node) => {
      const day = node
        .querySelector(".scheduled-day-trigger")
        .getBoundingClientRect();
      const endLabel = [...node.querySelectorAll("label")].find(
        (label) => label.textContent.trim() === "Fecha de fin",
      );
      const end = document
        .getElementById(endLabel.htmlFor)
        .getBoundingClientRect();
      return Math.abs(day.top - end.top) < 2 && end.left > day.right;
    }),
  );
  const date = await page
    .getByLabel("Fecha de inicio", { exact: true })
    .inputValue();
  await page.getByLabel("Fecha de fin", { exact: true }).fill(date);
  check(
    "Tareas uses standard floating selects and a bounded scrollable form",
    await panel.evaluate((node) => {
      const select = node.querySelector("select");
      const style = getComputedStyle(select);
      return (
        style.appearance === "base-select" &&
        node.scrollHeight >= node.clientHeight &&
        node.scrollWidth <= node.clientWidth + 1
      );
    }),
  );
  return { date };
}

async function checkScheduledSaveAndPause({ page, check, date, panel }) {
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await panel
    .getByRole("heading", { name: "Informe semanal QA", exact: true })
    .waitFor();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("agent-desk.scheduled-tasks")),
  );
  check(
    "Tareas saves agent and repeat/date metadata locally without execution",
    stored.tasks.length === 1 &&
      stored.tasks[0].id === "0001" &&
      stored.tasks[0].repeat === "weekly" &&
      stored.tasks[0].time === "14:30" &&
      stored.tasks[0].timeZone === "America/Lima" &&
      stored.tasks[0].endDate === date,
  );
  await page
    .getByRole("button", { name: "Pausar Informe semanal QA", exact: true })
    .click();
  await page.getByRole("tab", { name: "En pausa", exact: true }).click();
  await page
    .getByRole("button", { name: "Activar Informe semanal QA", exact: true })
    .click();
  await page.getByRole("tab", { name: "Activadas", exact: true }).click();
  check(
    "opening and editing schedules keeps the left workspace instead of an empty reports page",
    (await page
      .locator(
        ".scheduled-reports,.scheduled-report-toolbar,.scheduled-report-empty",
      )
      .count()) === 0 && (await page.locator("#network-region").isVisible()),
  );
  await page
    .getByRole("button", { name: "Cerrar Tareas", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Mensaje al agente", exact: true })
      .inputValue(),
    "Borrador nuevo",
  );
}

async function checkScheduledPersistenceAndUndo({ page, check, panel }) {
  await page.reload();
  await page.getByRole("button", { name: "Tareas", exact: true }).click();
  await panel
    .getByRole("heading", { name: "Informe semanal QA", exact: true })
    .waitFor();
  check(
    "scheduled metadata survives reload while the original chat draft is preserved",
    (await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("agent-desk.scheduled-tasks")).tasks[0]
          .status,
    )) === "active",
  );
  await page
    .getByRole("button", { name: "Eliminar Informe semanal QA", exact: true })
    .click();
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await panel
    .getByRole("heading", { name: "Informe semanal QA", exact: true })
    .waitFor();
  check(
    "scheduled deletion can be undone without recycling task IDs",
    (await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("agent-desk.scheduled-tasks")).nextId,
    )) === 2,
  );
}

async function checkScheduledCompactLayout({
  page,
  check,
  panel,
  postRequests,
}) {
  await page.setViewportSize({ width: 780, height: 760 });
  await page
    .getByRole("button", { name: "Editar Informe semanal QA", exact: true })
    .click();
  check(
    "scheduled form stays within the right panel at compact desktop width",
    await panel.evaluate(
      (node) =>
        node.scrollWidth <= node.clientWidth + 1 &&
        [...node.querySelectorAll("input,textarea,select")].every(
          (input) =>
            input.getBoundingClientRect().right <=
            node.getBoundingClientRect().right + 1,
        ),
    ),
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page
    .getByRole("button", { name: "Cerrar Tareas", exact: true })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(
    await page
      .getByRole("textbox", { name: "Mensaje al agente", exact: true })
      .inputValue(),
    "Borrador nuevo",
  );
  check(
    "editing schedules sends no POST requests to agents or notification services",
    postRequests.length === 0,
  );
}
