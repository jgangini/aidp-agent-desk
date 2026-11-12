const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function checkConversationDeletion({ check, context }) {
  const deletionPage = await context.newPage();
  await deletionPage.route("**/api/desk/profiles", (route) =>
    route.fulfill({ json: [] }),
  );
  await deletionPage.goto("http://127.0.0.1:8317/");
  await deletionPage
    .getByRole("textbox", { name: "Mensaje al agente", exact: true })
    .fill("Borrador para eliminar");
  await deletionPage
    .getByRole("button", { name: "Opciones del chat", exact: true })
    .click();
  const deleteRow = deletionPage
    .locator(".history-row")
    .filter({ hasText: "Borrador para eliminar" });
  await deleteRow.hover();
  const deleteAction = deleteRow.getByRole("menuitem", {
    name: "Eliminar conversación: Borrador · Borrador para eliminar",
    exact: true,
  });
  check(
    "history trash appears on the left when hovering",
    await deleteAction.evaluate(
      (node) =>
        getComputedStyle(node).opacity === "1" &&
        !!node.querySelector("svg.lucide-trash-2") &&
        node.getBoundingClientRect().left <
          node.nextElementSibling.querySelector("span").getBoundingClientRect()
            .left,
    ),
  );
  await deleteRow.hover();
  await deleteAction.click();
  await deletionPage
    .getByRole("dialog", { name: "¿Eliminar conversación?" })
    .waitFor();
  check(
    "delete dialog focuses cancel before any deletion",
    await deletionPage
      .getByRole("button", { name: "Cancelar", exact: true })
      .evaluate((node) => document.activeElement === node),
  );
  await deletionPage
    .getByRole("button", { name: "Cancelar", exact: true })
    .click();
  check(
    "cancel keeps the active draft",
    (await deletionPage
      .getByRole("textbox", { name: "Mensaje al agente", exact: true })
      .inputValue()) === "Borrador para eliminar",
  );
  await deletionPage
    .getByRole("button", { name: "Opciones del chat", exact: true })
    .click();
  await deleteRow.hover();
  await deleteAction.click();
  await deletionPage
    .getByRole("button", { name: "Eliminar", exact: true })
    .click();
  await deletionPage.reload();
  check(
    "confirmed deletion stays removed after reload",
    (await deletionPage
      .getByRole("textbox", { name: "Mensaje al agente", exact: true })
      .inputValue()) === "" &&
      (await deletionPage.locator(".history-row").count()) === 0,
  );
  await deletionPage.close();
}

async function prepareRecoveryPage({ context, errors, fixtures }) {
  const noticePage = await context.newPage();
  noticePage.on("pageerror", (e) => errors.push(String(e)));
  await noticePage.route("**/api/desk/profiles", (route) =>
    route.fulfill({
      json: [{ ...fixtures.qaProfile, name: "QA recovery", surface: "TEST" }],
    }),
  );
  await noticePage.route("**/api/desk/suggestions/*", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await noticePage.addInitScript((id) => {
    localStorage.setItem("agent-desk.selected-profile", `test:${id}`);
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (!String(input).endsWith("/api/desk/stream"))
        return originalFetch(input, init);
      const command = JSON.parse(init.body);
      const calls = JSON.parse(
        sessionStorage.getItem("qa-recovery-calls") || "[]",
      );
      calls.push(command);
      sessionStorage.setItem("qa-recovery-calls", JSON.stringify(calls));
      const base = { protocol: "ai-market-intelligence", version: "2.0" };
      const body = new ReadableStream({
        start(controller) {
          const send = (packet) =>
            controller.enqueue(
              new TextEncoder().encode(JSON.stringify(packet) + "\n"),
            );
          if (command.action === "replay") {
            window.__recoveryFinish = () => {
              send({
                ...base,
                kind: "response",
                request_id: command.request_id,
                response: {
                  status: "completed",
                  markdown: "Respuesta recuperada",
                  references: [],
                  artifacts: [],
                },
              });
              controller.close();
            };
          } else {
            send({
              ...base,
              kind: "event",
              event: {
                event_id: "partial",
                sequence: 1,
                turn_id: command.request_id,
                type: "draft.upsert",
                block_id: "consolidated",
                text: "Respuesta parcial conservada",
                status: "completed",
                evidence_ids: [],
              },
            });
            send({
              kind: "transport_error",
              code: "stream_interrupted",
              message: "Raw transport failure",
            });
            controller.close();
          }
        },
      });
      return Promise.resolve(
        new Response(body, {
          headers: { "Content-Type": "application/x-ndjson" },
        }),
      );
    };
  }, fixtures.qaProfileId);
  await noticePage.goto("http://127.0.0.1:8317/");
  await noticePage
    .getByRole("textbox", { name: "Mensaje al agente", exact: true })
    .fill("Pregunta de recuperación");
  await noticePage
    .getByRole("textbox", { name: "Mensaje al agente", exact: true })
    .press("Enter");
  await noticePage
    .getByRole("button", { name: "Recuperar respuesta", exact: true })
    .waitFor();
  return { noticePage };
}

