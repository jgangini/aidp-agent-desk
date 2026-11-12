const assert = require("node:assert/strict");
const path = require("node:path");

async function checkConfigurationTabs({ check, page }) {
  await page.getByRole("button", { name: "Configurar agentes" }).click();
  await page
    .getByRole("region", { name: "Oracle AI Data Platform Agent Flows" })
    .waitFor();
  check(
    "configuration stays inside the chat with a glass surface",
    await page
      .locator(".agent-config-inline")
      .evaluate((el) => getComputedStyle(el).backdropFilter.includes("blur")),
  );
  check(
    "config and PEM file fields sit side by side on desktop",
    await page.evaluate(() => {
      const fields = document.querySelectorAll(
        ".agent-config-inline .file-field",
      );
      const config = fields[0].getBoundingClientRect(),
        key = fields[1].getBoundingClientRect();
      return Math.abs(config.top - key.top) < 1 && key.left >= config.right;
    }),
  );
  const connectionTab = page.getByRole("tab", {
    name: "Conexión",
    exact: true,
  });
  await connectionTab.focus();
  await connectionTab.press("ArrowRight");
  check(
    "configuration tabs support keyboard arrows and move focus",
    await page
      .getByRole("tab", { name: "Agent Flow", exact: true })
      .evaluate(
        (tab) =>
          tab.getAttribute("aria-selected") === "true" &&
          document.activeElement === tab,
      ),
  );
  await page.getByRole("tab", { name: "Agent Flow", exact: true }).press("End");
  check(
    "configuration tabs support End",
    (await page
      .getByRole("tab", { name: "Sugerencias", exact: true })
      .getAttribute("aria-selected")) === "true",
  );
  await page
    .getByRole("tab", { name: "Sugerencias", exact: true })
    .press("Home");
  check(
    "configuration tabs support Home",
    (await connectionTab.getAttribute("aria-selected")) === "true",
  );
  for (const [tab, left, right] of [
    ["Conexión", "profile", "region"],
    ["Agent Flow", "instance_id", "workspace_id"],
    ["Audio", "transcription_model", "speech_model"],
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: tab, exact: true });
    check(
      `configuration pairs controls inside the visible ${tab} panel`,
      await panel.evaluate(
        (panel, fields) => {
          const a = panel
            .querySelector(`[name="${fields[0]}"]`)
            .getBoundingClientRect();
          const b = panel
            .querySelector(`[name="${fields[1]}"]`)
            .getBoundingClientRect();
          return (
            a.width > 0 &&
            b.width > 0 &&
            Math.abs(a.top - b.top) <= 2 &&
            b.left >= a.right
          );
        },
        [left, right],
      ),
    );
  }
  await connectionTab.click();
  check(
    "configuration uses a larger white AIDP icon without a tile and puts credentials first",
    await page.locator(".agent-config-inline").evaluate((panel) => {
      const icon = panel.querySelector(".config-aidp-icon");
      const uploads = panel
        .querySelector(".config-upload-fields")
        .getBoundingClientRect();
      const profile = panel
        .querySelector('[name="profile"]')
        .getBoundingClientRect();
      return (
        icon.getBoundingClientRect().width >= 40 &&
        getComputedStyle(icon).filter.includes("invert(1)") &&
        !panel.querySelector(".config-symbol") &&
        ![...panel.querySelectorAll(".configured-agent")].some((item) =>
          item.textContent.includes("Simulación local"),
        ) &&
        uploads.bottom <= profile.top + 1 &&
        uploads.height <= 110
      );
    }),
  );
}

