async function checkChatResize({ check, page }) {
  check(
    "scene has no metrics, speed selector or manual motion toggle",
    (await page.locator(".metrics,#speed,.motion-button").count()) === 0,
  );
  const resize = page.getByRole("separator", {
    name: "Ajustar ancho del chat",
  });
  const maxChatWidth = await page
    .locator(".chat-panel")
    .evaluate((panel) => panel.getBoundingClientRect().width);
  await resize.press("Home");
  const minChatWidth = await page
    .locator(".chat-panel")
    .evaluate((panel) => panel.getBoundingClientRect().width);
  check(
    "chat separator narrows by at most 100px and restores its original maximum",
    minChatWidth < maxChatWidth &&
      maxChatWidth - minChatWidth <= 101 &&
      minChatWidth >= 399,
  );
  await resize.press("End");
  const handle = await resize.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
  await page.mouse.down();
  check(
    "dragging the separator has no rectangular white outline",
    await resize.evaluate(
      (handle) => getComputedStyle(handle).outlineStyle === "none",
    ),
  );
  await page.mouse.move(handle.x + handle.width / 2 + 50, handle.y + 100);
  await page.mouse.up();
  check(
    "chat separator supports pointer dragging",
    await page
      .locator(".chat-panel")
      .evaluate(
        (panel, maximum) => panel.getBoundingClientRect().width < maximum - 30,
        maxChatWidth,
      ),
  );
  const rememberedWidth = await page
    .locator(".chat-panel")
    .evaluate((panel) => panel.getBoundingClientRect().width);
  await page.reload();
  await page.waitForFunction(
    (width) =>
      Math.abs(
        document.querySelector(".chat-panel").getBoundingClientRect().width -
          width,
      ) <= 1,
    rememberedWidth,
  );
  check("chat width survives a full page refresh", true);
  await resize.press("End");
}

async function checkDemoSourceProgress({ check, page, submit }) {
  await submit("Investiga tendencias de IA");
  check(
    "sending smoothly moves the same composer into conversation layout",
    await page
      .locator(".aui-composer-root")
      .evaluate((form) => getComputedStyle(form).transform !== "none"),
  );
  await page.waitForFunction(
    () => document.querySelector(".aui-composer-root").style.transform === "",
  );

  check(
    "thinking starts alone without prelisting running tools",
    (await page.getByText("thinking", { exact: true }).isVisible()) &&
      (await page.locator(".tool-progress li").count()) === 0 &&
      (await page.locator(".aui-run-status").count()) === 0,
  );
  check(
    "streaming core has no orbital tool icons",
    (await page.locator(".orbital-tool, [data-orbit-source]").count()) === 0,
  );
  await page.locator(".finding").first().waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".activity-section").getBoundingClientRect()
        .width > 240,
  );
  await page.waitForFunction(() => {
    const card = document.querySelector(".finding.t-resize");
    return card && card.style.height === "" && card.style.overflow === "";
  });
  check("card resize releases height and clipping after arrival", true);
  await page.waitForFunction(() => {
    const card = document.querySelector(".finding");
    return (
      getComputedStyle(card.querySelector(".finding-skeleton")).display ===
        "none" && card.querySelector(".finding-content").style.opacity === ""
    );
  });
  check("placeholder bars give way to real card content", true);

  check(
    "the first real finding opens results between the scene and chat",
    await page.evaluate(() => {
      const scene = document
        .querySelector(".network-stage")
        .getBoundingClientRect();
      const results = document
        .querySelector(".activity-section")
        .getBoundingClientRect();
      const chat = document
        .querySelector(".chat-panel")
        .getBoundingClientRect();
      return (
        scene.right <= results.left + 1 &&
        results.right <= chat.left + 1 &&
        !document.querySelector(".results-empty")
      );
    }),
  );
  check(
    "tool rows are revealed only for outputs actually received",
    await page.evaluate(() => {
      const findings = [
        ...document.querySelectorAll(".finding:not(.finding-analysis)"),
      ];
      const rows = [...document.querySelectorAll(".tool-progress li")];
      return (
        rows.length > 0 &&
        rows.length < 6 &&
        rows.length === findings.length &&
        rows.every((row) =>
          findings.some((finding) =>
            finding.textContent.includes(row.querySelector("p").textContent),
          ),
        )
      );
    }),
  );
  await page
    .getByRole("status", { name: "Analizando resultados", exact: true })
    .waitFor();
  check(
    "sources fold when the analysis loader begins",
    await page.locator(".tool-progress").evaluate((details) => !details.open),
  );
  check(
    "analysis uses the sixteen-dot matrix instead of task title",
    (await page.locator(".t-matrix i").count()) === 16 &&
      !(await page.locator(".tool-progress-analysis").textContent()).trim(),
  );
  check(
    "tool history has no vertical line",
    await page
      .locator(".tool-progress ol")
      .evaluate((list) => getComputedStyle(list).borderLeftWidth === "0px"),
  );
}