async function checkRecoveryNotice({ check, noticePage }) {
  check(
    "transport error appears once above composer and keeps genuine partial text",
    (await noticePage.locator(".chat-notice").count()) === 1 &&
      (await noticePage
        .locator(".aui-assistant-message")
        .innerText()
        .then(
          (text) =>
            text.includes("Respuesta parcial conservada") &&
            !text.includes("interrumpió") &&
            !text.includes("Raw transport failure"),
        )) &&
      (await noticePage
        .locator(".chat-notice")
        .evaluate((node) =>
          node.nextElementSibling?.matches(".aui-composer-root"),
        )),
  );
  check(
    "recovery is an accessible refresh icon to the right of single-line notice text",
    await noticePage.locator(".chat-notice").evaluate((node) => {
      const message = node.querySelector(".chat-notice-message"),
        button = node.querySelector(".chat-recover-icon");
      const text = message.getBoundingClientRect(),
        action = button.getBoundingClientRect(),
        style = getComputedStyle(message);
      return (
        !!button.querySelector("svg.lucide-refresh-cw") &&
        !button.textContent.trim() &&
        button.getAttribute("aria-label") === "Recuperar respuesta" &&
        !button.hasAttribute("title") &&
        style.whiteSpace === "nowrap" &&
        style.textOverflow === "ellipsis" &&
        text.height <= parseFloat(style.lineHeight) + 1 &&
        action.left >= text.right &&
        action.right <= node.getBoundingClientRect().right
      );
    }),
  );
  const recoveryButton = noticePage.locator(".chat-recover-icon");
  const recoveryColor = await recoveryButton.evaluate(
    (node) => getComputedStyle(node).color,
  );
  await recoveryButton.hover();
  check(
    "recovery hover stays transparent and retains warning color",
    await recoveryButton.evaluate(
      (node, color) =>
        getComputedStyle(node).backgroundColor === "rgba(0, 0, 0, 0)" &&
        getComputedStyle(node).color === color,
      recoveryColor,
    ),
  );
  await noticePage.reload();
  await noticePage
    .getByRole("button", { name: "Recuperar respuesta", exact: true })
    .waitFor();
  check(
    "reload preserves one warning and does not resend the investigation",
    (await noticePage.locator(".chat-notice").count()) === 1 &&
      (await noticePage.evaluate(
        () => JSON.parse(sessionStorage.getItem("qa-recovery-calls")).length,
      )) === 1,
  );
}