async function checkCredentialDiscovery({
  check,
  fixtureDir,
  multipartField,
  page,
}) {
  const discoveryOptions = {
    compartments: [],
    instances: [],
    workspaces: [],
    agents: [],
    transcription_models: [],
    speech_models: [],
    warnings: [],
  };
  await page.route("**/api/desk/discovery/options", async (route) => {
    const field = (name) => multipartField(route.request(), name);
    const options = { ...discoveryOptions };
    if (field("stage") === "compartments")
      options.compartments = [{ id: "qa-comp", name: "QA compartment" }];
    if (["resources", "audio"].includes(field("stage"))) {
      if (field("stage") === "resources")
        options.instances = [
          {
            id: "qa-platform",
            name: "aidp_market_intelligence_20261107_rc12_".repeat(4),
          },
        ];
      options.transcription_models = [{ id: "ORACLE", name: "Oracle STT" }];
      options.speech_models = [{ id: "qa-voice", name: "QA voice" }];
      options.warnings = ["Catálogo sintético de prueba, sin llamadas OCI."];
    }
    if (field("stage") === "agents") {
      options.workspaces = [{ id: "qa-workspace", name: "QA workspace" }];
      if (field("workspace_id"))
        options.agents = [
          {
            id: "agent-desk-qa-only",
            name: "Agent Desk QA",
            description: "Publicado",
            available: true,
          },
          { id: "unpublished", name: "Unpublished QA", available: false },
        ];
    }
    await route.fulfill({ json: options });
  });
  await page
    .getByLabel("Archivo config OCI")
    .setInputFiles(path.join(fixtureDir, "config"));
  await page
    .getByLabel("Archivo key.pem")
    .setInputFiles(path.join(fixtureDir, "key.pem"));
  check(
    "credential selections show filenames and the adapted physics landing",
    await page
      .locator(".credential-drop-surface")
      .evaluateAll(
        (surfaces) =>
          surfaces.length === 2 &&
          surfaces.every(
            (surface) =>
              surface.classList.contains("is-landing") &&
              getComputedStyle(surface).animationName.includes(
                "credential-drop-down",
              ) &&
              surface
                .querySelector(".credential-drop-filename")
                .textContent.trim(),
          ),
      ),
  );
  await page
    .getByRole("combobox", { name: "Perfil", exact: true })
    .selectOption("DEFAULT");
  await page
    .getByRole("combobox", { name: "Compartimento", exact: true })
    .selectOption("qa-comp");
}

async function checkNativeProfilePicker({ check, page }) {
  const profileSelect = page.getByRole("combobox", {
    name: "Perfil",
    exact: true,
  });
  const beforePicker = await page
    .locator(".agent-config-form > footer")
    .evaluate((el) => el.getBoundingClientRect().top);
  await profileSelect.click();
  check(
    "standard native combobox opens a dark floating picker downward without moving the footer",
    await profileSelect.evaluate((el, before) => {
      const picker = getComputedStyle(el, "::picker(select)");
      return (
        el.matches(":open") &&
        getComputedStyle(el).appearance === "base-select" &&
        picker.position === "fixed" &&
        picker.backgroundColor === "rgb(27, 28, 31)" &&
        parseFloat(picker.top) >= el.getBoundingClientRect().bottom &&
        Math.abs(
          document
            .querySelector(".agent-config-form > footer")
            .getBoundingClientRect().top - before,
        ) < 1
      );
    }, beforePicker),
  );
  await profileSelect.press("Escape");
  check(
    "Escape dismisses the native picker while keeping configuration open",
    await page.locator(".agent-config-form").isVisible(),
  );
}

