const assert = require("node:assert/strict");

async function checkPublicationNavigation({ check, developmentPage }) {
  const youtubePosts = developmentPage.locator(
    ".finding-youtube .source-post-carousel",
  );
  check(
    "many carousel dots stay in a bounded scroll area rather than clipping controls",
    await youtubePosts
      .locator(".source-post-dots")
      .evaluate(
        (node) =>
          node.clientHeight <= 48 &&
          node.scrollHeight > node.clientHeight &&
          getComputedStyle(node).overflowY === "auto",
      ),
  );
  await youtubePosts
    .getByRole("button", { name: "Ver publicación 1", exact: true })
    .press("End");
  await youtubePosts
    .getByRole("button", { name: "Ver publicación 52", exact: true })
    .press("Home");
  await youtubePosts
    .getByRole("button", { name: "Ver publicación 2", exact: true })
    .click();
  await youtubePosts
    .locator(".source-post-preview > img")
    .evaluate((image) => image.decode());
  check(
    "post carousels show one real image preview and let dots select a different publication",
    (await youtubePosts.locator(".source-post-preview > img").count()) === 1 &&
      (
        await youtubePosts
          .locator(".source-post-preview > img")
          .getAttribute("src")
      ).endsWith("preview-1.svg") &&
      (await youtubePosts
        .getByRole("button", { name: "Ver publicación 2", exact: true })
        .getAttribute("aria-current")) === "true",
  );
  await youtubePosts
    .getByRole("button", { name: "Ver publicación 2", exact: true })
    .press("ArrowLeft");
  check(
    "carousel keyboard navigation returns to the first post with canonical metadata",
    (await youtubePosts
      .locator(".source-post-caption strong")
      .textContent()) === "Fuente de prueba" &&
      (await youtubePosts
        .getByRole("button", { name: "Ver publicación 1", exact: true })
        .getAttribute("aria-current")) === "true",
  );
  await developmentPage
    .locator(".finding-x")
    .getByRole("button", { name: "Ver publicación 2", exact: true })
    .click();
  check(
    "a post without an image shows its author and text below the date without a placeholder",
    (await developmentPage
      .locator(
        ".finding-x .source-post-preview img,.finding-x .source-post-placeholder",
      )
      .count()) === 0 &&
      (await developmentPage
        .locator(".finding-x .source-post-caption strong")
        .textContent()) === "Fuente de prueba" &&
      (await developmentPage
        .locator(".finding-x .source-post-caption time + .source-post-text")
        .evaluate(
          (node) =>
            node.textContent ===
              "Contenido del post 4\nSegunda línea del post" &&
            getComputedStyle(node).whiteSpace === "pre-wrap",
        )),
  );
  return { youtubePosts };
}

