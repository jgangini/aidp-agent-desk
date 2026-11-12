async function prepareStreamingPage({
  check,
  context,
  errors,
  fixtures,
  recordConsole,
  requests,
}) {
  const streamingPage = await context.newPage();
  streamingPage.on("pageerror", (e) => errors.push(String(e)));
  streamingPage.on("console", recordConsole);
  streamingPage.on("request", (r) => requests.add(r.url()));
  await streamingPage.route("**/api/desk/profiles", (route) =>
    route.fulfill({
      json: [
        {
          ...fixtures.qaProfile,
          name: "QA streaming",
          surface: "TEST",
          instance_id: "platform",
          workspace_id: "workspace",
        },
      ],
    }),
  );
  await streamingPage.route("**/api/desk/suggestions/*", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await streamingPage.addInitScript((id) => {
    localStorage.setItem("agent-desk.selected-profile", `test:${id}`);
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (
        String(input).endsWith("/api/desk/stream") &&
        init?.method === "POST"
      ) {
        const command = JSON.parse(init.body);
        const body = new ReadableStream({
          start(controller) {
            window.__controlledDeskStream = {
              command,
              send: (packet) =>
                controller.enqueue(
                  new TextEncoder().encode(JSON.stringify(packet) + "\n"),
                ),
              close: () => controller.close(),
            };
          },
        });
        return Promise.resolve(
          new Response(body, {
            headers: { "Content-Type": "application/x-ndjson" },
          }),
        );
      }
      return originalFetch(input, init);
    };
  }, fixtures.qaProfileId);
  await streamingPage.goto("http://127.0.0.1:8317/");
  await streamingPage
    .getByRole("textbox", { name: "Mensaje al agente", exact: true })
    .fill("Flujo incremental de prueba");
  await streamingPage
    .getByRole("textbox", { name: "Mensaje al agente", exact: true })
    .press("Enter");
  await streamingPage.waitForFunction(() => !!window.__controlledDeskStream);
  await streamingPage.evaluate(() => {
    const stream = window.__controlledDeskStream;
    stream.send({
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "event",
      event: {
        event_id: "live-progress",
        sequence: 1,
        turn_id: stream.command.request_id,
        type: "source.coverage",
        block_id: null,
        source_key: "web",
        text: "Consultando la fuente seleccionada",
        evidence_ids: [],
      },
      references: [],
      artifacts: [],
    });
  });
  await streamingPage
    .getByText("Consultando fuentes...", { exact: true })
    .waitFor();
  check(
    "public progress without a block is visible before the first result",
    (await streamingPage
      .locator('.tool-progress [data-tool-status="running"]')
      .count()) === 1 &&
      (await streamingPage.locator(".finding").count()) === 0,
  );
  return { streamingPage };
}

