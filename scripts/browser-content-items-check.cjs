// Uses the existing browser runner; all agent/API responses are local fixtures.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
module.exports = async (browser, baseURL) => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../frontend/src/features/desk/fixtures/content-items-v1.json"), "utf8"));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  const checks = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const check = (name, condition) => { assert.ok(condition, name); checks.push(name); };
  try {
    await context.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/auth/session") return route.fulfill({ json: { mode: "local" } });
      if (url.pathname === "/api/desk/profiles") return route.fulfill({ json: [{ id: "a".repeat(32), name: "Content fixture", endpoint_host: "test.example.org", flow_id: "fixture", region: "test", profile: "fixture", ready: true, surface: "TEST", instance_id: "fixture", workspace_id: "fixture" }] });
      if (url.pathname.startsWith("/api/desk/suggestions/")) return route.fulfill({ json: { items: [] } });
      return route.fulfill({ json: {} });
    });
    await page.addInitScript(() => {
      localStorage.setItem("agent-desk.selected-profile", "test:" + "a".repeat(32));
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (String(input).endsWith("/api/desk/stream") && init?.method === "POST") {
          const command = JSON.parse(init.body);
          const body = new ReadableStream({ start(controller) {
            window.__contentStream = { command, send: (packet) => controller.enqueue(new TextEncoder().encode(JSON.stringify(packet) + "\n")), close: () => controller.close() };
          } });
          return Promise.resolve(new Response(body, { headers: { "Content-Type": "application/x-ndjson" } }));
        }
        return originalFetch(input, init);
      };
    });
    await page.goto(baseURL);
    const composer = page.getByRole("textbox", { name: "Mensaje al agente", exact: true });
    await composer.fill("Verificar publicaciones de prueba");
    await composer.press("Enter");
    await page.waitForFunction(() => !!window.__contentStream);
    const summary = "## Tema de la fuente\n**Información revisada** de @Usuario.\n\n" + "Observación de prueba con alcance acotado. ".repeat(60) + "\n\n- Primer hallazgo\n- Segundo hallazgo";
    const collection = structuredClone(fixture.collection);
    collection.items.push({ ...collection.items[0], item_id: "second-item", primary_evidence_id: "second-evidence", evidence_ids: ["second-evidence"], text: "## Segunda publicación\n**Resumen propio** del segundo ítem.", comments_analysis: undefined });
    const references = [...fixture.references, { evidence_id: "second-evidence", url: "https://example.org/posts/2", source_title: "Segundo post", author_name: "Segundo autor", content_basis: "post_text" }];
    await page.evaluate(({ event, summary, collection, references }) => {
      const stream = window.__contentStream;
      const initial = structuredClone(collection);
      delete initial.items[0].comments_analysis;
      window.__contentEvent = { ...event, event: { ...event.event, turn_id: stream.command.request_id, text: summary, evidence_ids: references.filter((ref) => ref.content_basis !== "comment_text").map((ref) => ref.evidence_id) }, references: references.filter((ref) => ref.content_basis !== "comment_text"), content_items: initial };
      stream.send(window.__contentEvent);
    }, { event: fixture.event, summary, collection, references });
    const card = page.locator(".finding").first();
    await card.locator(".finding-summary strong").waitFor();
    check("a publication never invents comment analysis before the capability arrives", await card.locator('[aria-label="Comentarios de la publicación"]').count() === 0);
    await page.evaluate(({ collection, references }) => {
      collection.revision = 2;
      collection.items[0].item_revision = 2;
      window.__contentStream.send({ ...window.__contentEvent, references, content_items: collection });
    }, { collection, references });
    await card.locator('[aria-label="Comentarios de la publicación"]').waitFor();
    check("a repeated immutable event can add reviewed comments and their reference", await card.locator('[aria-label="Comentarios de la publicación"]').textContent().then((text) => text.includes(fixture.collection.items[0].comments_analysis.text)));
    check("source card parses Markdown without raw markers", await card.locator(".finding-summary strong").textContent() === "Información revisada" && !(await card.locator(".finding-summary").textContent()).includes("**"));
    check("process uses the same safe Markdown renderer", await page.locator(".tool-progress .markdown-text strong").textContent() === "Información revisada");
    const collapsed = await card.locator(".finding-summary").evaluate((node) => node.getBoundingClientRect().height);
    await card.locator(".finding-summary").press("Enter");
    check("keyboard expansion increases the summary height", await card.locator(".finding-summary").evaluate((node, before) => node.getBoundingClientRect().height > before + 20, collapsed));
    await card.locator(".finding-summary").press("Enter");
    check("folding restores the summary height", await card.locator(".finding-summary").evaluate((node, before) => Math.abs(node.getBoundingClientRect().height - before) < 2, collapsed));
    check("active publication has its own reviewed comment sample", await card.locator('[aria-label="Comentarios de la publicación"]').textContent().then((text) => text.includes(fixture.collection.items[0].comments_analysis.text)));
    await card.getByRole("button", { name: "Ver publicación 2" }).click();
    check("carousel changes the summary without mixing comments", await card.getByRole("heading", { name: "Segunda publicación" }).isVisible() && await card.locator('[aria-label="Comentarios de la publicación"]').count() === 0);
    const final = "## Hallazgos\n**Conclusión** breve de @Usuario.\n\n- Evidencia recuperada\n- Alcance acotado";
    await page.evaluate(({ response, final }) => { const stream = window.__contentStream; stream.send({ ...response, request_id: stream.command.request_id, content_items: undefined, response: { ...response.response, markdown: final } }); stream.close(); }, { response: fixture.response, final });
    await page.getByRole("button", { name: "Enviar consulta", exact: true }).waitFor();
    check("final answer retains Markdown and source process folds", await page.locator(".answer-text > .markdown-text h2").textContent() === "Hallazgos" && await page.locator(".tool-progress[open]").count() === 0);
    await page.reload();
    await page.locator(".source-post-analysis").waitFor();
    check("reviewed collection survives a page reload", await page.locator(".source-post-analysis").textContent().then((text) => text.includes(fixture.collection.items[0].text)));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => document.fonts.ready);
      check(`no horizontal page overflow at ${width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    assert.deepEqual(errors, []);
    const report = { checks, errors, capture: "none; DOM and interaction checks only", baseURL, checkedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(__dirname, "../.cache/content-items-browser.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await context.close(); }
};
