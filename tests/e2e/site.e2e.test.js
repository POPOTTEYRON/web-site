// Tests de bout en bout dans Chromium (Playwright). Lancer : npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { ROUTES } from '../../src/i18n/routes.js';
import { resetDb } from '../helpers.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let server; let browser; let base;
const VIEWPORTS = { mobile: { width: 390, height: 844 }, tablet: { width: 768, height: 1024 }, desktop: { width: 1440, height: 900 } };

before(async () => {
  await resetDb();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); await pool.end(); });

async function open(viewport = VIEWPORTS.mobile) {
  const ctx = await browser.newContext({ viewport, locale: 'fr-FR' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push(`échec réseau : ${r.url()}`));
  return { ctx, page, errors };
}

test('toutes les pages, 3 tailles d\'écran : pas d\'erreur console, pas de défilement horizontal', async () => {
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const { ctx, page, errors } = await open(vp);
    for (const r of Object.values(ROUTES)) {
      for (const path of [r.fr, r.en]) {
        const res = await page.goto(base + path, { waitUntil: 'networkidle' });
        assert.equal(res.status(), 200, `${name} ${path}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 0, `${name} ${path} : débordement horizontal de ${overflow}px`);
      }
    }
    assert.deepEqual(errors, [], `${name} : ${errors.join(' | ')}`);
    await ctx.close();
  }
});

test('menu mobile : ouverture, fermeture à Échap, retour du focus', async () => {
  const { ctx, page } = await open();
  await page.goto(base + '/');
  const toggle = page.locator('.nav-toggle');
  assert.equal(await page.locator('#site-nav').isVisible(), false);
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.getByRole('link', { name: 'La carte' }).first().isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('nav-toggle')), true);
  await ctx.close();
});

test('carte : onglets au clic et au clavier', async () => {
  const { ctx, page } = await open();
  await page.goto(base + '/carte');
  const panel = (id) => page.locator(`[data-panel="${id}"]`);
  assert.equal(await panel('entrees').isVisible(), true);
  assert.equal(await panel('plats').isVisible(), false);
  await page.getByRole('tab', { name: 'Plats' }).click();
  assert.equal(await panel('plats').isVisible(), true);
  assert.equal(await panel('entrees').isVisible(), false);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'Desserts' }).getAttribute('aria-selected'), 'true');
  assert.equal(await panel('desserts').isVisible(), true);
  await ctx.close();
});

test('carte sans JavaScript : toutes les catégories restent lisibles', async () => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: VIEWPORTS.mobile });
  const page = await ctx.newPage();
  await page.goto(base + '/carte');
  for (const id of ['entrees', 'plats', 'desserts', 'boissons']) assert.equal(await page.locator(`[data-panel="${id}"]`).isVisible(), true, id);
  await ctx.close();
});

test('réservation : parcours complet, erreurs signalées, confirmation puis annulation', async () => {
  const { ctx, page, errors } = await open();
  await page.goto(base + '/reserver');
  await page.locator('label.choice:has(input[name=personnes][value="4"])').click();
  await page.waitForLoadState('load');
  // Premier jour ouvert hors aujourd'hui (le jour même peut ne plus avoir de créneau)
  const day = page.locator('.day-strip input[name=date]:not([disabled])').nth(1);
  const value = await day.getAttribute('value');
  await Promise.all([page.waitForURL(new RegExp(`date=${value}`)), page.locator(`label.choice:has(input[value="${value}"])`).click()]);
  assert.match(page.url(), /personnes=4/);
  assert.ok(await page.locator('input[name=heure]').count() > 10);

  // Envoi vide : erreurs en ligne, résumé, focus sur le premier champ en erreur
  await page.getByRole('button', { name: 'Confirmer la réservation' }).click();
  assert.equal(await page.locator('[data-error-summary]').isVisible(), true);
  assert.ok(await page.locator('.field-error').count() >= 5);
  assert.equal(await page.evaluate(() => document.activeElement.name), 'heure');

  // Email invalide
  await page.locator('label.choice:has(input[name=heure][value="19:30"])').click();
  await page.getByLabel('Nom').fill('Test Démo');
  await page.getByLabel('Téléphone').fill('0690 00 00 00');
  await page.getByLabel('Email').fill('demo@exemple');
  await page.getByLabel('Email').blur();
  await page.getByLabel(/J'accepte/).check();
  await page.getByRole('button', { name: 'Confirmer la réservation' }).click();
  assert.match(await page.locator('#err-email').textContent(), /Adresse email invalide/);

  await page.getByLabel('Email').fill('demo@exemple.fr');
  assert.match(await page.locator('[data-summary-time]').textContent(), /19h30/);
  await Promise.all([page.waitForURL(/\/reservation\/[\w-]{43}\?nouvelle=1/), page.getByRole('button', { name: 'Confirmer la réservation' }).click()]);
  assert.match(await page.locator('h1').textContent(), /Votre table est réservée/);
  assert.match(await page.locator('.notice').first().textContent(), /demo@exemple\.fr/);
  assert.match(await page.locator('.recap').textContent(), /19h30/);

  // Annulation en deux temps (sans JavaScript nécessaire)
  await page.getByText('Annuler la réservation').click();
  await Promise.all([page.waitForURL(/annulee=1/), page.getByRole('button', { name: 'Oui, annuler' }).click()]);
  assert.match(await page.locator('.notice').first().textContent(), /annulée/);
  assert.equal(await page.getByText('Annuler la réservation').count(), 0);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('réservation sans JavaScript : le bouton « Voir les horaires » fonctionne', async () => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: VIEWPORTS.mobile });
  const page = await ctx.newPage();
  await page.goto(base + '/reserver');
  const value = await page.locator('.day-strip input[name=date]:not([disabled])').nth(1).getAttribute('value');
  await page.locator(`.day-strip input[value="${value}"]`).check({ force: true });
  await page.getByRole('button', { name: 'Voir les horaires disponibles' }).click();
  assert.ok(await page.locator('input[name=heure]').count() > 10);
  await ctx.close();
});

test('clavier : lien d\'évitement visible au premier Tab', async () => {
  const { ctx, page } = await open(VIEWPORTS.desktop);
  await page.goto(base + '/');
  await page.keyboard.press('Tab');
  const box = await page.locator('.skip-link').boundingBox();
  assert.ok(box && box.y >= 0, 'le lien « Aller au contenu » apparaît à l\'écran');
  await ctx.close();
});