async function checkSourceTextStreaming({ check, streamingPage }) {
  const sendText = async (phase, index, text = "") =>
    streamingPage.evaluate(
      ({ phase, index, text }) => {
        const stream = window.__controlledDeskStream;
        stream.send({
          protocol: "ai-market-intelligence",
          version: "2.0",
          kind: "text",
          request_id: stream.command.request_id,
          turn_id: stream.command.request_id,
          stream_id: "a".repeat(32),
          block_id: "live-source",
          block_revision: 1,
          source_key: "web",
          source_keys: ["web"],
          status: "provisional",
          phase,
          delta_index: index,
          text,
        });
      },
      { phase, index, text },
    );
  await sendText("start", 0);
  await sendText("delta", 1, "Primer fragmento incremental");
  await streamingPage
    .locator(".tool-progress")
    .filter({ hasText: "Primer fragmento incremental" })
    .waitFor();
  check(
    "a genuine text delta is visible before generation ends",
    (await streamingPage
      .getByRole("button", { name: "Detener consulta", exact: true })
      .isVisible()) && (await streamingPage.locator(".finding").count()) === 0,
  );
  await sendText("delta", 2, " recibido desde el agente.");
  await streamingPage.waitForFunction(() =>
    document
      .querySelector(".tool-progress")
      ?.textContent.includes(
        "Primer fragmento incremental recibido desde el agente.",
      ),
  );
  await sendText("end", 3);
  check(
    "text fragments append without duplicating a provisional finding",
    (await streamingPage
      .locator(".tool-progress")
      .textContent()
      .then((text) =>
        text.includes("Primer fragmento incremental recibido desde el agente."),
      )) &&
      (await streamingPage
        .locator(".answer-text > .markdown-text")
        .allTextContents()
        .then((texts) => texts.every((text) => !text.trim()))) &&
      (await streamingPage.locator(".finding").count()) === 0,
  );
  await streamingPage.evaluate(() => {
    const stream = window.__controlledDeskStream;
    stream.send({
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "event",
      event: {
        event_id: "live-1",
        sequence: 2,
        turn_id: stream.command.request_id,
        type: "draft.upsert",
        block_id: "live-source",
        source_key: "web",
        text: "Primer resultado recibido. ".repeat(100),
        evidence_ids: [],
      },
      references: [],
      artifacts: [],
    });
  });
  await streamingPage
    .locator(".finding")
    .filter({ hasText: "Primer resultado recibido" })
    .waitFor();
  check(
    "source drafts remain in the process without duplicating the final answer",
    (await streamingPage.locator(".tool-progress[open]").count()) === 1 &&
      (await streamingPage
        .locator(".answer-text > .markdown-text")
        .allTextContents()
        .then((texts) => texts.every((text) => !text.trim()))),
  );
  await streamingPage.waitForFunction(() => {
    const v = document.querySelector(".aui-thread-viewport");
    return v.scrollHeight - v.clientHeight - v.scrollTop < 12;
  });
  await streamingPage.evaluate(() => {
    const stream = window.__controlledDeskStream;
    stream.send({
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "event",
      event: {
        event_id: "facebook-progress",
        sequence: 3,
        turn_id: stream.command.request_id,
        type: "source.coverage",
        block_id: null,
        source_key: "facebook",
        text: "Consultando Facebook",
        evidence_ids: [],
      },
      references: [],
      artifacts: [],
    });
    const base = {
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "text",
      request_id: stream.command.request_id,
      turn_id: stream.command.request_id,
      stream_id: "b".repeat(32),
      block_id: "source-facebook",
      block_revision: 1,
      source_key: "facebook",
      source_keys: ["facebook"],
      status: "provisional",
    };
    stream.send({ ...base, phase: "start", delta_index: 0, text: "" });
    const text = "Hallazgo de Facebook que se está generando. ".repeat(90);
    for (
      let offset = 0, index = 1;
      offset < text.length;
      offset += 1800, index++
    )
      stream.send({
        ...base,
        phase: "delta",
        delta_index: index,
        text: text.slice(offset, offset + 1800),
      });
  });
  await streamingPage.waitForFunction(() =>
    document
      .querySelector(".tool-progress")
      ?.textContent.includes(
        "Hallazgo de Facebook que se está generando. ".repeat(80),
      ),
  );
  await streamingPage.waitForFunction(() => {
    const v = document.querySelector(".aui-thread-viewport");
    return v.scrollHeight - v.clientHeight - v.scrollTop < 12;
  });
  await streamingPage.evaluate(() => {
    const stream = window.__controlledDeskStream;
    stream.send({
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "event",
      event: {
        event_id: "committed-facebook",
        sequence: 4,
        turn_id: stream.command.request_id,
        type: "draft.upsert",
        block_id: "source-facebook",
        block_revision: 1,
        source_key: "facebook",
        text: "Hallazgo de Facebook que se está generando. ".repeat(90),
        evidence_ids: [],
      },
      references: [],
      artifacts: [],
    });
  });
  await streamingPage.waitForFunction(
    () => document.querySelectorAll(".finding").length === 2,
  );
  await streamingPage.evaluate(() => {
    const stream = window.__controlledDeskStream;
    const base = {
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "text",
      request_id: stream.command.request_id,
      turn_id: stream.command.request_id,
      stream_id: "c".repeat(32),
      block_id: "source-instagram",
      block_revision: 1,
      source_key: "instagram",
      source_keys: ["instagram"],
      status: "provisional",
    };
    stream.send({ ...base, phase: "start", delta_index: 0, text: "" });
    const text = "Nuevo fragmento de Instagram. ".repeat(100);
    for (
      let offset = 0, index = 1;
      offset < text.length;
      offset += 1800, index++
    )
      stream.send({
        ...base,
        phase: "delta",
        delta_index: index,
        text: text.slice(offset, offset + 1800),
      });
  });
  await streamingPage.waitForFunction(() =>
    document
      .querySelector(".tool-progress")
      ?.textContent.includes("Nuevo fragmento de Instagram. ".repeat(80)),
  );
  await streamingPage.waitForTimeout(600);
  check(
    "committing and reordering source progress preserves automatic following without user scrolling",
    await streamingPage
      .locator(".aui-thread-viewport")
      .evaluate((v) => v.scrollHeight - v.clientHeight - v.scrollTop < 12),
  );
}

