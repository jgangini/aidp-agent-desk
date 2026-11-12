// Installed Playwright only. No screenshots, recordings, traces or browser downloads.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const installVoiceFixtures = require("./browser-voice-fixtures.cjs");
const { chromium } = require(
  process.env.AGENT_DESK_PLAYWRIGHT_MODULE || "playwright",
);
const welcomeChecks = require("./browser-check-welcome.cjs");
const demoChecks = require("./browser-check-demo.cjs");
const configurationChecks = require("./browser-check-configuration.cjs");
const publicationsChecks = require("./browser-check-publications.cjs");
const developmentChecks = require("./browser-check-development.cjs");
const streamChecks = require("./browser-check-stream.cjs");
const historyChecks = require("./browser-check-history.cjs");
const {
  createFixtures,
  installSuggestions,
  installDraftRoutes,
} = require("./browser-check-fixtures.cjs");
(async () => {
  const browser = await chromium.launch({
    ...(process.env.AGENT_DESK_BROWSER_EXECUTABLE ? {executablePath:process.env.AGENT_DESK_BROWSER_EXECUTABLE}:{}),
    headless: true,
    chromiumSandbox: true,
  });
  if (process.env.AGENT_DESK_SCHEDULED_BROWSER_URL) {
    try { await require("./browser-scheduled-server-check.cjs")(browser,process.env.AGENT_DESK_SCHEDULED_BROWSER_URL); }
    finally { await browser.close(); }
    return;
  }
  if (process.env.AGENT_DESK_CONTENT_BROWSER_URL) {
    try {
      await require("./browser-content-items-check.cjs")(
        browser,
        process.env.AGENT_DESK_CONTENT_BROWSER_URL,
      );
    } finally {
      await browser.close();
    }
    return;
  }
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  let page = await context.newPage();
  const errors = [];
  const expectedAudioHttpErrors = new Map();
  let observedAudioHttpErrors = 0;
  const fixtures = createFixtures();

  const fixtureDir = path.resolve(__dirname, "../.cache/browser-fixtures");
  const multipartField = (request, name) =>
    new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(
      request.postData() || "",
    )?.[1];
  const requests = new Set();
  const checks = [];
  const check = (name, ok, details) => {
    assert.ok(ok, details ? `${name}: ${JSON.stringify(details)}` : name);
    checks.push(name);
  };
  page.on("pageerror", (e) => errors.push(String(e)));
  const recordConsole = (message) => {
    if (message.type() !== "error") return;
    const url = message.location().url;
    const remaining = expectedAudioHttpErrors.get(url) || 0;
    if (
      remaining > 0 &&
      /^Failed to load resource: the server responded with a status of 422\b/.test(
        message.text(),
      )
    ) {
      expectedAudioHttpErrors.set(url, remaining - 1);
      observedAudioHttpErrors++;
    } else errors.push(message.text());
  };
  page.on("console", recordConsole);
  page.on("request", (r) => requests.add(r.url()));
  await page.addInitScript(installVoiceFixtures);
  await page.addInitScript(() => {
    // This runner exercises demo animation; remote transport has dedicated checks.
    if (!localStorage.getItem("agent-desk.selected-profile")) {
      localStorage.setItem("agent-desk.selected-profile", "demo");
    }
    window.__deskDraws = 0;
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      window.__deskDraws++;
      return draw.apply(this, args);
    };
  });
  await installSuggestions(page, fixtures);
  await installDraftRoutes(page, fixtures, fixtureDir, multipartField);

  try {
    await welcomeChecks.checkWelcomeConstruction({ check, page });
    await welcomeChecks.checkWelcomeTooltips({ check, page });
    await welcomeChecks.checkIdleBrand({ check, page });
    await welcomeChecks.checkIdleWorkspace({ check, page });
    const { normalTitleType } = await welcomeChecks.checkAgentPicker({
      check,
      page,
    });
    await welcomeChecks.checkConfigurationEntrance({
      check,
      normalTitleType,
      page,
    });

    const submit = async (text) => {
      await page.getByRole("textbox", { name: "Mensaje al agente" }).fill(text);
      await page
        .getByRole("button", { name: "Enviar consulta", exact: true })
        .click();
    };
    await demoChecks.checkChatResize({ check, page });
    await demoChecks.checkDemoSourceProgress({ check, page, submit });
    await demoChecks.checkDemoCompletion({ check, page });
    await demoChecks.checkResultsSearch({ check, page });
    const { swap } = await demoChecks.checkExpandedResults({ check, page });
    await demoChecks.checkResultsMotionAndHistory({ check, page, swap });
    await demoChecks.checkResponseActions({ check, page });
    await demoChecks.checkSpeechPlayback({ check, page });
    await demoChecks.checkMicrophoneEnergy({ check, page });
    await demoChecks.checkVoiceConversation({ check, page, submit });
    await configurationChecks.checkConfigurationTabs({ check, page });
    await configurationChecks.checkCredentialDiscovery({
      check,
      fixtureDir,
      multipartField,
      page,
    });
    await configurationChecks.checkNativeProfilePicker({ check, page });

    const saveDraftStep = async (step) => {
      const state = await page
        .locator(".agent-config-form")
        .evaluate((form) => ({
          valid: form.checkValidity(),
          invalid: [...form.elements]
            .filter((el) => el.willValidate && !el.validity.valid)
            .map((el) => ({
              name: el.name,
              value: el.value,
              message: el.validationMessage,
            })),
          disabled: form.querySelector('button[type="submit"]').disabled,
        }));
      assert.ok(
        state.valid && !state.disabled,
        `draft ${step} must be ready: ${JSON.stringify(state)}`,
      );
      const pending = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/desk/discovery/draft") &&
          response.request().method() === "POST" &&
          multipartField(response.request(), "step") === step,
      );
      await page.getByRole("button", { name: "Guardar", exact: true }).click();
      const response = await pending;
      assert.equal(response.status(), 200);
      const metadata = await response.json();
      await page
        .getByRole("button", { name: "Guardar", exact: true })
        .waitFor();
      return metadata;
    };
    await configurationChecks.checkConnectionPersistence({
      check,
      fixtures,
      page,
      saveDraftStep,
    });
    const { flowCheckbox } = await configurationChecks.checkFlowDiscovery({
      check,
      page,
    });
    await configurationChecks.checkFlowSave({
      check,
      fixtures,
      flowCheckbox,
      page,
      saveDraftStep,
    });
    const { audio } = await configurationChecks.checkAudioAndSuggestions({
      check,
      fixtures,
      page,
      saveDraftStep,
    });
    const { readsBeforeAudioReopen } =
      await configurationChecks.checkSavedAudio({
        audio,
        check,
        fixtures,
        page,
      });
    await configurationChecks.checkAudioConfigurationNotice({
      check,
      expectedAudioHttpErrors,
      fixtures,
      page,
      readsBeforeAudioReopen,
    });

    const clearSection = async () => {
      await page.locator(".agent-config-form > footer .config-cancel").click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("button", { name: "Aceptar", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
    };
    await configurationChecks.checkIndependentSectionCancellation({
      check,
      clearSection,
      fixtures,
      page,
      saveDraftStep,
    });
    await configurationChecks.checkConnectionCancellation({
      check,
      clearSection,
      fixtures,
      page,
    });
    await configurationChecks.checkSyntheticProfileCleanup({
      check,
      fixtures,
      page,
    });
    const { layouts, contrast } =
      await welcomeChecks.checkResponsiveLayoutsAndContrast({ check, page });
    const {
      priorPage,
      developmentPage,
      developmentCommands,
      postReferences,
      sourceSummary,
      developmentInput,
    } = await developmentChecks.prepareDevelopmentPage({
      context,
      errors,
      fixtureDir,
      fixtures,
      page,
      recordConsole,
    });
    await developmentChecks.checkDevelopmentInvocation({
      check,
      developmentCommands,
      developmentInput,
      developmentPage,
      fixtures,
    });
    const { youtubePosts } =
      await publicationsChecks.checkPublicationNavigation({
        check,
        developmentPage,
      });
    await publicationsChecks.checkPublicationImageMotion({
      check,
      developmentPage,
    });
    await publicationsChecks.checkRapidPublicationSelection({
      check,
      developmentPage,
      postReferences,
      youtubePosts,
    });
    await publicationsChecks.checkPublicationLinks({
      check,
      context,
      developmentPage,
      fixtures,
      postReferences,
      youtubePosts,
    });
    const { compactBoard } =
      await publicationsChecks.checkSourceArtifactsAndLayout({
        check,
        developmentPage,
        sourceSummary,
      });
    const { sourceCard, sourceSummaryButton } =
      await publicationsChecks.checkSummaryExpansion({
        check,
        compactBoard,
        developmentPage,
      });
    await publicationsChecks.checkSummaryFolding({
      check,
      compactBoard,
      developmentPage,
      sourceCard,
      sourceSummaryButton,
    });
    const { resultFilter } = await publicationsChecks.checkSearchExpansion({
      check,
      developmentPage,
    });
    await publicationsChecks.checkRepeatedSearch({
      check,
      compactBoard,
      developmentPage,
      resultFilter,
      sourceSummaryButton,
    });
    await publicationsChecks.checkScheduledEntryAndBottomPicker({
      check,
      developmentInput,
      developmentPage,
    });
    await developmentChecks.checkDevelopmentPersistenceAndFailure({
      check,
      developmentCommands,
      developmentInput,
      developmentPage,
    });
    await developmentChecks.checkHistoricalResponseActions({
      check,
      developmentPage,
      priorPage,
    });
    const { streamingPage } = await streamChecks.prepareStreamingPage({
      check,
      context,
      errors,
      fixtures,
      recordConsole,
      requests,
    });
    await streamChecks.checkSourceTextStreaming({ check, streamingPage });
    const { emitMarkdown, emitAnswer, atBottom, firstScroll, richMarkdown } =
      await streamChecks.prepareConsolidatedAnswer({ check, streamingPage });
    await streamChecks.checkRichMarkdownStreaming({
      atBottom,
      check,
      emitAnswer,
      emitMarkdown,
      firstScroll,
      richMarkdown,
      streamingPage,
    });
    await streamChecks.checkManualScrollFollowing({
      atBottom,
      check,
      emitAnswer,
      streamingPage,
    });
    await streamChecks.checkStreamingCompletion({
      atBottom,
      check,
      emitAnswer,
      streamingPage,
    });
    await historyChecks.checkConversationDeletion({ check, context });
    const { noticePage } = await historyChecks.prepareRecoveryPage({
      context,
      errors,
      fixtures,
    });
    await historyChecks.checkRecoveryNotice({ check, noticePage });
    await historyChecks.checkRecoveryReplay({ check, noticePage });

    page = await context.newPage();
    const { receivedCount } = await historyChecks.checkStatusShimmer({
      check,
      errors,
      page,
      recordConsole,
      requests,
      submit,
    });
    await historyChecks.checkConversationHistory({
      check,
      page,
      receivedCount,
    });
    await historyChecks.checkScheduledPanelEntry({ check, page });
    await historyChecks.writeBrowserReport({
      check,
      checks,
      contrast,
      errors,
      expectedAudioHttpErrors,
      layouts,
      observedAudioHttpErrors,
      requests,
    });
  } finally {
    if (fixtures.qaProfileId)
      await page.request.delete(
        `http://127.0.0.1:8317/api/desk/profiles/${fixtures.qaProfileId}`,
        {
          headers: {
            "X-Agent-Desk": "configure",
            Origin: "http://127.0.0.1:8317",
          },
        },
      );
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
