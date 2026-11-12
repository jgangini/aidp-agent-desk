const fs = require("node:fs");
const path = require("node:path");

async function prepareDevelopmentPage({
  context,
  errors,
  fixtureDir,
  fixtures,
  page,
  recordConsole,
}) {
  const priorPage = page;
  const developmentPage = await context.newPage();
  await developmentPage.emulateMedia({ reducedMotion: "no-preference" });
  developmentPage.on("pageerror", (e) => errors.push(String(e)));
  developmentPage.on("console", recordConsole);
  const developmentCommands = [];
  const postReferences = ["youtube", "youtube", "x", "x", "x"].map(
    (source, index) => ({
      evidence_id: `post-${index}`,
      source,
      source_title: `Publicación de prueba ${index + 1}`,
      author_name: "Fuente de prueba",
      text: `Contenido del post ${index + 1}\nSegunda línea del post`,
      published_at: "2026-11-09T12:00:00Z",
      url: `https://social.example.org/posts/${index}`,
      media:
        index === 3
          ? []
          : [
              {
                kind: "image",
                delivery: "direct",
                role: "thumbnail",
                url: `https://images.example.org/preview-${index}.svg`,
              },
            ],
    }),
  );
  postReferences.push(
    ...Array.from({ length: 50 }, (_, index) => ({
      evidence_id: `extra-${index}`,
      source: "youtube",
      source_title: `Post adicional ${index + 1}`,
      author_name: "Fuente de prueba",
      published_at: "2026-11-09T12:00:00Z",
      url: `https://social.example.org/extra/${index}`,
      media: [],
    })),
  );
  const sourceSummary =
    "Primera observación de @Usuario de la fuente.\n\nSegunda observación con su alcance.\n\n".repeat(
      12,
    );
  postReferences[0].media.unshift({
    kind: "video",
    delivery: "direct",
    role: "attachment",
    url: "https://media.example.org/post-video.webm",
  });
  postReferences.push({
    evidence_id: "comment-recovered",
    source: "youtube",
    content_basis: "comment_text",
    requested_url: postReferences[0].url,
    url: "https://social.example.org/comment/first",
    author_name: "Lector de prueba",
    text: "Comentario recuperado de la fuente. ".repeat(100),
    published_at: "2026-11-09T13:00:00Z",
    media: [],
  });
  fixtures.postVideoRequests = 0;
  await developmentPage.route(
    "https://media.example.org/post-video.webm",
    (route) => {
      fixtures.postVideoRequests++;
      return route.fulfill({
        contentType: "video/webm",
        body: fs.readFileSync(path.join(fixtureDir, "post-video.webm")),
      });
    },
  );
  const sourceCounts = {
    artifact_id: "source-counts",
    kind: "bar",
    title: "Registros citados por fuente",
    rows: [
      { source: "x", value: 3 },
      { source: "youtube", value: 53 },
    ],
    evidence_ids: postReferences.map((post) => post.evidence_id),
    caption: "Enlaces únicos; muestra de prueba.",
  };
  await developmentPage.route("https://images.example.org/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: route.request().url().endsWith("preview-2.svg")
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#555"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#555"/></svg>',
    }),
  );
  fixtures.releaseDevelopmentStream = undefined;
  await developmentPage.addInitScript(() => {
    const timeUniforms = new WeakSet();
    const prototype = WebGL2RenderingContext.prototype;
    const locate = prototype.getUniformLocation;
    prototype.getUniformLocation = function (program, name) {
      const location = locate.call(this, program, name);
      if (location && name === "uTime") timeUniforms.add(location);
      return location;
    };
    const update = prototype.uniform1f;
    prototype.uniform1f = function (location, value) {
      if (location && timeUniforms.has(location)) window.__deskLiveTime = value;
      return update.call(this, location, value);
    };
  });
  await developmentPage.route("**/api/desk/profiles", (route) =>
    route.fulfill({
      json: [
        {
          ...fixtures.qaProfile,
          name: "QA development",
          surface: "TEST",
          instance_id: "platform",
          workspace_id: "workspace",
        },
      ],
    }),
  );
  await developmentPage.route("**/api/desk/suggestions/*", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await developmentPage.route(
    "**/api/desk/stream",
    (route) =>
      new Promise((resolve) => {
        const command = route.request().postDataJSON();
        developmentCommands.push(command);
        if (command.question === "Error controlado") {
          route
            .fulfill({
              contentType: "application/x-ndjson",
              body:
                JSON.stringify({
                  kind: "transport_error",
                  request_id: command.request_id,
                  message: "Texto no válido",
                }) + "\n",
            })
            .then(resolve);
          return;
        }
        fixtures.releaseDevelopmentStream = async () => {
          await route.fulfill({
            contentType: "application/x-ndjson",
            body:
              [
                {
                  protocol: "ai-market-intelligence",
                  version: "2.0",
                  kind: "event",
                  event: {
                    event_id: "coverage-without-block",
                    sequence: 1,
                    turn_id: command.request_id,
                    type: "source.coverage",
                    block_id: null,
                    block_revision: 0,
                    source_key: "youtube",
                    text: "Consultando la fuente seleccionada",
                    evidence_ids: [],
                    status: "provisional",
                  },
                  references: [],
                  artifacts: [],
                },
                ...["youtube", "x"].map((source, index) => ({
                  protocol: "ai-market-intelligence",
                  version: "2.0",
                  kind: "event",
                  event: {
                    event_id: `source-${source}`,
                    sequence: index + 2,
                    turn_id: command.request_id,
                    type: "draft.upsert",
                    block_id: `source-${source}`,
                    source_key: source,
                    text: sourceSummary,
                    evidence_ids: postReferences
                      .filter((post) => post.source === source)
                      .map((post) => post.evidence_id),
                    status: "provisional",
                  },
                  references: postReferences.filter(
                    (post) => post.source === source,
                  ),
                  artifacts: [],
                })),
                {
                  protocol: "ai-market-intelligence",
                  version: "2.0",
                  kind: "event",
                  event: {
                    event_id: "chart",
                    sequence: 4,
                    turn_id: command.request_id,
                    type: "artifact.upsert",
                    block_id: null,
                    evidence_ids: [],
                  },
                  references: [],
                  artifacts: [sourceCounts],
                },
                {
                  protocol: "ai-market-intelligence",
                  version: "2.0",
                  kind: "response",
                  request_id: command.request_id,
                  response: {
                    status: "completed",
                    markdown: "Respuesta del TEST de desarrollo",
                    references: postReferences,
                    artifacts: [sourceCounts],
                  },
                },
              ]
                .map((packet) => JSON.stringify(packet))
                .join("\n") + "\n",
          });
          resolve();
        };
      }),
  );
  await developmentPage.goto("http://127.0.0.1:8317/");
  await developmentPage
    .getByRole("combobox", { name: "Elegir agente", exact: true })
    .filter({ hasText: "QA development (TEST)" })
    .click();
  await developmentPage
    .getByRole("option", { name: "QA development (TEST)", exact: true })
    .click();
  const developmentInput = developmentPage.getByRole("textbox", {
    name: "Mensaje al agente",
    exact: true,
  });
  await developmentInput.fill("Consulta de desarrollo");
  return {
    priorPage,
    developmentPage,
    developmentCommands,
    postReferences,
    sourceSummary,
    developmentInput,
  };
}