async function prepareConsolidatedAnswer({ check, streamingPage }) {
  const emitMarkdown = async (markdown, terminal = false) => {
    await streamingPage.evaluate(
      ({ markdown, terminal }) => {
        const stream = window.__controlledDeskStream;
        const base = {
          protocol: "ai-market-intelligence",
          version: "2.0",
          kind: "text",
          request_id: stream.command.request_id,
          turn_id: stream.command.request_id,
          block_id: "consolidated",
          source_key: null,
          source_keys: ["web"],
          status: "provisional",
        };
        if (!stream.finalText || !markdown.startsWith(stream.finalText)) {
          stream.finalRevision = (stream.finalRevision || 0) + 1;
          stream.finalId = stream.finalRevision.toString(16).padStart(32, "0");
          stream.finalIndex = 0;
          stream.finalText = "";
          stream.send({
            ...base,
            block_revision: stream.finalRevision,
            stream_id: stream.finalId,
            phase: "start",
            delta_index: stream.finalIndex++,
            text: "",
          });
        }
        const appended = markdown.slice(stream.finalText.length);
        for (let offset = 0; offset < appended.length; offset += 1800)
          stream.send({
            ...base,
            block_revision: stream.finalRevision,
            stream_id: stream.finalId,
            phase: "delta",
            delta_index: stream.finalIndex++,
            text: appended.slice(offset, offset + 1800),
          });
        stream.finalText = markdown;
        if (terminal) {
          stream.send({
            protocol: "ai-market-intelligence",
            version: "2.0",
            kind: "response",
            request_id: stream.command.request_id,
            response: {
              status: "completed",
              markdown,
              references: [],
              artifacts: [],
            },
          });
          stream.close();
        }
      },
      { markdown, terminal },
    );
    await streamingPage.locator(".answer-text > .markdown-text").waitFor();
  };
  const emitAnswer = async (count, terminal = false) => {
    await emitMarkdown(
      "Respuesta progresiva con suficientes líneas para desplazar el chat.\n\n".repeat(
        count,
      ),
      terminal,
    );
    await streamingPage.waitForFunction(
      (count) =>
        document
          .querySelector(".answer-text > .markdown-text")
          ?.textContent.replace(/\s+/g, " ")
          .trim() ===
        "Respuesta progresiva con suficientes líneas para desplazar el chat. "
          .repeat(count)
          .trim(),
      count,
    );
  };
  await emitAnswer(40);
  check(
    "first consolidated delta folds the process while generation continues",
    (await streamingPage.locator(".tool-progress[open]").count()) === 0 &&
      (await streamingPage
        .getByRole("button", { name: "Detener consulta", exact: true })
        .isVisible()),
  );
  const atBottom = () =>
    streamingPage.waitForFunction(() => {
      const viewport = document.querySelector(".aui-thread-viewport");
      return (
        viewport &&
        viewport.scrollHeight > viewport.clientHeight + 100 &&
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 12
      );
    });
  await atBottom();
  const firstScroll = await streamingPage
    .locator(".aui-thread-viewport")
    .evaluate((node) => node.scrollTop);
  const richMarkdown =
    "## Hallazgos\n\n**Precios** y *opiniones* de @Usuario.\n\n- Primer punto\n- Segundo punto\n\n| Fuente | Total |\n| --- | --- |\n| X | 2 |\n\n[Fuente](https://example.org/post)\n\n<script>window.__markdownExecuted=true</script>\n\n![No cargar](https://example.org/track.png) [Inseguro](javascript:alert%281%29)";
  return { emitMarkdown, emitAnswer, atBottom, firstScroll, richMarkdown };
}

