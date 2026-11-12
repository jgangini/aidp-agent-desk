async function checkWelcomeConstruction({ check, page }) {
  await page.goto("http://127.0.0.1:8317");
  await page.locator("canvas").waitFor();
  await page.waitForFunction(() => window.__deskDraws > 0);
  check("WebGL draws the particle core", true);
  await page.locator(".t-gen").first().waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll(".t-gen").length === 1,
  );
  check(
    "composer halo stays hidden during construction",
    await page
      .locator(".aui-composer-root")
      .evaluate((form) => getComputedStyle(form, "::before").opacity === "0"),
  );
  check(
    "only the composer is constructed, with greeting and nine suggestions outside the effect",
    await page
      .locator('.aui-welcome-build[data-empty="true"]')
      .evaluate(
        (group) =>
          document.querySelectorAll(".t-gen").length === 1 &&
          group.dataset.build === "drawing" &&
          !!group.querySelector("h3") &&
          !!group.querySelector("textarea") &&
          group.querySelectorAll(".aui-thread-suggestions button").length === 9,
      ),
  );

  check(
    "composer draws a measured decorative wireframe with the original runtime",
    await page
      .locator(".t-gen")
      .nth(0)
      .evaluate(
        (layer) =>
          layer.getAttribute("aria-hidden") === "true" &&
          getComputedStyle(layer).pointerEvents === "none" &&
          layer.querySelectorAll("path").length > 5,
      ),
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".t-gen").length === 0,
  );
  check(
    "wireframe completion restores the real composer",
    await page
      .locator(".aui-welcome-build")
      .evaluate(
        (shell) =>
          shell.dataset.build === "ready" &&
          shell.style.opacity === "" &&
          shell.style.filter === "",
      ),
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector(".aui-composer-root"), "::before")
        .opacity === "1",
  );
  check("composer halo fades in after all construction blocks", true);
  check(
    "greeting rises after composer construction and suggestions stagger left to right",
    await page.locator(".aui-welcome-build").evaluate((group) => {
      const heading = getComputedStyle(group.querySelector("h3"));
      const buttons = [
        ...group.querySelectorAll(".aui-thread-suggestions button"),
      ].map((button) => getComputedStyle(button));
      return (
        group.dataset.reveal === "animated" &&
        heading.animationName === "welcome-text-in" &&
        buttons.every(
          (style, i) =>
            style.animationName === "welcome-suggestion-in" &&
            (!i ||
              parseFloat(style.animationDelay) >
                parseFloat(buttons[i - 1].animationDelay)),
        )
      );
    }),
  );
}

async function checkWelcomeTooltips({ check, page }) {
  await page.reload();
  await page.locator(".t-gen").first().waitFor();
  await page
    .getByRole("textbox", { name: "Mensaje al agente", exact: true })
    .press("Escape");
  check(
    "typing interrupts wireframe without a blocked or hidden field",
    (await page.locator(".t-gen").count()) === 0 &&
      (await page
        .locator(".aui-composer-shell")
        .evaluate((shell) => shell.style.opacity === "")),
  );

  check(
    "dictation button stays transparent and plus has rounded square corners",
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector(".dictation-button"))
          .backgroundColor === "rgba(0, 0, 0, 0)" &&
        getComputedStyle(document.querySelector(".chat-options.t-morph"))
          .borderRadius === "7px",
    ),
  );
  await page
    .getByRole("button", { name: "Hablar con el agente", exact: true })
    .focus();
  await page
    .getByRole("tooltip", { name: "Toca para hablar", exact: true })
    .waitFor();
  check(
    "voice hint uses a shared keyboard tooltip instead of fixed text",
    (await page.locator(".voice-dock-label").count()) === 0,
  );
  await page
    .getByRole("button", { name: "Hablar con el agente", exact: true })
    .press("Escape");
  await page.getByRole("tooltip").waitFor({ state: "hidden" });
  await page.locator(".aui-thread-suggestions button").first().focus();
  check(
    "suggestions do not show tooltips on keyboard focus",
    (await page.getByRole("tooltip").count()) === 0,
  );
  await page
    .getByRole("button", { name: "Configurar agentes", exact: true })
    .focus();
  await page
    .getByRole("tooltip", { name: "Configuración", exact: true })
    .waitFor();
  await page.keyboard.press("Escape");
  check("settings tooltip says Configuración", true);
  await page
    .getByRole("button", { name: "Dictar mensaje", exact: true })
    .focus();
  check(
    "composer actions have no custom or native tooltips",
    (await page.getByRole("tooltip").count()) === 0 &&
      (await page.locator(".aui-composer-actions [title]").count()) === 0,
  );
}