async function checkPublicationImageMotion({ check, developmentPage }) {
  await developmentPage.evaluate(() => {
    const stage = document.querySelector(".finding-x .source-post-stage");
    window.__postMotionBefore = stage.getBoundingClientRect().height;
    window.__postMotionSamples = [];
    window.__samplePostMotion = true;
    const sample = () => {
      const stage = document.querySelector(".finding-x .source-post-stage");
      const link = stage.querySelector("a");
      window.__postMotionSamples.push({
        height: stage.getBoundingClientRect().height,
        opacity: Number(getComputedStyle(link).opacity),
        transform: getComputedStyle(link).transform,
        filter: getComputedStyle(link).filter,
        pinnedHeight: stage.style.height,
        image: (() => {
          const img = link.querySelector("img");
          if (!img || !img.complete || !img.naturalWidth) return null;
          const rect = img.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            ratio: img.naturalHeight / img.naturalWidth,
          };
        })(),
      });
      if (window.__samplePostMotion) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await developmentPage
    .locator(".finding-x")
    .getByRole("button", { name: "Ver publicación 1", exact: true })
    .click();
  await developmentPage
    .locator(".finding-x .source-post-preview img")
    .evaluate((image) => image.decode());
  await developmentPage.waitForFunction(
    () =>
      !document.querySelector(".finding-x .source-post-stage").dataset
        .postTransition,
  );
  await developmentPage.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const carouselMotion = await developmentPage.evaluate(() => {
    window.__samplePostMotion = false;
    return {
      before: window.__postMotionBefore,
      after: document
        .querySelector(".finding-x .source-post-stage")
        .getBoundingClientRect().height,
      samples: window.__postMotionSamples,
    };
  });
  check(
    "changing publications is immediate without fading, stretching, sliding, blurring or pinning the carousel",
    carouselMotion.samples.every(
      (frame) =>
        frame.opacity === 1 &&
        frame.transform === "none" &&
        frame.filter === "none" &&
        frame.pinnedHeight === "" &&
        (!frame.image ||
          Math.abs(frame.image.height - frame.image.width * frame.image.ratio) <
            2),
    ) && carouselMotion.samples.some((frame) => frame.image),
  );
  check(
    "portrait images scale their height from width without a square crop",
    await developmentPage
      .locator(".finding-x .source-post-preview img")
      .evaluate((image) => {
        const rect = image.getBoundingClientRect();
        return (
          image.naturalHeight > image.naturalWidth &&
          rect.height > rect.width &&
          Math.abs(
            rect.height -
              (rect.width * image.naturalHeight) / image.naturalWidth,
          ) < 2
        );
      }),
  );
}

async function checkRapidPublicationSelection({
  check,
  developmentPage,
  postReferences,
  youtubePosts,
}) {
  await developmentPage.evaluate(() => {
    const dots = document.querySelectorAll(
      ".finding-youtube .source-post-dots button",
    );
    dots[1].click();
    dots[0].click();
    dots[1].click();
  });
  await developmentPage.waitForFunction(
    () =>
      !document.querySelector(".finding-youtube .source-post-stage").dataset
        .postTransition,
  );
  check(
    "rapid carousel selection settles on the latest post without duplicate links or leftover styles",
    (await youtubePosts.locator(".source-post-preview").count()) === 1 &&
      (await youtubePosts
        .locator(".source-post-preview")
        .getAttribute("href")) === postReferences[1].url &&
      (await youtubePosts
        .locator(".source-post-stage")
        .evaluate(
          (stage) =>
            stage.style.height === "" &&
            stage.querySelector("a").style.transform === "",
        )),
  );
  await developmentPage.emulateMedia({ reducedMotion: "reduce" });
  await youtubePosts
    .getByRole("button", { name: "Ver publicación 1", exact: true })
    .click();
  check(
    "reduced motion changes carousel publications immediately",
    (await youtubePosts
      .locator(".source-post-stage")
      .getAttribute("data-post-transition")) === null &&
      (await youtubePosts
        .locator(".source-post-preview")
        .evaluate(
          (link) => link.style.opacity === "" && link.style.transform === "",
        )),
  );
  await developmentPage.emulateMedia({ reducedMotion: "no-preference" });
}

async function checkPublicationLinks({
  check,
  context,
  developmentPage,
  fixtures,
  postReferences,
  youtubePosts,
}) {
  await context.route("https://social.example.org/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Publicación original de prueba</title><p>Origen de prueba</p>",
    }),
  );
  const [postPage] = await Promise.all([
    developmentPage.waitForEvent("popup"),
    youtubePosts.locator(".source-post-preview").click(),
  ]);
  await postPage.waitForLoadState();
  check(
    "the entire publication card opens the original in a new tab without a popup dialog or video request",
    postPage.url() === postReferences[0].url &&
      (await postPage.evaluate(() => window.opener === null)) &&
      (await developmentPage.locator(".source-post-dialog,video").count()) ===
        0 &&
      fixtures.postVideoRequests === 0 &&
      (await youtubePosts
        .locator(".source-post-preview")
        .getAttribute("rel")) === "noopener noreferrer",
  );
  await postPage.close();
  check(
    "publication previews omit the redundant open label and keep the intrinsic image proportion",
    (await youtubePosts.locator(".source-post-open").count()) === 0 &&
      (await youtubePosts
        .locator(".source-post-preview img")
        .evaluate((image) => {
          const rect = image.getBoundingClientRect();
          return (
            image.naturalWidth > 0 &&
            Math.abs(
              rect.height -
                (rect.width * image.naturalHeight) / image.naturalWidth,
            ) < 2
          );
        })),
  );
  check(
    "recovered comments do not become duplicate carousel slides",
    (await youtubePosts
      .getByRole("button", { name: "Ver publicación 52", exact: true })
      .count()) === 1 &&
      (await youtubePosts
        .getByRole("button", { name: "Ver publicación 53", exact: true })
        .count()) === 0,
  );
  await youtubePosts.locator(".source-post-preview").hover();
  await developmentPage.waitForTimeout(500);
  check(
    "publication previews do not show tooltips",
    (await developmentPage.getByRole("tooltip").count()) === 0 &&
      (await youtubePosts
        .locator(".source-post-preview")
        .getAttribute("data-tooltip-disabled")) === "true",
  );
  await youtubePosts
    .getByRole("button", { name: "Ver publicación 1", exact: true })
    .hover();
  await developmentPage.waitForTimeout(500);
  check(
    "carousel dots do not show tooltips",
    (await developmentPage.getByRole("tooltip").count()) === 0 &&
      (await youtubePosts
        .locator(".source-post-dots")
        .getAttribute("data-tooltip-disabled")) === "true",
  );
  check(
    "source names are not repeated as result headings",
    (await developmentPage
      .locator(".finding-youtube h2,.finding-x h2")
      .count()) === 0,
  );
}