async function checkConnectionPersistence({
  check,
  fixtures,
  page,
  saveDraftStep,
}) {
  const connection = await saveDraftStep("connection");
  await page
    .getByText("Conexión guardada.", {
      exact: true,
    })
    .waitFor();
  check(
    "saving Conexión persists metadata without importing an agent",
    connection.has_credentials &&
      connection.compartment_id === "qa-comp" &&
      connection.profiles.length === 0 &&
      !fixtures.qaProfileId,
  );
  await page
    .getByRole("button", { name: "Cerrar configuración", exact: true })
    .click();
  await page.locator(".agent-config-inline").waitFor({ state: "detached" });
  await page
    .getByRole("button", { name: "Configurar agentes", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('[name="profile"]')?.value === "DEFAULT" &&
      document.querySelector('[name="compartment_id"]')?.value === "qa-comp",
  );
  check(
    "reopening configuration restores saved connection without uploading files again",
    (await page
      .getByText("Guardado en el servidor", { exact: true })
      .count()) === 2 &&
      (await page.getByLabel("Archivo config OCI").inputValue()) === "" &&
      (await page.getByLabel("Archivo key.pem").inputValue()) === "",
  );
  await page.getByRole("tab", { name: "Agent Flow", exact: true }).click();
}

async function checkFlowDiscovery({ check, page }) {
  check(
    "Agent Flow tab opens after the connection was saved",
    (await page
      .getByRole("tab", { name: "Agent Flow", exact: true })
      .getAttribute("aria-selected")) === "true",
  );
  await page
    .getByRole("combobox", {
      name: "Oracle AI Data Platform Workbench",
      exact: true,
    })
    .selectOption("qa-platform");
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption("qa-workspace");
  check(
    "long selected Workbench label truncates inside its own box before the arrow",
    await page
      .getByRole("combobox", {
        name: "Oracle AI Data Platform Workbench",
        exact: true,
      })
      .evaluate((el) => {
        const text = el.querySelector("selectedcontent");
        if (!text) return false;
        const control = el.getBoundingClientRect();
        const box = text.getBoundingClientRect();
        const style = getComputedStyle(text);
        return (
          text.textContent === el.selectedOptions[0].textContent &&
          text.scrollWidth > text.clientWidth &&
          box.right <= control.right - 28 &&
          style.textOverflow === "ellipsis" &&
          style.overflow === "hidden" &&
          style.whiteSpace === "nowrap" &&
          Math.abs(control.height - 40) < 1
        );
      }),
  );
  await page.getByRole("checkbox", { name: /Agent Desk QA/ }).waitFor();
  check(
    "discovery disables unpublished agents",
    !(await page.getByRole("checkbox", { name: /Unpublished QA/ }).isEnabled()),
  );
  const flowCheckbox = page.getByRole("checkbox", { name: /Agent Desk QA/ });
  const compactFlowRow = () =>
    flowCheckbox.evaluate((input) => {
      const row = input.closest("label");
      const box = input.getBoundingClientRect();
      const copy = row
        .querySelector(".config-agent-copy")
        .getBoundingClientRect();
      const name = row.querySelector("strong").getBoundingClientRect();
      const status = row.querySelector("small").getBoundingClientRect();
      return (
        box.width === 18 &&
        box.height === 18 &&
        copy.left > box.right &&
        status.left > name.right &&
        Math.abs(
          status.top + status.height / 2 - (name.top + name.height / 2),
        ) < 2 &&
        Math.abs(copy.top + copy.height / 2 - (box.top + box.height / 2)) < 2 &&
        row.scrollWidth <= row.clientWidth &&
        row.getBoundingClientRect().height < 80
      );
    });
  check(
    "Agent Flow checkbox and label form a compact aligned row",
    await compactFlowRow(),
  );
  const flowViewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    "Agent Flow checkbox row stays contained on mobile",
    await compactFlowRow(),
  );
  await page.setViewportSize(flowViewport);
  await flowCheckbox.focus();
  return { flowCheckbox };
}