async function checkIdleBrand({ check, page }) {
  await page.setViewportSize({ width: 970, height: 1003 });
  check(
    "intermediate empty workspace fills height with canvas centered below the wordmark",
    await page.evaluate(() => {
      const rect = (selector) =>
        document.querySelector(selector).getBoundingClientRect();
      const workspace = rect(".workspace");
      const stage = rect(".network-stage");
      const brand = rect(".desk-wordmark");
      const canvas = rect(".brain-canvas");
      return (
        Math.abs(workspace.height - innerHeight) < 2 &&
        Math.abs(stage.bottom - workspace.bottom) < 2 &&
        !document.querySelector(".simulation-controls") &&
        Math.abs(canvas.top - brand.bottom) < 2 &&
        Math.abs(canvas.bottom - stage.bottom) < 2 &&
        Math.abs(
          (canvas.top + canvas.bottom) / 2 - (brand.bottom + stage.bottom) / 2,
        ) < 2
      );
    }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  check(
    "initial chat has nine suggestions",
    (await page.locator(".aui-thread-suggestions button").count()) === 9,
  );
  check(
    "menu trigger uses a plus SVG",
    (await page.locator(".t-morph-plus > svg.lucide-plus").count()) === 1,
  );
  check(
    "corner wordmark aligns to the shared header without a surface",
    await page.locator(".desk-wordmark").evaluate((brand) => {
      const bounds = brand.getBoundingClientRect();
      const stage = brand.closest(".network-stage").getBoundingClientRect();
      const text = brand.querySelector(".t-gradient-text");
      return (
        brand.textContent === "Agent Desk" &&
        bounds.x === stage.x + 20 &&
        bounds.y === stage.y &&
        bounds.height === 50 &&
        getComputedStyle(brand).backgroundColor === "rgba(0, 0, 0, 0)" &&
        getComputedStyle(text).animationName.includes("t-gradient-drift")
      );
    }),
  );
  check(
    "welcome uses the requested text reveal recipe",
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector(".t-stagger h3"))
          .animationName === "none",
    ),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(
    "reduced motion presents the brand and ready controls immediately",
    await page.evaluate(() =>
      [".t-gradient-text", ".t-stagger h3", ".aui-composer-shell"].every(
        (selector) =>
          getComputedStyle(document.querySelector(selector)).animationName ===
          "none",
      ),
    ),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

async function checkIdleWorkspace({ check, page }) {
  check(
    "voice control overlays the canvas below the wordmark without a bottom bar",
    await page.locator(".voice-dock").evaluate((dock) => {
      const rect = dock.getBoundingClientRect();
      const canvas = document
        .querySelector(".brain-canvas")
        .getBoundingClientRect();
      const stage = document
        .querySelector(".network-stage")
        .getBoundingClientRect();
      const brand = document
        .querySelector(".desk-wordmark")
        .getBoundingClientRect();
      return (
        Math.abs(canvas.top - brand.bottom) < 2 &&
        Math.abs(canvas.bottom - stage.bottom) < 2 &&
        rect.top < canvas.bottom &&
        rect.bottom <= stage.bottom &&
        !document.querySelector(".simulation-controls")
      );
    }),
  );

  check(
    "no tool icons are visible while the chat is idle",
    (await page.locator(".orbital-tool:visible").count()) === 0,
  );
  const bounds = await page.evaluate(() => ({
    results: document
      .querySelector(".activity-section")
      .getBoundingClientRect(),
    scene: document.querySelector(".network-stage").getBoundingClientRect(),
    chat: document.querySelector(".chat-panel").getBoundingClientRect().left,
    bg: getComputedStyle(document.querySelector(".chat-panel")).backgroundColor,
    header: document.querySelector(".chat-header").getBoundingClientRect()
      .height,
    suggestions: document
      .querySelector(".aui-thread-suggestions")
      .getBoundingClientRect().bottom,
    composer: document
      .querySelector(".aui-composer-root")
      .getBoundingClientRect(),
    spacer: document.querySelector(".aui-footer-spacer").getBoundingClientRect()
      .height,
    removed: document.querySelectorAll(
      ".app-header,.workspace-title,.stage-heading,.brain-caption,[role=tab]",
    ).length,
  }));
  check(
    "empty results stay folded and the scene uses their space",
    (await page.locator(".activity-section").isHidden()) &&
      (await page.locator(".stage-swap").count()) === 0 &&
      bounds.scene.right <= bounds.chat + 1 &&
      bounds.scene.right > bounds.chat - 2,
  );
  check("requested headers, labels and tabs are removed", bounds.removed === 0);
  check(
    "chat uses the near-black reference surface",
    bounds.bg === "rgb(13, 14, 16)",
  );
  check(
    "initial composer is centered below the heading with suggestions beneath it",
    bounds.header === 50 &&
      bounds.suggestions > bounds.composer.bottom &&
      bounds.composer.top > 250 &&
      bounds.composer.bottom < 750 &&
      bounds.spacer >= 15 &&
      !(await page
        .getByText("Simulación local · AIDP pendiente de publicación", {
          exact: true,
        })
        .count()),
  );
}

async function checkAgentPicker({ check, page }) {
  check(
    "SVG gear replaces expansion in the right-hand header",
    (await page
      .locator(
        '.chat-header button[aria-label="Configurar agentes"] svg.lucide-settings',
      )
      .count()) === 1 &&
      !(await page
        .getByRole("button", { name: "Ampliar chat", exact: true })
        .count()),
  );
  check(
    "Nuevo Chat title has no logo and configuration remains at the right edge",
    await page.locator(".chat-header").evaluate((header) => {
      const settings = header
        .querySelector(':scope > button[aria-label="Configurar agentes"]')
        .getBoundingClientRect();
      const box = header.getBoundingClientRect();
      return (
        header.querySelector("#chat-title").textContent === "Nuevo Chat" &&
        !header.querySelector(".aidp-icon") &&
        box.right - settings.right < 25
      );
    }),
  );
  await page.getByRole("combobox", { name: "Elegir agente" }).click();
  await page.waitForFunction(() => {
    const menu = document.querySelector(".agent-picker-menu");
    const trigger = document
      .querySelector(".aui-agent-picker")
      .getBoundingClientRect();
    return (
      menu.matches(":popover-open") &&
      Math.abs(menu.getBoundingClientRect().top - trigger.bottom - 6) < 1
    );
  });
  check(
    "agent picker floats downward in the top layer without clipping or moving the composer",
    await page.locator(".agent-picker-menu").evaluate((menu) => {
      const trigger = document
        .querySelector(".aui-agent-picker")
        .getBoundingClientRect();
      const rect = menu.getBoundingClientRect();
      return (
        menu.matches(":popover-open") &&
        getComputedStyle(menu).position === "fixed" &&
        Math.abs(rect.top - trigger.bottom - 6) < 2 &&
        Math.abs(rect.left - trigger.left) < 2 &&
        rect.right <= innerWidth &&
        rect.bottom <= innerHeight &&
        getComputedStyle(menu).overflowY === "auto"
      );
    }),
  );
  check(
    "composer agent picker opens a real dropdown without a plus button",
    (await page
      .getByRole("listbox", { name: "Agentes disponibles" })
      .isVisible()) &&
      (await page
        .getByRole("button", { name: "Configurar agente desde el chat" })
        .count()) === 0,
  );
  await page.getByRole("combobox", { name: "Elegir agente" }).press("Escape");
  await page.getByLabel("Opciones del chat", { exact: true }).press("Enter");
  check(
    "empty history starts a new chat directly with Enter",
    await page
      .locator(".chat-options")
      .evaluate(
        (menu) =>
          menu.dataset.open === "false" &&
          !menu.querySelector('[role="menu"]') &&
          document.activeElement?.id === "chat-input",
      ),
  );
  await page.getByLabel("Opciones del chat", { exact: true }).click();
  check(
    "empty history starts a new chat directly with click",
    await page
      .locator(".chat-options")
      .evaluate(
        (menu) =>
          menu.dataset.open === "false" &&
          document.activeElement?.id === "chat-input",
      ),
  );
  const normalTitleType = await page.locator("#chat-title").evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.fontSize, style.fontWeight, style.color, style.lineHeight];
  });
  return { normalTitleType };
}