async function checkDemoCompletion({ check, page }) {
  await page.waitForFunction(() =>
    document
      .querySelector(".answer-text > .t-stream")
      ?.textContent.startsWith("Preparé"),
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.waitForFunction(() => {
    const viewport = document
      .querySelector(".aui-thread-viewport")
      .getBoundingClientRect();
    const bubble = document
      .querySelector(".aui-user-message-content")
      .getBoundingClientRect();
    return bubble.top - viewport.top >= 15 && bubble.top - viewport.top <= 44;
  });
  check("query keeps at least sixteen pixels below the header", true);
  check(
    "streaming view has no playback bar or pause/reset actions",
    (await page.locator(".simulation-controls").count()) === 0 &&
      (await page.getByRole("button", { name: /^Pausar simulaci/ }).count()) ===
        0 &&
      (await page
        .getByRole("button", { name: /^Reiniciar simulaci/ })
        .count()) === 0,
  );
  const draws = await page.evaluate(() => window.__deskDraws);
  await page.waitForFunction(() => {
    const rail = document.querySelector(".activity-section .findings");
    return rail.scrollHeight - rail.clientHeight - rail.scrollTop < 3;
  });
  check(
    "new result cards are followed to the bottom before viewport changes",
    true,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction((n) => window.__deskDraws > n, draws);
  check("resizing the active scene continues rendering", true);
  await page
    .getByRole("button", { name: "Enviar consulta", exact: true })
    .waitFor();
  check(
    "core remains free of tool icons after streaming",
    (await page.locator(".orbital-tool:visible").count()) === 0,
  );
  check(
    "six source notes plus analysis are completed",
    (await page.locator(".finding").count()) === 7,
  );
  check(
    "settled result cards leave no inline transform behind",
    await page
      .locator(".finding")
      .evaluateAll((cards) => cards.every((card) => !card.style.transform)),
  );
  check(
    "results and chart fit their rail without horizontal scrolling",
    await page
      .locator(".activity-section")
      .evaluate((rail) =>
        [
          rail,
          ...rail.querySelectorAll(
            ".results-panel,.findings,.finding,.demo-chart",
          ),
        ].every((node) => node.scrollWidth <= node.clientWidth + 1),
      ),
  );
}

async function checkResultsSearch({ check, page }) {
  check(
    "search replaces count and export in the results header",
    (await page
      .getByRole("textbox", { name: "Filtrar resultados", exact: true })
      .getAttribute("placeholder")) === "Resultados (7)" &&
      (await page
        .getByRole("button", { name: "Exportar", exact: true })
        .count()) === 0,
  );
  await page
    .getByRole("textbox", { name: "Filtrar resultados", exact: true })
    .fill("INSTAGRAM");
  check(
    "result search filters cards by source",
    (await page.locator(".finding").count()) === 1 &&
      (await page.locator(".finding-instagram").count()) === 1,
  );
  await page
    .getByRole("button", { name: "Limpiar filtro", exact: true })
    .click();
  check(
    "clearing restores cards and search focus",
    (await page.locator(".finding").count()) === 7 &&
      (await page
        .getByRole("textbox", { name: "Filtrar resultados", exact: true })
        .evaluate((input) => document.activeElement === input)),
  );
  check(
    "search width matches cards and top spacing matches the card gap",
    await page.evaluate(() => {
      const input = document
        .querySelector(".results-search")
        .getBoundingClientRect();
      const card = document.querySelector(".finding").getBoundingClientRect();
      const list = document.querySelector(".findings");
      const style = getComputedStyle(list);
      return (
        Math.abs(input.width - card.width) <= 1 &&
        Math.abs(input.left - card.left) <= 1 &&
        Math.abs(
          parseFloat(style.paddingTop) -
            (document.querySelectorAll(".finding")[1].getBoundingClientRect()
              .top -
              card.bottom),
        ) <= 1
      );
    }),
  );
  await page
    .getByRole("textbox", { name: "Filtrar resultados", exact: true })
    .focus();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".results-search"))
        .borderColor === "rgb(102, 104, 109)",
  );
  const searchBorder = await page
    .locator(".results-search")
    .evaluate((node) => getComputedStyle(node).borderColor);
  const searchFocusClean = await page
    .getByRole("textbox", { name: "Filtrar resultados", exact: true })
    .evaluate(
      (node) =>
        getComputedStyle(node).boxShadow === "none" &&
        getComputedStyle(node).outlineStyle === "none",
    );
  await page
    .getByRole("textbox", { name: "Mensaje al agente", exact: true })
    .focus();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".aui-composer-shell"))
        .borderColor === "rgb(102, 104, 109)",
  );
  check(
    "search uses the composer focus border without an inner focus ring",
    searchFocusClean &&
      searchBorder ===
        (await page
          .locator(".aui-composer-shell")
          .evaluate((node) => getComputedStyle(node).borderColor)),
  );
  await page.locator(".results-search").hover();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".results-search"))
        .borderColor === "rgb(102, 104, 109)",
  );
  check("search hover retains the shared composer border", true);
  check(
    "results header remains aligned with the stage wordmark",
    await page.evaluate(() => {
      const header = document
        .querySelector(".results-titlebar")
        .getBoundingClientRect();
      const brand = document
        .querySelector(".desk-wordmark")
        .getBoundingClientRect();
      return Math.abs(header.height - brand.height) <= 1;
    }),
  );
}