async function checkRecoveryReplay({ check, noticePage }) {
  await noticePage
    .getByRole("button", { name: "Recuperar respuesta", exact: true })
    .click();
  await noticePage.waitForFunction(() => !!window.__recoveryFinish);
  check(
    "recovery sends only replay with the original identities and blocks repeated activation",
    (await noticePage.evaluate(() => {
      const [first, second] = JSON.parse(
        sessionStorage.getItem("qa-recovery-calls"),
      );
      return (
        second.action === "replay" &&
        second.after_sequence === 0 &&
        first.request_id === second.request_id &&
        first.session_id === second.session_id &&
        first.profile_id === second.profile_id
      );
    })) &&
      (await noticePage
        .getByRole("button", { name: "Recuperando…", exact: true })
        .isDisabled()),
  );
  await noticePage.evaluate(() => window.__recoveryFinish());
  await noticePage.getByText("Respuesta recuperada", { exact: true }).waitFor();
  check(
    "confirmed recovery clears the warning without adding a user turn",
    (await noticePage.locator(".chat-notice").count()) === 0 &&
      (await noticePage.locator(".aui-user-message").count()) === 1,
  );
  await noticePage.reload();
  await noticePage.getByText("Respuesta recuperada", { exact: true }).waitFor();
  check(
    "resolved warning stays cleared after reload",
    (await noticePage.locator(".chat-notice").count()) === 0,
  );
  await noticePage.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem("agent-desk.remote-chats"));
    const snapshot = Object.values(saved.data)[0];
    const original = snapshot.conversations[0];
    original.status = "failed";
    original.issue = {
      message: "Interrumpido",
      kind: "warning",
      recoverable: true,
    };
    snapshot.conversations.push({
      ...original,
      id: "unknown-old-attempt",
      answer: "",
      createdAt: original.createdAt + 1000,
    });
    sessionStorage.setItem("agent-desk.remote-chats", JSON.stringify(saved));
    sessionStorage.setItem("qa-original-request", original.id);
  });
  await noticePage.reload();
  await noticePage
    .getByRole("button", { name: "Recuperar respuesta", exact: true })
    .waitFor();
  check(
    "multiple interrupted attempts do not add another-attempt menu or list",
    (await noticePage.locator(".chat-recovery-options").count()) === 0 &&
      (await noticePage
        .getByText("Recuperar otro intento interrumpido", { exact: true })
        .count()) === 0 &&
      (await noticePage.locator(".chat-recover-icon").count()) === 1,
  );
  await noticePage.close();
}