async function checkRichMarkdownStreaming({
  atBottom,
  check,
  emitAnswer,
  emitMarkdown,
  firstScroll,
  richMarkdown,
  streamingPage,
}) {
  await emitMarkdown(richMarkdown);
  await streamingPage.locator(".answer-text > .markdown-text strong").waitFor();
  check(
    "live Markdown renders headings, emphasis, lists, tables and safe citations",
    (await streamingPage
      .locator(".answer-text > .markdown-text strong")
      .textContent()) === "Precios" &&
      (await streamingPage
        .locator(".answer-text > .markdown-text em")
        .textContent()) === "opiniones" &&
      (await streamingPage
        .getByRole("heading", { name: "Hallazgos", exact: true })
        .count()) === 1 &&
      (await streamingPage
        .locator(".answer-text > .markdown-text li")
        .count()) === 2 &&
      (await streamingPage
        .locator(".answer-text > .markdown-text table")
        .count()) === 1 &&
      (await streamingPage
        .locator(".answer-text > .markdown-text a")
        .getAttribute("rel")) === "noopener noreferrer" &&
      (await streamingPage
        .getByRole("button", { name: "Detener consulta", exact: true })
        .isVisible()),
  );
  check(
    "chat Markdown highlights mentions in rounded gray chips",
    (await streamingPage
      .locator(".answer-text > .markdown-text .user-mention")
      .textContent()) === "@Usuario" &&
      (await streamingPage
        .locator(".answer-text > .markdown-text .user-mention")
        .evaluate((node) => getComputedStyle(node).borderRadius === "5px")),
  );
  check(
    "agent Markdown cannot execute HTML, activate unsafe links or fetch inline images",
    (await streamingPage
      .locator(
        '.answer-text > .markdown-text script,.answer-text > .markdown-text img,.answer-text > .markdown-text a[href^="javascript:"]',
      )
      .count()) === 0 &&
      (await streamingPage.evaluate(
        () => window.__markdownExecuted === undefined,
      )),
  );
  await emitAnswer(70);
  await atBottom();
  check(
    "new answer deliveries follow the bottom before the stream closes",
    await streamingPage
      .locator(".aui-thread-viewport")
      .evaluate((node, before) => node.scrollTop > before + 100, firstScroll),
  );
}

async function checkManualScrollFollowing({
  atBottom,
  check,
  emitAnswer,
  streamingPage,
}) {
  await streamingPage.locator(".aui-thread-viewport").hover();
  await streamingPage.mouse.wheel(0, -700);
  await streamingPage.waitForFunction(() => {
    const node = document.querySelector(".aui-thread-viewport");
    return node.scrollHeight - node.clientHeight - node.scrollTop > 300;
  });
  await streamingPage.waitForTimeout(300);
  const manuallyScrolled = await streamingPage
    .locator(".aui-thread-viewport")
    .evaluate((node) => node.scrollTop);
  await emitAnswer(90);
  await streamingPage.waitForTimeout(600);
  check(
    "incoming text respects manual upward scrolling",
    await streamingPage
      .locator(".aui-thread-viewport")
      .evaluate(
        (node, before) => Math.abs(node.scrollTop - before) < 5,
        manuallyScrolled,
      ),
  );
  await streamingPage
    .getByRole("button", { name: "Ir al último mensaje", exact: true })
    .click();
  await atBottom();
  await emitAnswer(110);
  await atBottom();
  check(
    "go to last message resumes following later deliveries",
    await streamingPage
      .getByRole("button", { name: "Detener consulta", exact: true })
      .isVisible(),
  );
}

async function checkStreamingCompletion({
  atBottom,
  check,
  emitAnswer,
  streamingPage,
}) {
  await emitAnswer(120);
  await streamingPage.evaluate(() => {
    const stream = window.__controlledDeskStream;
    const base = {
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "text",
      request_id: stream.command.request_id,
      turn_id: stream.command.request_id,
      stream_id: stream.finalId,
      block_id: "consolidated",
      block_revision: stream.finalRevision,
      source_key: null,
      source_keys: ["web"],
      status: "provisional",
    };
    stream.send({
      ...base,
      phase: "end",
      delta_index: stream.finalIndex++,
      text: "",
    });
    stream.send({
      protocol: "ai-market-intelligence",
      version: "2.0",
      kind: "event",
      event: {
        event_id: "completed",
        sequence: 5,
        turn_id: stream.command.request_id,
        type: "run.completed",
        block_id: null,
        text: stream.finalText,
        status: "final",
        evidence_ids: [],
      },
      references: [],
      artifacts: [],
    });
    stream.send({
      ...base,
      phase: "discard",
      delta_index: stream.finalIndex++,
      text: "",
    });
  });
  await streamingPage.waitForTimeout(300);
  check(
    "canonical completion stays visible after provisional withdrawal and before the response envelope",
    (await streamingPage
      .locator(".answer-text > .markdown-text")
      .textContent()
      .then((text) => text.includes("Respuesta progresiva"))) &&
      (await streamingPage.locator(".tool-progress[open]").count()) === 0 &&
      (await streamingPage
        .getByRole("button", { name: "Detener consulta", exact: true })
        .isVisible()),
  );
  await atBottom();
  await emitAnswer(120, true);
  await streamingPage
    .getByRole("button", { name: "Detener consulta", exact: true })
    .waitFor({ state: "detached" });
  await atBottom();
  check("the completed answer remains visible at the bottom", true);
  await streamingPage.close();
}

module.exports = {
  prepareStreamingPage,
  checkSourceTextStreaming,
  prepareConsolidatedAnswer,
  checkRichMarkdownStreaming,
  checkManualScrollFollowing,
  checkStreamingCompletion,
};