async function checkExpandedResults({ check, page }) {
  const swap = page.locator(".stage-swap");
  const originalCards = await page.locator(".finding").count();
  const originalChat = await page.locator(".chat-panel").boundingBox();
  const originalBrand = await page.locator(".desk-wordmark").boundingBox();
  const transitionPhases = page.locator(".workspace").evaluate(
    (el) =>
      new Promise((resolve) => {
        const phases = [];
        const timer = setTimeout(() => {
          observer.disconnect();
          resolve(phases);
        }, 2000);
        const observer = new MutationObserver(() => {
          phases.push({
            phase: el.dataset.viewTransition,
            expanded: el.dataset.resultsExpanded,
          });
          if (el.dataset.viewTransition === "idle") {
            observer.disconnect();
            clearTimeout(timer);
            resolve(phases);
          }
        });
        observer.observe(el, {
          attributes: true,
          attributeFilter: ["data-view-transition"],
        });
      }),
  );
  await swap.click();
  check(
    "view switch exits before reflow and reveals the destination before settling",
    (await transitionPhases).some(
      (item) => item.phase === "exit" && item.expanded === "false",
    ),
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".workspace").dataset.viewTransition === "idle",
  );
  await page.waitForFunction(() => {
    const workspace = document
      .querySelector(".workspace")
      .getBoundingClientRect();
    const results = document
      .querySelector(".activity-section")
      .getBoundingClientRect();
    return Math.abs(workspace.width - results.width) < 2;
  });
  check(
    "expanded results fill workspace with fixed logo, no core and voice at bottom right",
    await page.evaluate(
      ({ count, chat, brand }) => {
        const rect = (selector) =>
          document.querySelector(selector).getBoundingClientRect();
        return (
          document.querySelectorAll(".finding").length === count &&
          !document.querySelector(".brain-canvas") &&
          Math.abs(rect(".chat-panel").left - chat.x) < 2 &&
          Math.abs(rect(".desk-wordmark").left - brand.x) < 2 &&
          Math.abs(rect(".desk-wordmark").top - brand.y) < 2 &&
          rect(".voice-dock-slot").right > rect(".workspace").right - 20 &&
          rect(".voice-dock-slot").bottom > rect(".workspace").bottom - 20
        );
      },
      { count: originalCards, chat: originalChat, brand: originalBrand },
    ),
  );
  check(
    "expanded cards use two columns, search is centered and voice glow spans the base",
    await page.evaluate(() => {
      const rect = (selector) =>
        document.querySelector(selector).getBoundingClientRect();
      const cards = document.querySelectorAll(".finding");
      const first = cards[0].getBoundingClientRect();
      const second = cards[1].getBoundingClientRect();
      const workspace = rect(".workspace");
      const voice = rect(".voice-dock-slot");
      const search = rect(".results-search");
      return (
        Math.abs(first.top - second.top) < 2 &&
        second.left > first.right &&
        Math.abs(voice.width - workspace.width) < 2 &&
        Math.abs(voice.bottom - workspace.bottom) < 2 &&
        search.width <= 321 &&
        Math.abs(
          (search.left + search.right) / 2 -
            (workspace.left + workspace.right) / 2,
        ) < 2 &&
        rect(".voice-dock-button").right > workspace.right - 30
      );
    }),
  );
  return { swap };
}