async function checkFlowSave({
  check,
  fixtures,
  flowCheckbox,
  page,
  saveDraftStep,
}) {
  await flowCheckbox.press("Space");
  check(
    "Agent Flow selection works with keyboard and decorative check fits its stroke",
    (await flowCheckbox.isChecked()) &&
      (await flowCheckbox.evaluate(
        (input) =>
          input.nextElementSibling.querySelector("path").getTotalLength() <= 24,
      )),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(
    "Agent Flow check disables motion with the system preference",
    await flowCheckbox.evaluate(
      (input) =>
        getComputedStyle(input.nextElementSibling.querySelector("path"))
          .transitionDuration === "0s",
    ),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const imported = await saveDraftStep("agents");
  assert.equal(imported.profiles[0].id, fixtures.qaProfileId);
  await page.getByText("Agent Flow guardado.", { exact: true }).waitFor();
  check("config and matching RSA PEM upload succeeds", true);
  check(
    "agent selection stays visible without duplicate details or dropdown",
    (await flowCheckbox.isChecked()) &&
      (await page.locator(".configured-details").count()) === 0 &&
      (await page
        .getByRole("combobox", { name: "Agent Flow", exact: true })
        .count()) === 0,
  );
}

async function checkAudioAndSuggestions({
  check,
  fixtures,
  page,
  saveDraftStep,
}) {
  await page.getByRole("tab", { name: "Audio", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Audio a texto (STT)", exact: true })
    .selectOption("ORACLE");
  await page
    .getByRole("combobox", { name: "Texto a Audio (TTS)", exact: true })
    .selectOption("qa-voice");
  const audio = await saveDraftStep("audio");
  await page.getByText("Audio guardado.", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Sugerencias", exact: true }).click();
  await page
    .getByRole("button", { name: "Agregar sugerencia", exact: true })
    .click();
  await page.getByLabel(/^T.tulo 1$/u).fill("Consulta QA guardada");
  await page
    .getByLabel("Consulta 1", { exact: true })
    .fill("Pregunta de prueba");
  check(
    "suggestion toolbar and numbered rows use compact aligned fields with red delete icons",
    await page.evaluate(() => {
      const toolbar = document.querySelector(".suggestions-toolbar");
      const select = toolbar.querySelector("select");
      const plus = toolbar.querySelector(".suggestion-add");
      const workspace = document.querySelector('[name="workspace_id"]');
      const row = document.querySelector(".suggestion-row");
      const cells = [...row.children].map((node) =>
        node.getBoundingClientRect(),
      );
      const fields = [...row.querySelectorAll("input")];
      const remove = row.querySelector(".suggestion-delete");
      const sameStyle = [
        "backgroundColor",
        "borderColor",
        "borderRadius",
        "fontSize",
      ].every(
        (key) =>
          getComputedStyle(select)[key] === getComputedStyle(workspace)[key],
      );
      return (
        sameStyle &&
        fields.length === 2 &&
        !row.querySelector("textarea") &&
        row.querySelector(".suggestion-number").textContent === "1" &&
        cells.every(
          (cell) =>
            Math.abs(
              (cell.top + cell.bottom) / 2 -
                (cells[1].top + cells[1].bottom) / 2,
            ) < 2,
        ) &&
        fields.every(
          (field) => Math.abs(field.getBoundingClientRect().height - 40) < 1,
        ) &&
        Math.abs(
          plus.getBoundingClientRect().bottom -
            select.getBoundingClientRect().bottom,
        ) < 1 &&
        !!plus.querySelector("svg") &&
        !!remove.querySelector("svg") &&
        getComputedStyle(remove).color === "rgb(255, 77, 50)" &&
        row.scrollWidth <= row.clientWidth + 1
      );
    }),
  );
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await page.getByText("Sugerencias guardadas.", { exact: true }).waitFor();
  check(
    "Sugerencias saves editable rows scoped to the selected Agent Flow",
    fixtures.qaSuggestions.get(fixtures.qaProfileId)?.[0]?.query ===
      "Pregunta de prueba",
  );
  return { audio };
}

async function checkSavedAudio({ audio, check, fixtures, page }) {
  await page.getByRole("tab", { name: "Audio", exact: true }).click();

  check(
    "saved Audio exposes cancellation with confirmation",
    await page.locator(".agent-config-form .config-cancel").isVisible(),
  );
  check(
    "Audio saves independent STT/TTS choices without duplicating the selected profile",
    audio.transcription_model === "ORACLE" &&
      audio.speech_model === "qa-voice" &&
      audio.profiles.length === 1 &&
      audio.profiles[0].id === fixtures.qaProfileId &&
      audio.profiles[0].speech_model === "qa-voice",
  );
  check(
    "each configuration step saved separately",
    fixtures.draftSteps.join(",") === "connection,agents,audio",
  );
  const readsBeforeAudioReopen = fixtures.draftReads;
  await page.getByRole("button", { name: "Cerrar configuración" }).click();
  await page.locator(".agent-config-inline").waitFor({ state: "detached" });
  return { readsBeforeAudioReopen };
}

async function checkAudioConfigurationNotice({
  check,
  expectedAudioHttpErrors,
  fixtures,
  page,
  readsBeforeAudioReopen,
}) {
  await page.route("**/api/desk/audio/realtime-session", async (route) => {
    assert.equal(
      route.request().postDataJSON().profile_id,
      fixtures.qaProfileId,
    );
    const url = route.request().url();
    expectedAudioHttpErrors.set(
      url,
      (expectedAudioHttpErrors.get(url) || 0) + 1,
    );
    await route.fulfill({
      status: 422,
      headers: { "X-Agent-Desk-Notice": "audio-configuration" },
      json: {
        detail:
          "Selecciona OCI Speech Whisper en Audio y guarda la configuracion.",
      },
    });
  });
  await page
    .getByRole("button", { name: "Dictar mensaje", exact: true })
    .click();
  const audioWarning = page.locator(".chat-audio-warning");
  await audioWarning.waitFor();
  check(
    "yellow warnings are framed above the message composer",
    await audioWarning.evaluate(
      (notice) =>
        notice.nextElementSibling?.matches(".aui-composer-root") &&
        notice.getBoundingClientRect().bottom <=
          notice.nextElementSibling.getBoundingClientRect().top &&
        getComputedStyle(notice).borderStyle === "solid",
    ),
  );
  await audioWarning.waitFor();
  check(
    "audio configuration precondition is a yellow warning with an accessible status and icon",
    await audioWarning.evaluate(
      (el) =>
        el.getAttribute("role") === "status" &&
        !!el.querySelector("svg.lucide-triangle-alert") &&
        getComputedStyle(el).color === "rgb(245, 207, 115)" &&
        getComputedStyle(el).backgroundColor === "rgb(41, 36, 22)",
    ),
  );
  await page
    .getByRole("textbox", { name: "Mensaje al agente", exact: true })
    .fill("Borrador tras aviso");
  await audioWarning.waitFor({ state: "detached" });
  check(
    "editing the draft clears stale audio configuration warnings",
    (await audioWarning.count()) === 0,
  );
  await page
    .getByRole("textbox", { name: "Mensaje al agente", exact: true })
    .fill("");
  await page
    .getByRole("button", { name: "Dictar mensaje", exact: true })
    .click();
  await audioWarning.waitFor();
  await page
    .getByRole("button", { name: "Configurar agentes", exact: true })
    .click();
  await audioWarning.waitFor({ state: "detached" });
  await page
    .getByRole("button", { name: "Cerrar configuración", exact: true })
    .click();
  await page.locator(".agent-config-inline").waitFor({ state: "detached" });
  check(
    "opening and closing configuration removes the old audio notice",
    (await audioWarning.count()) === 0,
  );
  await page.getByRole("combobox", { name: "Elegir agente" }).click();
  await page.getByRole("combobox", { name: "Elegir agente" }).press("Home");
  await page.getByRole("combobox", { name: "Elegir agente" }).press("Space");
  check(
    "dropdown can explicitly select the local demonstration",
    (await page
      .getByRole("combobox", { name: "Elegir agente" })
      .textContent()) === "Demostración local",
  );
  await page
    .getByRole("button", { name: "Configurar agentes", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('[name="compartment_id"]')?.value === "qa-comp",
  );
  await page.getByRole("tab", { name: "Audio", exact: true }).click();
  check(
    "reopening restores independent audio choices from draft metadata",
    (await page
      .getByRole("combobox", { name: "Audio a texto (STT)", exact: true })
      .inputValue()) === "ORACLE" &&
      (await page
        .getByRole("combobox", { name: "Texto a Audio (TTS)", exact: true })
        .inputValue()) === "qa-voice" &&
      fixtures.draftReads > readsBeforeAudioReopen,
  );
}

async function checkIndependentSectionCancellation({
  check,
  clearSection,
  fixtures,
  page,
  saveDraftStep,
}) {
  await clearSection();
  check(
    "Audio cancellation clears only STT and TTS, preserving connection, agent and suggestions",
    (await page
      .getByLabel("Audio a texto (STT)", { exact: true })
      .inputValue()) === "" &&
      (await page
        .getByLabel("Texto a Audio (TTS)", { exact: true })
        .inputValue()) === "" &&
      fixtures.qaDraft.compartment_id === "qa-comp" &&
      fixtures.qaDraft.agent_ids.length === 1 &&
      fixtures.qaSuggestions.get(fixtures.qaProfileId)?.[0]?.query ===
        "Pregunta de prueba",
  );
  await page
    .getByLabel("Audio a texto (STT)", { exact: true })
    .selectOption("ORACLE");
  await page
    .getByLabel("Texto a Audio (TTS)", { exact: true })
    .selectOption("qa-voice");
  await saveDraftStep("audio");
  await page.getByRole("tab", { name: "Agent Flow", exact: true }).click();
  await page.getByRole("checkbox", { name: /Agent Desk QA/ }).waitFor();
  check(
    "reopening restores the selected published agent",
    await page.getByRole("checkbox", { name: /Agent Desk QA/ }).isChecked(),
  );
  await page.getByRole("checkbox", { name: /Agent Desk QA/ }).uncheck();
  check(
    "restored Agent Flow section remains protected after changing selection",
    await page
      .getByRole("button", { name: "Guardar", exact: true })
      .isDisabled(),
  );
  await clearSection();
  check(
    "Agent Flow cancellation preserves connection, audio and suggestions",
    fixtures.qaDraft.instance_id === "" &&
      fixtures.qaDraft.workspace_id === "" &&
      fixtures.qaDraft.agent_ids.length === 0 &&
      fixtures.qaDraft.compartment_id === "qa-comp" &&
      fixtures.qaDraft.transcription_model === "ORACLE" &&
      fixtures.qaDraft.speech_model === "qa-voice" &&
      fixtures.qaSuggestions.get(fixtures.qaProfileId)?.[0]?.query ===
        "Pregunta de prueba",
  );
}

async function checkConnectionCancellation({
  check,
  clearSection,
  fixtures,
  page,
}) {
  await page
    .getByRole("button", { name: "Cerrar configuración", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Configurar agentes", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('[name="compartment_id"]')?.value === "qa-comp",
  );
  check(
    "cleared Agent Flow stays cleared after reopening while audio remains saved",
    (await page
      .getByLabel("Oracle AI Data Platform Workbench", { exact: true })
      .inputValue()) === "" &&
      (await page
        .getByLabel("Audio a texto (STT)", { exact: true })
        .inputValue()) === "ORACLE",
  );
  await page.getByRole("tab", { name: "Conexión", exact: true }).click();
  await clearSection();
  check(
    "Connection cancellation clears dependent draft forms without purging imported profiles or suggestions",
    !fixtures.qaDraft.has_credentials &&
      fixtures.qaDraft.profiles.length === 0 &&
      fixtures.qaDraft.transcription_model === "" &&
      (await page.getByLabel("Perfil", { exact: true }).inputValue()) === "" &&
      fixtures.qaSuggestions.get(fixtures.qaProfileId)?.[0]?.query ===
        "Pregunta de prueba",
  );
  await page.getByRole("button", { name: "Cerrar configuración" }).click();
  await page.locator(".agent-config-inline").waitFor({ state: "detached" });
}

async function checkSyntheticProfileCleanup({ check, fixtures, page }) {
  const cleanupResponse = await page.request.delete(
    `http://127.0.0.1:8317/api/desk/profiles/${fixtures.qaProfileId}`,
    {
      headers: {
        "X-Agent-Desk": "configure",
        Origin: "http://127.0.0.1:8317",
      },
    },
  );
  assert.equal(cleanupResponse.status(), 204);
  const profiles = await (
    await page.request.get("http://127.0.0.1:8317/api/desk/profiles")
  ).json();
  check(
    "only the synthetic QA credential profile was removed",
    !profiles.some((p) => p.flow_id === "agent-desk-qa-only"),
  );
}

module.exports = {
  checkConfigurationTabs,
  checkCredentialDiscovery,
  checkNativeProfilePicker,
  checkConnectionPersistence,
  checkFlowDiscovery,
  checkFlowSave,
  checkAudioAndSuggestions,
  checkSavedAudio,
  checkAudioConfigurationNotice,
  checkIndependentSectionCancellation,
  checkConnectionCancellation,
  checkSyntheticProfileCleanup,
};