async function checkSourceArtifactsAndLayout({
  check,
  developmentPage,
  sourceSummary,
}) {
  const plot = developmentPage.locator(".finding-analysis");
  check(
    "artifact cards display an actual bar chart without repeating publication references",
    (await plot.locator(".agent-bar-row").count()) === 2 &&
      (await plot.locator(".source-posts").count()) === 0 &&
      (await plot
        .getByRole("table", {
          name: "Registros citados por fuente",
          exact: true,
        })
        .getAttribute("class")) === "sr-only",
  );
  check(
    "source result cards clamp long summaries while leaving the natural-ratio carousel fully visible",
    await developmentPage.locator(".finding-youtube").evaluate((card) => {
      const summary = card.querySelector(".finding-summary");
      const post = card.querySelector(".source-post-text");
      return (
        card.getBoundingClientRect().height > 0 &&
        summary.scrollHeight > summary.clientHeight &&
        getComputedStyle(summary).webkitLineClamp === "6" &&
        getComputedStyle(post).webkitLineClamp === "3" &&
        card.querySelector("footer").getBoundingClientRect().bottom <=
          card.getBoundingClientRect().bottom
      );
    }),
  );
  await developmentPage.locator(".tool-progress summary").click();
  check(
    "source summaries keep their incoming paragraph breaks in both results and streamed chat activity",
    (await developmentPage
      .locator(".finding-youtube .finding-summary")
      .evaluate(
        (node, text) =>
          node.textContent === text &&
          getComputedStyle(node).whiteSpace === "pre-wrap",
        sourceSummary,
      )) &&
      (await developmentPage
        .locator(".tool-progress .t-stream")
        .first()
        .evaluate(
          (node, text) =>
            node.textContent === text &&
            getComputedStyle(node).whiteSpace === "pre-wrap",
          sourceSummary,
        )),
  );
  await developmentPage
    .getByRole("button", { name: "Ampliar resultados", exact: true })
    .click();
  await developmentPage.waitForFunction(
    () =>
      document.querySelector(".workspace").dataset.resultsExpanded === "true",
  );
  const compactBoard = async () => {
    await developmentPage.waitForFunction(() => {
      const cards = [...document.querySelectorAll(".finding")].map((card) =>
        card.getBoundingClientRect(),
      );
      if (cards.length !== 3) return false;
      const previous = cards[0].bottom < cards[1].bottom ? cards[0] : cards[1];
      return (
        Math.abs(cards[2].left - previous.left) < 2 &&
        Math.abs(cards[2].top - previous.bottom - 12) < 2
      );
    });
  };
  await compactBoard();
  check(
    "expanded results pack the next article directly under the shorter card",
    true,
  );
  return { compactBoard };
}

