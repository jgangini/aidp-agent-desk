const assert = require('node:assert/strict');

const { chromium } = require(process.env.AGENT_DESK_PLAYWRIGHT_MODULE || 'playwright');

(async () => {

  const browser = await chromium.launch({ headless: true, chromiumSandbox: true });

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const errors = [];

  page.on('pageerror', error => errors.push(String(error)));

  const base = process.env.AGENT_DESK_IDENTITY_BROWSER_URL;

  const health = await page.request.get(base + '/api/health');

  assert.equal((await health.json()).status, 'ok');

  assert.equal((await (await page.request.get(base + '/api/auth/session')).json()).mode, 'local');

  await page.goto(base);

  await page.getByRole('button', { name: 'Mi cuenta' }).click();


  await page.getByRole('button', { name: 'Continuar con Oracle' }).waitFor();

  assert.equal(await page.getByRole('button', { name: 'Continuar con Oracle' }).isDisabled(), true);

  const brand = page.locator('.account-hero .desk-wordmark');

  assert.equal((await brand.textContent()).replace(/\s+/g, ' ').trim(), 'Agent Desk');

  assert.equal(await brand.locator('.t-gradient-text').textContent(), 'Desk');

  await page.getByText('Oracle Cloud Infrastructure', { exact: true }).waitFor();

  const icon = page.locator('.account-oracle-brand img');

  await page.waitForFunction(() => document.querySelector('.account-oracle-brand img')?.naturalWidth > 0);

  assert.equal(await icon.getAttribute('alt'), '');

  const motion = await page.locator('.account-hero').evaluate(async hero => {

    const animations = hero.getAnimations({ subtree: true }).filter(a => a.animationName?.startsWith('account-light'));

    const before = getComputedStyle(hero, '::before').transform;

    for (const animation of animations) animation.currentTime = 5000;

    await new Promise(requestAnimationFrame);

    return { count: animations.length, running: animations.every(a => a.playState === 'running'), moved: before !== getComputedStyle(hero, '::before').transform };

  });

  assert.deepEqual(motion, { count: 2, running: true, moved: true });

  await page.emulateMedia({ reducedMotion: 'reduce' });

  assert.equal(await page.locator('.account-hero').evaluate(hero => getComputedStyle(hero, '::before').animationName), 'none');

  assert.equal(await page.locator('.account-hero').evaluate(hero => getComputedStyle(hero, '::after').animationName), 'none');

  await page.emulateMedia({ reducedMotion: 'no-preference' });

  let user = null;

  const profile = { id: 'a'.repeat(32), name: 'Agente permitido', surface: 'PROD', agent_id: 'agent' };

  let loggedOut = false;

  await page.route('**/api/**', async route => {

    const request = route.request(), path = new URL(request.url()).pathname;

    let value = {};

    if (path === '/api/auth/session') value = { mode: 'oracle', user };

    else if (path === '/api/auth/logout') {

      assert.equal(request.method(), 'POST');

      assert.equal(request.headers()['x-agent-desk-user'], 'admin');

      loggedOut = true;

      user = null;

      await route.fulfill({ status: 204 }); return;

    }

    else if (path === '/api/desk/profiles') value = [profile];

    else if (path.startsWith('/api/desk/suggestions/')) value = [];

    await route.fulfill({ json: value });

  });

  await page.reload();

  await page.getByRole('button', { name: 'Continuar con Oracle' }).waitFor();

  assert.equal(await page.locator('.app').count(), 0);

  assert.equal(await page.locator('input[type=password], input[type=email], .account-header').count(), 0);
  assert.equal(await page.getByRole('heading', { name: 'Agent Desk', exact: true }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'Inicia sesión' }).count(), 0);
  assert.equal(await page.locator('.account-tagline').textContent(), 'Your Agent Flows, in one place.');
  const primary = page.getByRole('button', { name: 'Continuar con Oracle' });
  await primary.hover();
  await page.waitForFunction(() => [...document.querySelectorAll('.account-primary')].every(button => button.getAnimations().length === 0));
  assert.equal(await primary.evaluate(button => getComputedStyle(button).backgroundColor), 'rgb(238, 242, 248)');
  assert.equal(await primary.evaluate(button => getComputedStyle(button).color), 'rgb(20, 24, 30)');

  assert.equal(await page.locator('form').getAttribute('action'), '/api/auth/login');

  let releaseSession;
  let sessionStarted;
  const pendingSession = new Promise(resolve => { sessionStarted = resolve; });
  await page.route('**/api/auth/session', async route => {
    sessionStarted();
    await new Promise(resolve => { releaseSession = resolve; });
    await route.fulfill({ json: { mode: 'oracle', user: null } });
  });
  const beforeFocus = await primary.boundingBox();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await pendingSession;
  assert.equal(await page.locator('.account-loading').count(), 0);
  assert.deepEqual(await primary.boundingBox(), beforeFocus);
  let loginPosts = 0;
  await page.route('**/api/auth/login', async route => {
    assert.equal(route.request().method(), 'POST');
    loginPosts += 1;
    await route.fulfill({ contentType: 'text/html', body: '<h1>Oracle redirect fixture</h1>' });
  });
  await primary.click();
  await page.getByRole('heading', { name: 'Oracle redirect fixture' }).waitFor();
  assert.equal(loginPosts, 1);
  releaseSession();
  await page.unroute('**/api/auth/session');
  await page.goto(base);
  await page.getByRole('button', { name: 'Continuar con Oracle' }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  user = { id: 'admin', email: 'admin@example.com', role: 'admin' };

  await page.reload();

  await page.getByRole('button', { name: 'Mi cuenta' }).click();

  const profileMenu = page.getByRole('menu', { name: 'Perfil', exact: true });

  await profileMenu.waitFor();

  assert.equal(await profileMenu.getByRole('menuitem').count(), 1);

  assert.equal(await profileMenu.getByRole('button', { name: 'Mi cuenta', exact: true }).count(), 0);

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  await profileMenu.getByRole('menuitem', { name: 'Cerrar sesión', exact: true }).click();

  await page.getByRole('button', { name: 'Continuar con Oracle' }).waitFor();

  assert.equal(loggedOut, true);

  assert.equal(await page.locator('.app').count(), 0);

  assert.deepEqual(errors, []);

  console.log('Identity browser: local gate, Oracle login, mobile layout and profile logout passed; mocked tenant APIs, no captures.');

  await browser.close();

})().catch(error => { console.error(error); process.exit(1); });