async function checkDevelopmentInvocation({
  check,
  developmentCommands,
  developmentInput,
  developmentPage,
  fixtures,
}) {
  for (const name of ["Demostración local", "QA development (TEST)"]) {
    await developmentPage
      .getByRole("combobox", { name: "Elegir agente", exact: true })
      .click();
    await developmentPage.getByRole("option", { name, exact: true }).click();
    await developmentPage.waitForFunction(() => {
      const title = document.querySelector(".aui-thread-welcome-root h3");
      const composer = document.querySelector(".aui-composer-root");
      return (
        title &&
        composer &&
        getComputedStyle(title).visibility === "visible" &&
        Number(getComputedStyle(title).opacity) === 1 &&
        Number(getComputedStyle(composer, "::before").opacity) === 1
      );
    });
    check(
      `switching an empty chat to ${name} preserves its draft, welcome and colored background`,
      (await developmentInput.inputValue()) === "Consulta de desarrollo" &&
        developmentCommands.length === 0,
    );
  }
  await developmentInput.press("Enter");
  await developmentPage.getByText("thinking", { exact: true }).waitFor();
  await developmentPage.waitForFunction(
    () => typeof window.__deskLiveTime === "number",
  );
  const liveTime = await developmentPage.evaluate(() => window.__deskLiveTime);
  await developmentPage.waitForFunction(
    (before) => window.__deskLiveTime > before + 0.3,
    liveTime,
  );
  check(
    "the real particle shader keeps moving during TEST thinking without receiving any agent packets",
    await developmentPage.getByText("thinking", { exact: true }).isVisible(),
  );
  await fixtures.releaseDevelopmentStream();
  await developmentPage
    .getByText("Respuesta del TEST de desarrollo", { exact: true })
    .waitFor();
  check(
    "an unpublished TEST agent can be selected and its actual streamed response displayed",
    developmentCommands.length === 1 &&
      developmentCommands[0].surface === "TEST" &&
      developmentCommands[0].profile_id === fixtures.qaProfileId &&
      !!developmentCommands[0].session_id,
  );
  check(
    "development preferences retain TEST rather than silently selecting production",
    await developmentPage.evaluate(
      (id) =>
        localStorage.getItem("agent-desk.selected-profile") === `test:${id}`,
      fixtures.qaProfileId,
    ),
  );
}