async function checkSummaryExpansion({ check, compactBoard, developmentPage }) {
  const sourceCard = developmentPage.locator(".finding-x");
  const sourceSummaryButton = sourceCard.locator(".finding-summary");
  const collapsedHeight = await sourceCard.evaluate(
    (card) => card.getBoundingClientRect().height,
  );
  const collapsedPostTop = await sourceCard
    .locator(".source-post-carousel")
    .evaluate((node) => node.offsetTop);

  await sourceSummaryButton.hover();
  await developmentPage.waitForTimeout(500);
  check(
    "summary text keeps its accessible name but does not show a tooltip",
    (await developmentPage.getByRole("tooltip").count()) === 0 &&
      (await sourceSummaryButton.getAttribute("data-tooltip-disabled")) ===
        "true" &&
      (await sourceSummaryButton.getAttribute("aria-label")) === null,
  );
  check(
    "hover does not paint a rectangle over the summary",
    await sourceSummaryButton.evaluate(
      (node) => getComputedStyle(node).backgroundColor === "rgba(0, 0, 0, 0)",
    ),
  );
  await developmentPage.evaluate(() => {
    window.__resultResizeSamples = [];
    window.__sampleResultResize = true;
    const sample = () => {
      const card = document.querySelector(".finding-x");
      window.__resultResizeSamples.push({
        height: card.getBoundingClientRect().height,
        top: card.querySelector(".source-post-carousel").offsetTop,
        resizing: card.dataset.resizing,
      });
      if (window.__sampleResultResize) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await sourceSummaryButton.click();
  await developmentPage.waitForFunction(() => {
    const card = document.querySelector(".finding-x");
    const summary = card.querySelector(".finding-summary");
    return (
      card.dataset.expanded === "true" &&
      !card.dataset.resizing &&
      summary.scrollHeight <= summary.clientHeight + 1
    );
  });
  await compactBoard();
  const expandedPostTop = await sourceCard
    .locator(".source-post-carousel")
    .evaluate((node) => node.offsetTop);
  const resizeSamples = await developmentPage.evaluate(() => {
    window.__sampleResultResize = false;
    return window.__resultResizeSamples;
  });
  const intermediateResize = resizeSamples.filter(
    (frame) =>
      frame.resizing === "true" &&
      frame.height > collapsedHeight + 1 &&
      frame.top > collapsedPostTop &&
      frame.top < expandedPostTop,
  );
  assert.ok(
    intermediateResize.length > 0,
    `Missing intermediate carousel positions: ${JSON.stringify({ collapsedHeight, collapsedPostTop, expandedPostTop, samples: resizeSamples.slice(0, 8) })}`,
  );
  check(
    "carousel follows the summary through an intermediate position without jumping to its final layout",
    true,
  );
  check(
    "summary expansion animates through an intermediate height before settling",
    await sourceCard.evaluate(
      (card, before) => card.getBoundingClientRect().height > before + 1,
      intermediateResize[0].height,
    ),
  );
  check(
    "clicking a summary expands the card to show its complete text and repacks following articles",
    (await sourceSummaryButton.getAttribute("aria-expanded")) === "true" &&
      (await sourceCard.evaluate(
        (card, before) => card.getBoundingClientRect().height > before + 100,
        collapsedHeight,
      )),
  );
  await sourceCard
    .getByRole("button", { name: "Ver publicación 1", exact: true })
    .click();
  check(
    "carousel controls do not fold an expanded summary",
    (await sourceSummaryButton.getAttribute("aria-expanded")) === "true",
  );
  return { sourceCard, sourceSummaryButton };
}

async function checkSummaryFolding({
  check,
  compactBoard,
  developmentPage,
  sourceCard,
  sourceSummaryButton,
}) {
  const beforeFoldHeight = await sourceCard.evaluate(
    (card) => card.getBoundingClientRect().height,
  );
  await sourceSummaryButton.press("Space");
  await developmentPage.waitForFunction(() => {
    const card = document.querySelector(".finding-x");
    return card.dataset.expanded === "false" && !card.dataset.resizing;
  });
  await compactBoard();
  check(
    "keyboard activation folds the text and compacts the board again",
    (await sourceCard.evaluate(
      (card, height) =>
        card.getBoundingClientRect().height < height - 100 &&
        card.querySelector("footer").getBoundingClientRect().bottom <=
          card.getBoundingClientRect().bottom,
      beforeFoldHeight,
    )) &&
      (await sourceSummaryButton.evaluate(
        (summary) => summary.scrollHeight > summary.clientHeight,
      )),
  );
  await developmentPage.emulateMedia({ reducedMotion: "reduce" });
  await sourceSummaryButton.press("Enter");
  check(
    "reduced motion expands summaries immediately without layout animation",
    (await sourceSummaryButton.getAttribute("aria-expanded")) === "true" &&
      (await sourceCard.getAttribute("data-resizing")) === null,
  );
  await sourceSummaryButton.press("Enter");
  await compactBoard();
  await developmentPage.emulateMedia({ reducedMotion: "no-preference" });
}

async function checkSearchExpansion({ check, developmentPage }) {
  const resultFilter = developmentPage.getByRole("textbox", {
    name: "Filtrar resultados",
    exact: true,
  });
  await resultFilter.fill("observacion");
  check(
    "filter highlights original accented text in blue as results update",
    (await developmentPage.locator(".finding").count()) === 2 &&
      (await developmentPage
        .locator("mark.result-match")
        .first()
        .textContent()) === "observación" &&
      (await developmentPage
        .locator("mark.result-match")
        .first()
        .evaluate(
          (node) =>
            getComputedStyle(node).backgroundColor === "rgb(49, 95, 128)",
        )),
  );
  await developmentPage.waitForFunction(() =>
    [...document.querySelectorAll(".finding:not(.finding-analysis)")].every(
      (card) =>
        card.dataset.expanded === "true" &&
        !card.dataset.resizing &&
        card.querySelector(".finding-summary").scrollHeight <=
          card.querySelector(".finding-summary").clientHeight + 1,
    ),
  );
  check(
    "search expands matched summaries so highlights cannot stay hidden by the line clamp",
    await developmentPage
      .locator(".finding-x .finding-summary")
      .evaluate((summary) => {
        const mark = summary.querySelector("mark");
        return (
          summary.getAttribute("aria-expanded") === "true" &&
          mark.getBoundingClientRect().bottom <=
            summary.getBoundingClientRect().bottom + 1
        );
      }),
  );
  await developmentPage
    .locator(".finding-x .finding-summary")
    .evaluate((node) => node.click());
  await developmentPage.waitForFunction(
    () =>
      document.querySelector(".finding-x").dataset.expanded === "false" &&
      !document.querySelector(".finding-x").dataset.resizing,
  );
  await resultFilter.fill("observacion de @usuario");
  await developmentPage.waitForFunction(() => {
    const card = document.querySelector(".finding-x");
    return (
      card.dataset.expanded === "true" &&
      !card.dataset.resizing &&
      card.style.transform === "" &&
      card.style.height === ""
    );
  });
  check(
    "a new search restores matching text while cancelled transitions leave no stale layout",
    await developmentPage
      .locator(".finding-x .finding-summary")
      .evaluate(
        (node) =>
          node.style.height === "" &&
          node.scrollHeight <= node.clientHeight + 1,
      ),
  );
  return { resultFilter };
}

async function checkRepeatedSearch({
  check,
  compactBoard,
  developmentPage,
  resultFilter,
  sourceSummaryButton,
}) {
  await resultFilter.fill("");
  await compactBoard();
  check(
    "clearing search restores summaries that were previously folded",
    (await sourceSummaryButton.getAttribute("aria-expanded")) === "false",
  );
  await resultFilter.fill("observacion");
  await developmentPage.waitForFunction(
    () =>
      document.querySelector(".finding-x").dataset.expanded === "true" &&
      !document.querySelector(".finding-x").dataset.resizing,
  );
  await sourceSummaryButton.evaluate((node) => node.click());
  await developmentPage.waitForFunction(
    () =>
      document.querySelector(".finding-x").dataset.expanded === "false" &&
      !document.querySelector(".finding-x").dataset.resizing,
  );
  await resultFilter.fill("");
  await resultFilter.fill("observacion");
  await developmentPage.waitForFunction(
    () =>
      document.querySelector(".finding-x").dataset.expanded === "true" &&
      !document.querySelector(".finding-x").dataset.resizing,
  );
  check(
    "repeating a cleared search reveals its matches even after manual folding",
    (await sourceSummaryButton.getAttribute("aria-expanded")) === "true",
  );
  await resultFilter.fill("");
  await compactBoard();

  check(
    "result mentions use the same rounded gray treatment as chat",
    (await developmentPage
      .locator(".finding-summary .user-mention")
      .first()
      .textContent()) === "@Usuario" &&
      (await developmentPage
        .locator(".finding-summary .user-mention")
        .first()
        .evaluate((node) => getComputedStyle(node).borderRadius === "5px")),
  );
}

async function checkScheduledEntryAndBottomPicker({
  check,
  developmentInput,
  developmentPage,
}) {
  await developmentPage.locator(".tool-progress summary").hover();
  await developmentPage.waitForTimeout(500);
  check(
    "duration summary has neither a custom tooltip nor native title",
    (await developmentPage.getByRole("tooltip").count()) === 0 &&
      (await developmentPage
        .locator(".tool-progress summary")
        .getAttribute("data-tooltip-disabled")) === "true" &&
      (await developmentPage.locator(".tool-progress [title]").count()) === 0,
  );
  await developmentPage.evaluate(() => {
    window.__scheduledResultBefore = document.querySelector(".finding");
    window.__scheduledScrollBefore =
      document.querySelector(".findings").scrollTop;
    window.__scheduledEntranceSamples = [];
    window.__sampleScheduledEntrance = true;
    const sample = () => {
      const panel = document.querySelector("#scheduled-panel");
      if (panel)
        window.__scheduledEntranceSamples.push(
          Number(getComputedStyle(panel).opacity),
        );
      if (window.__sampleScheduledEntrance) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    document
      .querySelector('.chat-header button[aria-label="Tareas"]')
      .click();
  });
  await developmentPage.waitForFunction(
    () =>
      window.__scheduledEntranceSamples.some(
        (value) => value > 0 && value < 1,
      ) &&
      getComputedStyle(document.querySelector("#scheduled-panel")).opacity ===
        "1",
  );
  check(
    "Tareas enters gradually while keeping the existing result board and scroll untouched",
    await developmentPage.evaluate(() => {
      window.__sampleScheduledEntrance = false;
      return (
        document.querySelector(".finding") === window.__scheduledResultBefore &&
        document.querySelector(".findings").scrollTop ===
          window.__scheduledScrollBefore &&
        !document.querySelector(".scheduled-reports")
      );
    }),
  );
  await developmentPage
    .getByRole("button", { name: "Cerrar Tareas", exact: true })
    .click();
  const bottomAgentPicker = developmentPage.getByRole("combobox", {
    name: "Elegir agente",
    exact: true,
  });
  await bottomAgentPicker.click();
  await developmentPage.waitForFunction(() => {
    const menu = document.querySelector(".agent-picker-menu");
    const style = getComputedStyle(menu);
    return (
      style.opacity === "1" && new DOMMatrixReadOnly(style.transform).isIdentity
    );
  });
  check(
    "bottom composer agent picker opens above with all options visible and no unnecessary scrollbar",
    await developmentPage.locator(".agent-picker-menu").evaluate((menu) => {
      const rect = menu.getBoundingClientRect();
      const trigger = document
        .querySelector(".aui-agent-picker")
        .getBoundingClientRect();
      return (
        menu.dataset.placement === "above" &&
        rect.bottom <= trigger.top - 5 &&
        rect.top >= 0 &&
        menu.scrollHeight <= menu.clientHeight + 1
      );
    }),
  );
  await bottomAgentPicker.press("Escape");
  check(
    "completed responses retain plain duration text without a metrics popup",
    (await developmentPage.locator("details.response-timing").count()) === 0 &&
      (await developmentPage.locator("span.response-timing").count()) > 0,
  );

  await developmentInput.fill("Borrador que sobrevive la recarga");
}

module.exports = {
  checkPublicationNavigation,
  checkPublicationImageMotion,
  checkRapidPublicationSelection,
  checkPublicationLinks,
  checkSourceArtifactsAndLayout,
  checkSummaryExpansion,
  checkSummaryFolding,
  checkSearchExpansion,
  checkRepeatedSearch,
  checkScheduledEntryAndBottomPicker,
};