async function checkConfigurationEntrance({ check, normalTitleType, page }) {
  await page
    .getByRole("button", { name: "Configurar agentes", exact: true })
    .click();
  await page.locator(".agent-config-inline").waitFor({ state: "attached" });
  check(
    "configuration shows its title with the chat heading style and hides the conversation menu",
    await page.locator(".chat-header").evaluate((header, expected) => {
      const title = header.querySelector("h2"),
        style = getComputedStyle(title);
      return (
        !title.hidden &&
        title.textContent === "Configuración" &&
        JSON.stringify([
          style.fontSize,
          style.fontWeight,
          style.color,
          style.lineHeight,
        ]) === JSON.stringify(expected) &&
        !header.querySelector(".chat-options-anchor") &&
        !!header.querySelector('button[aria-expanded="true"]')
      );
    }, normalTitleType),
  );
  await page.keyboard.press("Escape");
  check(
    "closing configuration blocks interaction during its exit",
    await page.locator(".agent-config-inline").evaluate((panel) => panel.inert),
  );
  check(
    "configuration exit stays clipped inside its panel",
    await page
      .locator(".chat-panel")
      .evaluate((panel) => getComputedStyle(panel).overflowY === "clip"),
  );
  await page.locator(".agent-config-inline").waitFor({ state: "detached" });
  check(
    "interrupting the configuration entrance restores focus to the gear",
    await page
      .getByRole("button", { name: "Configurar agentes", exact: true })
      .evaluate((button) => document.activeElement === button),
  );
  check(
    "closing configuration restores chat title and conversation menu",
    await page
      .locator(".chat-header")
      .evaluate(
        (header) =>
          !header.querySelector("h2").hidden &&
          !!header.querySelector(".chat-options-anchor"),
      ),
  );
}