async function checkDevelopmentPersistenceAndFailure({
  check,
  developmentCommands,
  developmentInput,
  developmentPage,
}) {
  const restoredChatId = developmentCommands[0].session_id;
  await developmentPage.evaluate(() =>
    localStorage.setItem("agent-desk.selected-profile", "demo"),
  );
  await developmentPage.reload();
  await developmentPage
    .getByText("Respuesta del TEST de desarrollo", { exact: true })
    .waitFor();
  check(
    "reload restores the selected TEST chat, draft and source results without sending a request",
    (await developmentInput.inputValue()) ===
      "Borrador que sobrevive la recarga" &&
      (await developmentPage.locator(".finding").count()) === 3 &&
      (await developmentPage
        .getByRole("combobox", { name: "Elegir agente", exact: true })
        .textContent()
        .then((text) => text.includes("QA development (TEST)"))) &&
      developmentCommands.length === 1 &&
      (await developmentPage
        .getByRole("button", { name: "Mostrar animación", exact: true })
        .isVisible()) &&
      (await developmentPage.evaluate(
        (id) =>
          JSON.parse(sessionStorage.getItem("agent-desk.chats")).data
            .selected === id,
        restoredChatId,
      )),
  );
  await developmentInput.fill("Error controlado");
  await developmentInput.press("Enter");
  const errorNotice = developmentPage.getByRole("alert");
  await errorNotice.waitFor();
  check(
    "transport errors use a red framed alert above the composer rather than plain text below it",
    await errorNotice.evaluate(
      (notice) =>
        notice.textContent.includes("Texto no válido") &&
        notice.nextElementSibling?.matches(".aui-composer-root") &&
        notice.getBoundingClientRect().bottom <=
          notice.nextElementSibling.getBoundingClientRect().top &&
        getComputedStyle(notice).color === "rgb(255, 143, 126)" &&
        !!notice.querySelector("svg"),
    ),
  );
}

async function checkHistoricalResponseActions({
  check,
  developmentPage,
  priorPage,
}) {
  const olderMessage = developmentPage
    .locator(".aui-assistant-message")
    .first();
  const olderBar = olderMessage.locator(".aui-action-bar");
  await developmentPage.evaluate(() => document.fonts.ready);
  await olderMessage.scrollIntoViewIfNeeded();
  await developmentPage.mouse.move(0, 0);
  await developmentPage.waitForFunction(
    () =>
      getComputedStyle(
        document.querySelector(".aui-action-bar[data-open=false]"),
      ).opacity === "0",
  );
  const olderHeight = await olderMessage.evaluate(
    (node) => node.getBoundingClientRect().height,
  );
  await olderMessage.locator(".answer-text").hover();
  await developmentPage.waitForFunction(() => {
    const opacity = Number(
      getComputedStyle(
        document.querySelector(".aui-action-bar[data-open=false]"),
      ).opacity,
    );
    return (
      opacity > 0 &&
      opacity < 1 &&
      document
        .querySelector(".aui-action-bar[data-open=false]")
        .parentElement.matches(":hover")
    );
  });
  const hoverMetrics = await olderBar.evaluate(
    (node, before) => ({
      before,
      after: node.parentElement.getBoundingClientRect().height,
      duration: getComputedStyle(node).transitionDuration,
      hover: node.parentElement.matches(":hover"),
    }),
    olderHeight,
  );
  check(
    "older response actions fade and slide smoothly without shifting message layout",
    hoverMetrics.duration.includes("0.4s") &&
      Math.abs(hoverMetrics.after - hoverMetrics.before) < 1,
    hoverMetrics,
  );
  await developmentPage.emulateMedia({ reducedMotion: "reduce" });
  await developmentPage.mouse.move(0, 0);
  await olderMessage.focus();
  check(
    "response actions remain keyboard accessible and respect reduced motion",
    await olderBar.evaluate(
      (node) =>
        getComputedStyle(node).visibility === "visible" &&
        getComputedStyle(node).transitionDuration === "0s",
    ),
  );
  await developmentPage.close();
  await priorPage.close();
}

module.exports = {
  prepareDevelopmentPage,
  checkDevelopmentInvocation,
  checkDevelopmentPersistenceAndFailure,
  checkHistoricalResponseActions,
};
