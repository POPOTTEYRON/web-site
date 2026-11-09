// Contrôle qualité automatique sur toutes les pages (FR, EN, admin) :
// accessibilité WCAG 2.2 AA (axe-core), validité du HTML envoyé par le serveur,
// structure des titres, liens internes, décalage de mise en page de la carte.
// tel-non-breaking désactivé (.htmlvalidate.json) : les numéros sont insécables, mais la règle
// exige aussi des espaces insécables dans le texte qui les entoure (« Commandez par téléphone au »).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { hash } from '@node-rs/argon2';
import { HtmlValidate } from 'html-validate';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { upsertAdmin } from '../../src/db/repo.js';
import { resetDb, openDay } from '../helpers.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const htmlvalidate = new HtmlValidate(JSON.parse(readFileSync('.htmlvalidate.json', 'utf8')));

let server; let browser; let base; let page; let ctx;
const results = [];
const links = new Set();
let lastHtml = '';

before(async () => {
  await resetDb();
  await upsertAdmin('gerant@timango-gp.example', await hash('motdepasse-de-test-123'));
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch();
  // bypassCSP : uniquement pour injecter axe-core (la CSP du site bloque à juste titre tout script inline).
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, bypassCSP: true });
  page = await ctx.newPage();
  page.on('response', async (r) => { if (r.request().resourceType() === 'document') lastHtml = await r.text().catch(() => ''); });
});
after(async () => { await browser?.close(); server?.close(); await pool.end(); });

async function audit(label) {
  await page.addScriptTag({ content: AXE });
  const axe = await page.evaluate(async () => (await window.axe.run(document, {
    runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
  })).violations.map((v) => `${v.impact} ${v.id} (${v.nodes[0].target.join(' ')})`));
  const levels = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1])));
  const headings = [];
  if (levels.filter((l) => l === 1).length !== 1) headings.push(`${levels.filter((l) => l === 1).length} h1`);
  levels.forEach((l, i) => { if (i && l - levels[i - 1] > 1) headings.push(`h${levels[i - 1]}→h${l}`); });
  const report = await htmlvalidate.validateString(lastHtml);
  const html = [...new Set(report.results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`)))];
  for (const href of await page.evaluate(() => [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute('href')))) links.add(href.split('#')[0]);
  results.push({ label, axe, headings, html });
}

test('audit de toutes les pages publiques, de la confirmation, des erreurs et de l\'admin', async () => {
  const day = openDay();
  for (const path of ['/', '/carte', '/le-restaurant', '/reserver', `/reserver?personnes=2&date=${day}`, '/contact', '/mentions-legales',
    '/confidentialite', '/en/', '/en/menu', '/en/the-restaurant', '/en/book', '/en/contact', '/en/legal-notice', '/en/privacy', '/page-inconnue']) {
    await page.goto(base + path);
    await audit(path);
  }
  // Formulaire renvoyé avec erreurs (sans la validation du navigateur)
  await page.goto(`${base}/reserver?personnes=2&date=${day}`);
  await Promise.all([page.waitForNavigation(), page.evaluate(() => HTMLFormElement.prototype.submit.call(document.querySelector('#etape-heure')))]);
  await audit('réservation : erreurs');
  // Confirmation
  await page.goto(`${base}/reserver?personnes=2&date=${day}`);
  await page.locator('label.choice:has(input[name=heure]:not([disabled]))').first().click();
  await page.getByLabel('Nom').fill('Audit'); await page.getByLabel('Téléphone').fill('0690 00 00 00');
  await page.getByLabel('Email').fill('audit@exemple.fr'); await page.getByLabel(/J'accepte/).check();
  await Promise.all([page.waitForURL(/nouvelle=1/), page.getByRole('button', { name: 'Confirmer la réservation' }).click()]);
  await audit('confirmation');
  // Admin
  await page.goto(`${base}/admin/connexion`);
  await audit('admin : connexion');
  await page.getByLabel('Email').fill('gerant@timango-gp.example');
  await page.getByLabel('Mot de passe').fill('motdepasse-de-test-123');
  await Promise.all([page.waitForURL(/\/admin$/), page.getByRole('button', { name: 'Se connecter' }).click()]);
  for (const path of [`/admin?date=${day}`, '/admin/planning', '/admin/nouvelle', '/admin/reglages']) {
    await page.goto(base + path);
    await audit(`admin : ${path}`);
  }

  const problems = results.flatMap((r) => [...r.axe.map((x) => `${r.label} — axe ${x}`), ...r.headings.map((x) => `${r.label} — titres ${x}`), ...r.html.map((x) => `${r.label} — html ${x}`)]);
  assert.deepEqual(problems, [], problems.join('\n'));
  assert.equal(results.length, 23, `${results.length} pages auditées`);
});

test('aucun lien interne cassé', async () => {
  assert.ok(links.size > 20);
  const broken = [];
  for (const href of links) {
    const res = await page.request.get(base + href, { maxRedirects: 0 });
    if (res.status() >= 400) broken.push(`${res.status()} ${href}`);
  }
  assert.deepEqual(broken, []);
});

test('carte : aucun décalage de mise en page au chargement (CLS)', async () => {
  for (let i = 0; i < 5; i += 1) {
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; })
        .observe({ type: 'layout-shift', buffered: true });
    });
    await p.goto(`${base}/carte`, { waitUntil: 'networkidle' });
    const cls = await p.evaluate(() => window.__cls);
    assert.ok(cls < 0.05, `CLS ${cls.toFixed(3)} au chargement ${i + 1}`);
    await p.close();
  }
});