async function checkResponsiveLayoutsAndContrast({ check, page }) {
  const layouts = [];
  for (const size of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
    { width: 768, height: 1024 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(size);
    check(
      `no page overflow at ${size.width}x${size.height}`,
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    check(
      `results have no horizontal scrolling at ${size.width}x${size.height}`,
      await page
        .locator(".activity-section")
        .evaluate((rail) => rail.scrollWidth <= rail.clientWidth + 1),
    );
    await page
      .getByRole("button", { name: "Configurar agentes", exact: true })
      .click();
    check(
      `settings remains accessible at ${size.width}x${size.height}`,
      await page
        .getByRole("region", { name: "Oracle AI Data Platform Agent Flows" })
        .isVisible(),
    );
    await page
      .getByRole("button", { name: "Cerrar configuración", exact: true })
      .click();
    await page.locator(".agent-config-inline").waitFor({ state: "detached" });
    layouts.push(size);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(
    "system reduced motion disables surface transitions without a manual toggle",
    await page
      .locator(".workspace")
      .evaluate(
        (node) =>
          matchMedia("(prefers-reduced-motion: reduce)").matches &&
          getComputedStyle(node).transitionDuration === "0s",
      ),
  );
  await page
    .getByRole("combobox", { name: "Elegir agente" })
    .press("ArrowDown");
  check(
    "reduced motion also disables dropdown transitions",
    await page
      .getByRole("listbox", { name: "Agentes disponibles" })
      .evaluate((menu) => getComputedStyle(menu).transitionDuration === "0s"),
  );
  await page.getByRole("combobox", { name: "Elegir agente" }).press("Escape");
  const contrast = await page.evaluate(() => {
    const rgb = (color) =>
      (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (values) =>
      values
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    return [
      ".results-search input",
      ".aui-agent-picker",
      "#chat-title",
      ".aui-thread-welcome-root h3",
      ".aui-thread-suggestions button",
    ].map((selector) => {
      const el = document.querySelector(selector);
      const a = lum(rgb(getComputedStyle(el).color));
      let parent = el;
      let bg;
      while (parent) {
        const value = getComputedStyle(parent).backgroundColor;
        if (value !== "rgba(0, 0, 0, 0)" && value !== "transparent") {
          bg = rgb(value);
          break;
        }
        parent = parent.parentElement;
      }
      const b = lum(bg || [11, 18, 36]);
      return {
        selector,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    });
  });
  check(
    "sampled normal text meets AA contrast",
    contrast.every((p) => p.ratio >= 4.5),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  return { layouts, contrast };
}

module.exports = {
  checkWelcomeConstruction,
  checkWelcomeTooltips,
  checkIdleBrand,
  checkIdleWorkspace,
  checkAgentPicker,
  checkConfigurationEntrance,
  checkResponsiveLayoutsAndContrast,
};
