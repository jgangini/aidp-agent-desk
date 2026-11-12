// Dedicated local test instance only. No cloud calls, captures, recordings or traces.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
module.exports = async function scheduledServerChecks(browser, base) {
  const context = await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page = await context.newPage();
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  const name=`Informe QA ${Date.now()}`;
  try {
    await page.goto(base);
    await page.getByRole("textbox",{name:"Mensaje al agente",exact:true}).fill("Borrador conservado QA");
    await page.getByRole("button",{name:"Tareas",exact:true}).click();
    const panel=page.locator(".scheduled-server-panel");
    await page.getByRole("button",{name:"Nueva tarea",exact:true}).click();
    const form=page.locator(".scheduled-inline-form");
    await form.getByRole("textbox",{name:"Nombre de la tarea",exact:true}).fill(name);
    await form.getByRole("textbox",{name:/Instrucciones/}).fill("Preparar un informe de demostración sin fuentes externas.");
    await form.getByRole("button",{name:"Guardar y ejecutar",exact:true}).click();
    await panel.locator(".scheduled-server-card.is-selected").getByText(name,{exact:true}).waitFor();
    assert.equal(await page.locator(".task-report-body").count(),0,"task selection keeps the report pane empty");
    const spacing = await panel.evaluate(node=>{
      const tabs=node.querySelector('[role="tablist"]').getBoundingClientRect();
      const card=node.querySelector('.scheduled-server-card').getBoundingClientRect();
      const button=node.querySelector('.scheduled-task-open');
      return {gap:card.top-tabs.bottom,align:getComputedStyle(button).alignItems,border:getComputedStyle(node.querySelector('.scheduled-server-card')).borderTopWidth};
    });
    assert(spacing.gap>=8 && spacing.gap<=20,"cards sit directly below task tabs");
    assert.equal(spacing.align,"flex-start");assert.equal(spacing.border,"1px");
    const tasks=await (await context.request.get(`${base}/api/desk/scheduled-tasks`)).json();
    const task=tasks.tasks.find(t=>t.name===name);assert(task);
    const runs=()=>context.request.get(`${base}/api/desk/scheduled-tasks/${task.id}/runs`).then(r=>r.json());
    const initialRun=(await runs()).runs[0];
    await panel.getByRole("tab",{name:"Completadas",exact:true}).click();
    await panel.getByRole("button",{name:`Abrir ejecución ${initialRun.id}`,exact:true}).click();
    await page.getByRole("heading",{name:"Resumen",exact:true}).waitFor();
    const cardBounds = await panel.getByRole("button",{name:`Formato del informe ${initialRun.id}`,exact:true}).evaluate(button => {
      const card = button.closest('article');
      const actions = card.querySelector('.completed-report-actions').getBoundingClientRect();
      const metadata = card.querySelector('.completed-report-meta').getBoundingClientRect();
      return {actionsBottom: actions.bottom, metadataTop: metadata.top, overflow: card.scrollWidth-card.clientWidth};
    });
    assert(cardBounds.metadataTop >= cardBounds.actionsBottom, "four report actions never overlap metadata");
    assert(cardBounds.overflow <= 1, "completed report card stays within its panel");
    assert.match(await page.locator(".saved-report").innerText(),/Demostración local determinista/);
    assert.equal((await runs()).runs.length,1);
    await page.reload();
    await page.getByRole("heading",{name:"Resumen",exact:true}).waitFor();
    assert.equal((await runs()).runs.length,1,"reload must not invoke the agent");
    assert.equal(await page.getByRole("heading",{name:"Tareas",exact:true}).count(),1,"reload keeps the task panel open");
    assert.equal(await panel.getByRole("tab",{name:"Completadas",exact:true}).getAttribute("aria-selected"),"true","reload keeps the selected task tab");
    await panel.getByRole("tab",{name:"Activadas",exact:true}).click();
    assert.equal(await panel.getByRole("button",{name:/Descargar informe/}).count(),0,"active schedules do not show completed downloads");
    await panel.getByRole("tab",{name:"Completadas",exact:true}).click();
    const downloadPromise=page.waitForEvent("download");
    await panel.getByRole("button",{name:`Descargar informe ${initialRun.id}`,exact:true}).click();
    const download=await downloadPromise;assert.match(download.suggestedFilename(),/\.md$/);
    assert.match(await fs.readFile(await download.path(),"utf8"),/^# /);
    await panel.getByRole("button",{name:`Abrir ejecución ${initialRun.id}`,exact:true}).click();
    await page.getByRole("heading",{name:"Resumen",exact:true}).waitFor();
    await panel.getByRole("button",{name:`Formato del informe ${initialRun.id}`,exact:true}).click();
    await page.getByRole("textbox",{name:"Título de sección",exact:true}).fill("Resumen de prueba");
    await page.getByRole("button",{name:"Guardar",exact:true}).click();
    await page.getByText(/Formato guardado en la versión 2/).waitFor();
    assert.equal((await runs()).runs.length,1,"format changes must not invoke research");
    await page.getByRole("heading",{name:"Resumen",exact:true}).waitFor();
    assert.equal(await page.locator(".task-run-table").count(),0);
    assert.equal(await panel.getByRole("button",{name:"Ejecutar ahora",exact:true}).count(),0,"completed reports do not offer manual execution");
    await panel.getByRole("tab",{name:"Activadas",exact:true}).click();
    assert.equal(await panel.getByRole("button",{name:"Ejecutar ahora",exact:true}).count(),0,"manual execution is absent from scheduled UI");
    const manual = await context.request.post(`${base}/api/desk/scheduled-tasks/${task.id}/run`,{headers:{Origin:base,"X-Agent-Desk":"configure"},data:{idempotencyKey:"format-regression"}});
    assert.equal(manual.status(),202);
    const manualRun=await manual.json();
    await panel.getByRole("tab",{name:"Completadas",exact:true}).click();
    await panel.getByRole("button",{name:`Abrir ejecución ${manualRun.id}`,exact:true}).click();
    await page.getByRole("heading",{name:"Resumen de prueba",exact:true}).waitFor();
    assert.equal((await runs()).runs.length,2);
    await panel.getByRole("button",{name:`Eliminar informe ${manualRun.id}`,exact:true}).click();
    const confirm = page.getByRole("dialog", {name:"Eliminar informe",exact:true});
    assert.equal(await confirm.evaluate(node=>node.classList.contains("history-delete-dialog")),true,"report deletion reuses the standard dialog");
    assert(await confirm.evaluate(node=>node.scrollWidth<=node.clientWidth),"confirmation text stays inside the dialog");
    await page.getByRole("dialog").getByRole("button",{name:"Eliminar informe",exact:true}).click();
    await panel.getByRole("button",{name:"Deshacer",exact:true}).waitFor();
    assert.equal((await runs()).runs.length,1,"deleted report is hidden without deleting its schedule");
    assert.equal(await page.locator('.saved-report').count(),0,"selected deleted report is closed");
    await panel.getByRole("button",{name:"Deshacer",exact:true}).click();
    await panel.getByRole("button",{name:`Abrir ejecución ${manualRun.id}`,exact:true}).waitFor();
    assert.equal((await runs()).runs.length,2,"undo restores report without research");
    await panel.getByRole("tab",{name:"Activadas",exact:true}).click();
    await panel.getByRole("button",{name:`Pausar ${name}`,exact:true}).click();
    await panel.getByRole("tab",{name:"En pausa",exact:true}).click();
    await panel.getByRole("button",{name:`Reanudar ${name}`,exact:true}).waitFor();
    assert.equal((await runs()).runs.length,2);
    await navigationChecks(browser, base, task);
    await onceChecks(browser, base);
    await panel.getByRole("button",{name:`Reanudar ${name}`,exact:true}).click();
    await panel.getByRole("tab",{name:"Activadas",exact:true}).click();
    await panel.getByRole("button",{name:`Eliminar ${name}`,exact:true}).click();
    await page.getByRole("dialog").getByRole("button",{name:"Eliminar tarea",exact:true}).click();
    await page.locator(".task-report-workspace").waitFor({state:"detached"});
    await page.setViewportSize({width:375,height:812});
    await page.getByRole("button",{name:"Nueva tarea",exact:true}).click();
    await page.locator(".scheduled-inline-form").waitFor();
    assert(await page.locator(".scheduled-inline-form").evaluate(el=>el.getBoundingClientRect().width<=window.innerWidth));
    await page.keyboard.press("Escape");
    await page.getByRole("button",{name:"Cerrar Tareas",exact:true}).click();
    assert.equal(await page.getByRole("textbox",{name:"Mensaje al agente",exact:true}).inputValue(),"Borrador conservado QA");
    assert.deepEqual(errors,[]);
    console.log("Scheduled server browser checks passed: initial run, reload, Markdown, format version without research, manual run, pause, deletion, mobile dialog, preserved draft.");
  } finally {
    try { await cleanupNamedTask(context, base, name); }
    finally { await context.close(); }
  }
};

async function cleanupNamedTask(context, base, name) {
  const response = await context.request.get(`${base}/api/desk/scheduled-tasks`);
  assert.equal(response.status(), 200, "QA cleanup can read its task list");
  const { tasks } = await response.json();
  for (const task of tasks.filter(task => task.name === name && task.agentId === "demo")) {
    const removed = await context.request.delete(`${base}/api/desk/scheduled-tasks/${task.id}`, {
      headers: {Origin: base, "X-Agent-Desk": "configure"},
    });
    assert.equal(removed.status(), 204, "QA cleanup deletes only its own synthetic task");
  }
}

async function navigationChecks(browser, base, task) {
  const context = await browser.newContext({ viewport: { width: 1432, height: 1002 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/auth/session", route => route.fulfill({json:{mode:"oracle",user:{id:"qa-header-admin",email:"admin@example.com",role:"admin"}}}));
  await page.route("**/api/admin/users", route => route.fulfill({json:[{id:"qa-header-admin",email:"admin@example.com",role:"admin",enabled:true,profiles:[]}]}));
  await page.route("**/api/admin/user-management", route => route.fulfill({json:{directory_available:true,allow_create:false}}));
  try {
    const taskRuns=await(await context.request.get(`${base}/api/desk/scheduled-tasks/${task.id}/runs`)).json();
    const chosenRun=taskRuns.runs.find(run=>["completed","partial"].includes(run.status));
    await page.goto(base);
    await page.getByRole("button",{name:"Tareas",exact:true}).waitFor();
    let releaseSession;
    const heldSession = new Promise(resolve=>{releaseSession=resolve;});
    const pendingCheck = async route=>{await heldSession;await route.fulfill({json:{mode:"oracle",user:{id:"qa-header-admin",email:"admin@example.com",role:"admin"}}});};
    await page.route("**/api/auth/session",pendingCheck);
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await page.getByRole("button",{name:"Tareas",exact:true}).click({timeout:2000});
    await page.getByRole("heading",{name:"Tareas",exact:true}).waitFor();
    releaseSession();
    await page.unroute("**/api/auth/session",pendingCheck);
    await page.getByRole("button",{name:"Cerrar Tareas",exact:true}).click();
    await page.getByRole("button",{name:"Mi cuenta",exact:true}).click();
    await page.getByRole("menuitem",{name:"Usuarios",exact:true}).click();
    await page.getByRole("region",{name:"Usuarios",exact:true}).waitFor();
    const referenceHeight = await page.locator(".users-heading").evaluate(node=>node.getBoundingClientRect().height);
    await page.getByRole("button",{name:"Mi cuenta",exact:true}).click();
    await page.getByRole("menu",{name:"Perfil",exact:true}).waitFor();
    // One real click while the profile surface is expanded must reach Tareas.
    await page.getByRole("button",{name:"Tareas",exact:true}).click();
    await page.getByRole("heading",{name:"Tareas",exact:true}).waitFor();
    assert.equal(await page.locator(".users-panel").count(),0);
    const heading=page.locator(".task-report-heading");
    await heading.waitFor();
    assert.equal(await heading.locator("button:visible").count(),1);
    assert.equal((await heading.innerText()).replace(/\s+/g," ").trim(),"Agent Desk");
    assert.equal(await heading.evaluate(node=>node.getBoundingClientRect().height),referenceHeight);
    await page.locator(".saved-report").waitFor();
    const panel=page.locator(".scheduled-server-panel");
    await panel.getByRole("tab",{name:"En pausa",exact:true}).click();
    await panel.getByRole("button",{name:new RegExp(task.name)}).filter({has:page.locator("strong")}).click();
    await panel.getByRole("tab",{name:"Completadas",exact:true}).click();
    await panel.getByRole("button",{name:`Abrir ejecución ${chosenRun.id}`,exact:true}).click();
    await page.locator(".saved-report").waitFor();
    assert.equal(await page.locator(".users-panel").count(),0);
    await page.waitForFunction(()=>document.activeElement?.classList.contains("task-report-heading"));
    await page.setViewportSize({width:390,height:844});
    await heading.getByRole("button",{name:"Ir al inicio",exact:true}).click();
    await page.getByRole("heading",{name:"Nuevo Chat",exact:true}).waitFor();
    await page.getByRole("button",{name:"Tareas",exact:true}).click();
    await page.locator(".saved-report").waitFor();
    await heading.getByRole("button",{name:"Volver a Tareas",exact:true}).click();
    await panel.getByRole("tab",{name:"Completadas",exact:true}).click();
    await panel.getByRole("button",{name:`Abrir ejecución ${chosenRun.id}`,exact:true}).click();
    await page.locator(".saved-report").waitFor();
    await page.waitForFunction(()=>document.activeElement?.classList.contains("task-report-heading"));
    await page.setViewportSize({width:1432,height:1002});
    await page.getByRole("button",{name:"Nueva tarea",exact:true}).click();
    await page.locator(".scheduled-inline-form").waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button",{name:"Cerrar Tareas",exact:true}).click();
    assert.equal(await page.locator(".task-report-workspace").count(),0);
    assert.deepEqual(errors,[]);
    console.log("Scheduled navigation checks passed: single click through open profile, users replaced, flush header, completed report, header create action.");
  } finally { await context.close(); }
}

async function onceChecks(browser, base) {
  const context=await browser.newContext({viewport:{width:1432,height:1002}});
  const page=await context.newPage();
  const name=`Única QA ${Date.now()}`;
  try {
    await page.goto(base);
    await page.getByRole("button",{name:"Tareas",exact:true}).click();
    await page.getByRole("button",{name:"Nueva tarea",exact:true}).click();
    const form=page.locator(".scheduled-inline-form");
    await page.getByRole("heading",{name:"Nueva tarea",exact:true}).click();
    await page.mouse.move(0,0);
    await page.waitForFunction(()=>{const input=document.querySelector('.scheduled-inline-form input');return input && input.getAnimations().length===0;});
    const standardInput=await form.getByRole("textbox",{name:"Nombre de la tarea",exact:true}).evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,color:s.color,border:s.borderTopColor,radius:s.borderRadius,minHeight:s.minHeight};});
    await form.getByRole("textbox",{name:"Nombre de la tarea",exact:true}).fill(name);
    await form.getByRole("textbox",{name:/Instrucciones/}).fill("fixture:market");
    await form.getByLabel("Repetir",{exact:true}).selectOption("once");
    await form.getByRole("button",{name:"Guardar y ejecutar",exact:true}).click();
    await form.waitFor({state:"hidden"});
    const panel=page.locator("#scheduled-panel");
    await panel.getByRole("tab",{name:"En pausa",exact:true}).click();
    await panel.getByRole("button",{name:`Reanudar ${name}`,exact:true}).waitFor();
    const listing=await (await context.request.get(`${base}/api/desk/scheduled-tasks`)).json();
    const task=listing.tasks.find(t=>t.name===name);
    assert.equal(task.status,"paused");assert.equal(task.nextRunAt,null);
    const runs=await (await context.request.get(`${base}/api/desk/scheduled-tasks/${task.id}/runs`)).json();
    assert.equal(runs.runs.length,1);assert.equal(runs.runs[0].status,"completed");
    assert.equal(await panel.getByRole("button",{name:"Ejecutar ahora",exact:true}).count(),0);
    assert.equal(await panel.getByRole("button",{name:/Descargar informe/}).count(),0);
    assert.equal(await panel.getByRole("button",{name:`Editar ${name}`,exact:true}).count(),0);
    assert.equal(await panel.getByRole("button",{name:`Eliminar ${name}`,exact:true}).count(),0);
    await panel.getByRole("tab",{name:"Completadas",exact:true}).click();
    await panel.getByRole("button",{name:`Descargar informe ${runs.runs[0].id}`,exact:true}).waitFor();
    assert.equal(await panel.getByRole("button",{name:`Eliminar informe ${runs.runs[0].id}`,exact:true}).evaluate(el=>getComputedStyle(el).color),"rgb(242, 167, 158)");
    await panel.getByRole("button",{name:`Abrir ejecución ${runs.runs[0].id}`,exact:true}).click();
    await page.getByRole("heading",{name:"Resumen",exact:true}).waitFor();
    const stableSection=await page.locator(".saved-report .report-section").first().elementHandle();
    const sources=page.locator(".saved-report .report-sources").first();
    await sources.locator("summary").click();
    const sourceHandle=await sources.elementHandle();
    await page.waitForTimeout(5500);
    assert(await stableSection.evaluate(node=>node.isConnected),"report sections survive periodic refreshes");
    assert(await sourceHandle.evaluate(node=>node.isConnected && node.open),"expanded sources remain open");
    await panel.getByRole("button",{name:`Formato del informe ${runs.runs[0].id}`,exact:true}).click();
    const editor=page.getByRole("region",{name:"Editar plantilla",exact:true});
    await editor.locator(".report-format-page").waitFor();
    for(const field of await editor.locator(".report-format-fields .t-input").all()) {
      const actual=await field.evaluate(el=>{const s=getComputedStyle(el);return {background:s.backgroundColor,color:s.color,border:s.borderTopColor,radius:s.borderRadius,minHeight:s.minHeight};});
      assert.deepEqual(actual,standardInput,"editor fields reuse the existing task form styles");
    }
    assert.equal(await page.locator("dialog[open]").count(),0,"template editing stays inline");
    assert.equal(await page.locator(".task-report-body").count(),0,"editor replaces report body");
    const editorClose=await page.getByRole("button",{name:"Cerrar ajuste de formato",exact:true}).evaluate(el=>el.getBoundingClientRect().toJSON());
    assert(editorClose.top<50,"editor close action lives in top workspace header");
    assert.equal(await editor.locator('header').count(),0);
    assert(await editor.getByText("Recuento conservado: publicaciones",{exact:true}).isVisible());
    const items=editor.locator(".report-format-block");
    const ids=await items.evaluateAll(nodes=>nodes.map(node=>node.dataset.sectionId));
    await items.nth(0).locator(".report-format-grip").dragTo(items.nth(1).locator(".report-format-section-heading"));
    assert.deepEqual((await items.evaluateAll(nodes=>nodes.map(node=>node.dataset.sectionId))).slice(0,2),[ids[1],ids[0]]);
    const targetId=ids[1];
    await items.nth(1).locator(".report-format-grip").dragTo(editor.locator(`[data-section-id="${targetId}"] .report-drop-column`));
    assert.equal(await editor.locator('.report-format-row[data-columns="2"]').count(),1,"mouse drop creates two-column row");
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.setViewportSize({width:390,height:844});
    const bounds=await editor.evaluate(node=>({width:node.getBoundingClientRect().width,overflow:node.scrollWidth-node.clientWidth,transition:getComputedStyle(node).transitionDuration}));
    assert(bounds.width<=390 && bounds.overflow<=1,"mobile editor stays within viewport");
    assert.equal(bounds.transition,"0s");
    const footer=await editor.locator("footer").evaluate(node=>({bottom:node.getBoundingClientRect().bottom,viewport:innerHeight}));
    assert(footer.bottom<=footer.viewport+1,"save bar stays in the workspace viewport");
    await editor.getByRole("button",{name:"Guardar",exact:true}).click();
    await editor.waitFor({state:"detached"});
    const stored=await(await context.request.get(`${base}/api/desk/scheduled-tasks/${task.id}/template`)).json();
    assert.equal(stored.presentation.rows.filter(row=>row.section_ids.length===2).length,1);
    assert.equal((await(await context.request.get(`${base}/api/desk/scheduled-tasks/${task.id}/runs`)).json()).runs.length,1,"saving columns never researches");
    await page.setViewportSize({width:1432,height:1002});
    await panel.getByRole("tab",{name:"En pausa",exact:true}).click();
    const cleanup=await context.request.delete(`${base}/api/desk/scheduled-tasks/${task.id}`,{headers:{Origin:base,"X-Agent-Desk":"configure"}});
    assert.equal(cleanup.status(),204);
    console.log("One-shot browser checks passed: paused schedule, stable report refresh, folded sources, real chart preview, native drag, mobile editor, reduced motion, no manual action.");
  } finally {
    try { await cleanupNamedTask(context, base, name); }
    finally { await context.close(); }
  }
}