async function checkStatusShimmer({
  check,
  errors,
  page,
  recordConsole,
  requests,
  submit,
}) {
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", recordConsole);
  page.on("request", (r) => requests.add(r.url()));
  await page.clock.install();
  await page.addInitScript(() =>
    localStorage.setItem("agent-desk.selected-profile", "demo"),
  );
  await page.goto("http://127.0.0.1:8317/");
  await page
    .getByRole("textbox", { name: "Mensaje al agente", exact: true })
    .press("Escape");
  await page.clock.pauseAt(Date.now() + 1000);
  await submit("Historial de prueba");
  await page.clock.runFor(100);
  const shimmer = page.locator(".tool-progress .t-shimmer").last();
  await shimmer.waitFor();
  check(
    "thinking uses the requested shimmer recipe",
    await shimmer.evaluate(
      (label) =>
        label.dataset.text === "thinking" &&
        getComputedStyle(label, "::before").animationName === "t-shimmer",
    ),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(
    "reduced motion disables status shimmer",
    await shimmer.evaluate(
      (label) => getComputedStyle(label, "::before").animationName === "none",
    ),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.runFor(2600);
  await page.waitForFunction(() =>
    document.querySelector(".t-shimmer")?.textContent.startsWith("Worked for"),
  );
  check(
    "Worked for retains shimmer while public outputs stream",
    await shimmer.evaluate(
      (label) =>
        getComputedStyle(label, "::before").animationName === "t-shimmer" &&
        label.dataset.running === "true",
    ),
  );
  await page.getByRole("button", { name: "Detener consulta" }).click();
  check(
    "terminal status stops shimmer",
    await shimmer.evaluate(
      (label) => getComputedStyle(label, "::before").animationName === "none",
    ),
  );
  await page.clock.resume();
  const receivedCount = await page.locator(".finding").count();
  return { receivedCount };
}

async function checkConversationHistory({ check, page, receivedCount }) {
  await page.getByLabel("Opciones del chat", { exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('.chat-options[data-open="true"]')
        ?.getBoundingClientRect().height > 100,
  );
  check(
    "conversation menu morphs downward from the header trigger",
    await page.evaluate(() => {
      const anchor = document
        .querySelector(".chat-options-anchor")
        .getBoundingClientRect();
      const menu = document
        .querySelector(".chat-options")
        .getBoundingClientRect();
      return (
        Math.abs(anchor.top - menu.top) < 1 &&
        menu.bottom >
          document.querySelector(".chat-header").getBoundingClientRect().bottom
      );
    }),
  );
  check(
    "New conversation is the first history action",
    (await page.getByRole("menuitem").first().textContent()).trim() ===
      "Nueva conversación",
  );
  await page
    .getByRole("menuitem", { name: "Nueva conversación", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Mensaje al agente" })
    .fill("Borrador nuevo");
  await page.getByLabel("Opciones del chat", { exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Historial de prueba", exact: true })
    .click();
  check(
    "selecting history restores messages and received results",
    (await page.locator(".aui-user-message").textContent()).includes(
      "Historial de prueba",
    ) &&
      (await page.locator(".finding").count()) === receivedCount &&
      receivedCount > 0,
  );
  await page.getByLabel("Opciones del chat", { exact: true }).click();
  await page
    .getByRole("menuitem", {
      name: "Borrador · Borrador nuevo",
      exact: true,
    })
    .click();
  check(
    "draft-only conversations can be reopened without losing text",
    (await page
      .getByRole("textbox", { name: "Mensaje al agente" })
      .inputValue()) === "Borrador nuevo" &&
      (await page.locator(".aui-user-message").count()) === 0,
  );
}

async function checkScheduledPanelEntry({ check, page }) {
  const scheduledButton = page.getByRole("button", {
    name: "Tareas",
    exact: true,
  });
  check(
    "a clock SVG opens Tareas immediately left of configuration",
    (await scheduledButton.locator("svg.lucide-clock").count()) === 1 &&
      (await scheduledButton.evaluate((button) => {
        const settings = button.nextElementSibling;
        return (
          settings.getAttribute("aria-label") === "Configurar agentes" &&
          button.getBoundingClientRect().right <=
            settings.getBoundingClientRect().left
        );
      })),
  );
  await scheduledButton.click();
  const scheduledPanel = page.getByRole("region", {
    name: "Tareas",
    exact: true,
  });
  await scheduledPanel.waitFor();
  check(
    "Tareas uses the inline configuration surface and closes without changing the draft",
    (await scheduledPanel.evaluate(
      (panel) =>
        panel.classList.contains("agent-config-glass") &&
        getComputedStyle(panel).padding === "24px" &&
        getComputedStyle(panel).borderRadius === "0px",
    )) &&
      (await scheduledPanel.evaluate(
        (node) => document.activeElement === node,
      )) &&
      (await page.locator(".chat-header h2").textContent()) === "Tareas",
  );
  await scheduledPanel.press("Escape");
  await scheduledPanel.waitFor({ state: "detached" });
  assert.equal(
    await page
      .getByRole("textbox", { name: "Mensaje al agente", exact: true })
      .inputValue(),
    "Borrador nuevo",
  );
  await scheduledButton.click();
  await page
    .getByRole("button", { name: "Cerrar Tareas", exact: true })
    .click();
  await scheduledPanel.waitFor({ state: "detached" });
  await require("./browser-scheduled-check.cjs")(page, check);
}

async function writeBrowserReport({
  check,
  checks,
  contrast,
  errors,
  expectedAudioHttpErrors,
  layouts,
  observedAudioHttpErrors,
  requests,
}) {
  check(
    "exactly two intentional audio configuration HTTP422 console responses are accounted for",
    observedAudioHttpErrors === 2 &&
      [...expectedAudioHttpErrors.values()].every(
        (remaining) => remaining === 0,
      ),
  );
  assert.deepEqual(errors, [], "no runtime or shader errors");
  check("no runtime or shader errors", errors.length === 0);
  check(
    "no external agent or source requests",
    Array.from(requests).every(
      (url) =>
        url.startsWith("http://127.0.0.1:8317/") || url.startsWith("blob:"),
    ),
  );
  const report = {
    checkedAt: new Date().toISOString(),
    checks,
    layouts,
    contrast,
    errors,
    capture: "none; DOM, WebGL calls and interaction checks only",
  };
  fs.writeFileSync(
    path.resolve(__dirname, "../.cache/browser-check.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}

module.exports = {
  checkConversationDeletion,
  prepareRecoveryPage,
  checkRecoveryNotice,
  checkRecoveryReplay,
  checkStatusShimmer,
  checkConversationHistory,
  checkScheduledPanelEntry,
  writeBrowserReport,
};