async function checkResultsMotionAndHistory({ check, page, swap }) {
  await swap.click();
  await page.waitForFunction(
    () =>
      document.querySelector(".workspace").dataset.viewTransition === "idle",
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".brain-canvas") &&
      document.querySelector(".activity-section").getBoundingClientRect().left >
        document.querySelector(".network-stage").getBoundingClientRect().left,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(".stage-swap").click();
  check(
    "reduced motion switches views immediately without a reveal animation",
    await page
      .locator(".workspace")
      .evaluate(
        (el) =>
          el.dataset.viewTransition === "idle" &&
          el.dataset.resultsExpanded === "true" &&
          getComputedStyle(el.querySelector(".findings")).animationName ===
            "none",
      ),
  );
  await page.locator(".stage-swap").click();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const resultHeaderTop = await page
    .locator(".results-titlebar")
    .evaluate((header) => header.getBoundingClientRect().top);
  check(
    "results header divider aligns with the chat header",
    await page.evaluate(() => {
      const results = document
        .querySelector(".results-titlebar")
        .getBoundingClientRect();
      const chat = document
        .querySelector(".chat-header")
        .getBoundingClientRect();
      return (
        Math.abs(results.top - chat.top) <= 1 &&
        Math.abs(results.bottom - chat.bottom) <= 1
      );
    }),
  );
  await page.locator(".activity-section .findings").evaluate((rail) => {
    rail.scrollTop = rail.scrollHeight;
  });
  check(
    "results header stays fixed while its cards scroll",
    await page.locator(".activity-section .findings").evaluate((rail, top) => {
      const header = rail
        .closest(".results-panel")
        .querySelector(".results-titlebar")
        .getBoundingClientRect();
      return (
        rail.scrollTop > 0 &&
        Math.abs(rail.getBoundingClientRect().top - header.bottom) <= 1 &&
        Math.abs(header.top - top) <= 1 &&
        rail.querySelector(".finding").getBoundingClientRect().top <
          header.bottom
      );
    }, resultHeaderTop),
  );
  check(
    "tool history uses elapsed time instead of repeated status badges",
    /Worked for \d/.test(
      await page.locator(".tool-progress summary").textContent(),
    ) &&
      !(await page.locator(".tool-progress").textContent()).includes(
        "Recibido",
      ) &&
      !(await page.locator(".tool-progress summary").textContent()).includes(
        "Simulación",
      ),
  );
  check(
    "all six chart values have accessible rows",
    (await page.locator(".demo-chart tbody tr").count()) === 6,
  );
}

async function checkResponseActions({ check, page }) {
  await page
    .getByRole("button", { name: "Respuesta útil", exact: true })
    .click();
  check(
    "response feedback is toggleable and mutually exclusive",
    (await page
      .getByRole("button", { name: "Respuesta útil", exact: true })
      .getAttribute("aria-pressed")) === "true",
  );
  await page
    .getByRole("button", { name: "Respuesta no útil", exact: true })
    .click();
  check(
    "negative feedback replaces a positive vote",
    (await page
      .getByRole("button", { name: "Respuesta útil", exact: true })
      .getAttribute("aria-pressed")) === "false",
  );
  check(
    "response duration is plain text without the removed metrics popup",
    (await page.locator("details.response-timing").count()) === 0 &&
      (await page
        .getByText("Tiempo virtual de simulación", { exact: true })
        .count()) === 0 &&
      /^\d+\.\d{2}s$/.test(
        await page.locator("span.response-timing").textContent(),
      ),
  );
  await page.getByLabel("Más acciones de respuesta", { exact: true }).click();
  check(
    "the response export menu opens to the right of its trigger on desktop",
    await page.locator(".response-more[open]").evaluate((menu) => {
      const trigger = menu.querySelector("summary").getBoundingClientRect();
      const panel = menu
        .querySelector(".chat-popover-content")
        .getBoundingClientRect();
      return panel.left >= trigger.left - 1 && panel.right <= window.innerWidth;
    }),
  );
  const resizeForMenu = page.getByRole("separator", {
    name: "Ajustar ancho del chat",
    exact: true,
  });
  await resizeForMenu.press("Home");
  check(
    "the export menu stays within a narrowed desktop chat panel",
    await page.locator(".response-more[open]").evaluate((menu) => {
      const panel = menu
        .querySelector(".chat-popover-content")
        .getBoundingClientRect();
      const viewport = menu
        .closest(".aui-thread-viewport")
        .getBoundingClientRect();
      return panel.left >= viewport.left && panel.right <= viewport.right;
    }),
  );
  await resizeForMenu.press("End");
  const responseDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export as Markdown", exact: true })
    .click();
  check(
    "response text export works",
    (await responseDownload).suggestedFilename() === "agent-desk-respuesta.md",
  );
  check(
    "context usage counter is removed from the composer",
    (await page.locator(".context-meter").count()) === 0,
  );
  check(
    "microphone and speech controls are available with capability detection",
    (await page
      .getByRole("button", { name: "Dictar mensaje", exact: true })
      .count()) === 1 &&
      (await page
        .getByRole("button", { name: "Leer respuesta", exact: true })
        .count()) === 1,
  );
  await page
    .getByRole("button", { name: "Regenerar respuesta", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enviar consulta", exact: true })
    .waitFor();
  check(
    "regeneration replaces the answer and findings without duplicating a turn",
    (await page.locator(".aui-user-message").count()) === 1 &&
      (await page.locator(".finding").count()) === 7 &&
      (await page
        .getByRole("button", { name: "Respuesta no útil", exact: true })
        .getAttribute("aria-pressed")) === "false",
  );
}

async function checkSpeechPlayback({ check, page }) {
  await page
    .getByRole("button", { name: "Leer respuesta", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".brain-canvas").dataset.voiceMode === "speaking",
  );
  check(
    "speech has no fabricated beat before a word event",
    Number(
      await page.locator(".brain-canvas").getAttribute("data-voice-level"),
    ) < 0.01,
  );
  await page.evaluate(() =>
    window.__speechUtterance.dispatchEvent(
      Object.assign(new Event("boundary"), { name: "word" }),
    ),
  );
  await page.waitForFunction(
    () =>
      Number(document.querySelector(".brain-canvas").dataset.voiceLevel) > 0.25,
  );
  check("word boundaries drive the particle reaction", true);
  await page.waitForFunction(
    () =>
      Number(document.querySelector(".brain-canvas").dataset.speakingTint) >
      0.7,
  );
  const paletteTime = await page
    .locator(".brain-canvas")
    .getAttribute("data-voice-color-time");
  await page.waitForFunction(
    (before) =>
      Number(document.querySelector(".brain-canvas").dataset.voiceColorTime) >
      Number(before) + 0.05,
    paletteTime,
  );
  check(
    "audible speech activates the animated Desk palette on the particle core",
    true,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(
    () =>
      Number(document.querySelector(".brain-canvas").dataset.speakingTint) >
      0.99,
  );
  const frozenPalette = await page
    .locator(".brain-canvas")
    .getAttribute("data-voice-color-time");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  check(
    "reduced motion freezes color drift while retaining the speech tint",
    (await page
      .locator(".brain-canvas")
      .getAttribute("data-voice-color-time")) === frozenPalette &&
      Number(
        await page.locator(".brain-canvas").getAttribute("data-speaking-tint"),
      ) > 0.9,
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page
    .getByRole("button", { name: "Detener lectura", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector(".brain-canvas").dataset.voiceMode === "idle",
  );
}

async function checkMicrophoneEnergy({ check, page }) {
  await page
    .getByRole("button", { name: "Hablar con el agente", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.__microphoneFixture &&
      document.querySelector(".brain-canvas").dataset.voiceMode === "listening",
  );
  await page.evaluate(() => {
    window.__microphoneFixture.gain.gain.value = 0.15;
  });
  await page.waitForFunction(
    () =>
      Number(document.querySelector(".brain-canvas").dataset.voiceLevel) > 0.4,
  );
  await page.waitForFunction(() => {
    const beam = document.querySelector(".voice-dock-beam");
    const id = beam.getAttribute("data-voice-beam");
    return parseFloat(beam.style.getPropertyValue(`--vb-level-${id}`)) > 0.1;
  });
  check("VoiceBeam glow reacts to the same real microphone signal", true);
  check(
    "voice dock keeps its waveform and animates its bars while listening",
    await page
      .locator(".voice-dock-wave")
      .evaluate(
        (icon) =>
          icon.querySelectorAll("i").length === 5 &&
          getComputedStyle(icon.firstElementChild).animationName ===
            "voice-bars",
      ),
  );
  await page.waitForFunction(
    () =>
      Number(document.querySelector(".brain-canvas").dataset.listeningTint) >
      0.85,
  );
  check("measured microphone audio lights the particle core white", true);
  check(
    "conversation capture does not turn the composer into a dictation session",
    await page
      .getByRole("button", { name: "Dictar mensaje", exact: true })
      .isVisible(),
  );
  check("a real Web Audio signal feeds microphone energy into the scene", true);
  await page.evaluate(() => {
    window.__microphoneFixture.gain.gain.value = 0;
  });
  await page.waitForFunction(
    () =>
      Number(document.querySelector(".brain-canvas").dataset.voiceLevel) < 0.08,
  );
  check("silence releases the microphone response", true);
  await page.getByRole("button", { name: "Detener voz", exact: true }).click();
  await page.waitForFunction(() =>
    window.__microphoneFixture.stream
      .getTracks()
      .every((track) => track.readyState === "ended"),
  );
  check(
    "voice dock returns to idle without losing its button",
    await page
      .getByRole("button", { name: "Hablar con el agente", exact: true })
      .isVisible(),
  );
  check("stopping dictation closes the microphone tracks", true);
  await page.evaluate(() => window.__microphoneFixture.context.close());
}

async function checkVoiceConversation({ check, page, submit }) {
  await page
    .getByRole("button", { name: "Dictar mensaje", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Detener dictado", exact: true })
    .waitFor();
  check(
    "composer dictation retains its solid red stop control",
    await page
      .locator(".dictation-stop svg")
      .evaluate(
        (icon) =>
          icon.getAttribute("fill") === "currentColor" &&
          getComputedStyle(icon).color === "rgb(248, 113, 113)",
      ),
  );
  await page
    .getByRole("button", { name: "Detener dictado", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Dictar mensaje", exact: true })
    .waitFor();
  const turnsBeforeVoice = await page.locator(".aui-user-message").count();
  await page
    .getByRole("textbox", { name: "Mensaje al agente", exact: true })
    .fill("Borrador protegido");
  await page
    .getByRole("button", { name: "Hablar con el agente", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".voice-dock").dataset.voicePhase === "listening",
  );
  await page.evaluate(() => {
    const result = Object.assign([{ transcript: "Pregunta de voz continua" }], {
      isFinal: true,
    });
    window.__recognitionFixture.dispatchEvent(
      Object.assign(new Event("result"), { results: [result] }),
    );
    window.__recognitionFixture.stop();
  });
  await page.waitForFunction(
    () =>
      document.querySelector(".voice-dock").dataset.voicePhase === "waiting",
  );
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  await page.clock.runFor(30000);
  await page.clock.resume();
  await page.waitForFunction(
    () =>
      document.querySelector(".voice-dock").dataset.voicePhase === "speaking",
  );
  check(
    "a final spoken turn is sent exactly once and its answer is read without replacing the draft",
    (await page.locator(".aui-user-message").count()) ===
      turnsBeforeVoice + 1 &&
      (await page
        .getByRole("textbox", { name: "Mensaje al agente", exact: true })
        .inputValue()) === "Borrador protegido" &&
      (await page
        .getByRole("button", { name: "Detener voz", exact: true })
        .isVisible()),
  );
  await page.evaluate(() =>
    window.__speechUtterance.dispatchEvent(new Event("end")),
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".voice-dock").dataset.voicePhase === "listening",
  );
  check(
    "voice conversation listens for the next turn only after TTS finishes",
    true,
  );
  await page.getByRole("button", { name: "Detener voz", exact: true }).click();
  check(
    "stopping the conversation prevents another submission and returns its control to idle",
    (await page
      .getByRole("button", { name: "Hablar con el agente", exact: true })
      .isVisible()) &&
      (await page.locator(".aui-user-message").count()) ===
        turnsBeforeVoice + 1,
  );
  await page
    .getByRole("textbox", { name: "Mensaje al agente", exact: true })
    .fill("");
  await page.evaluate(async () => {
    for (const fixture of window.__microphoneFixtures || [])
      if (fixture.context.state !== "closed") await fixture.context.close();
  });

  await submit("Prueba de cancelación");
  await page.getByRole("button", { name: "Detener consulta" }).click();
  await page
    .getByText("Consulta cancelada. Puedes enviar otra.", { exact: true })
    .waitFor();
  check("assistant-ui cancel stops the simulation request", true);
}

module.exports = {
  checkChatResize,
  checkDemoSourceProgress,
  checkDemoCompletion,
  checkResultsSearch,
  checkExpandedResults,
  checkResultsMotionAndHistory,
  checkResponseActions,
  checkSpeechPlayback,
  checkMicrophoneEnergy,
  checkVoiceConversation,
};
