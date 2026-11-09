import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { ROUTES } from '../../src/i18n/routes.js';
import { menu } from '../../src/content.js';
import { addDays, localNow } from '../../src/domain/schedule.js';

after(() => pool.end());
const app = createApp();

for (const [key, r] of Object.entries(ROUTES)) {
  for (const lang of ['fr', 'en']) {
    test(`${key} (${lang}) : 200, langue, liens alternatifs`, async () => {
      const res = await request(app).get(r[lang]);
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /text\/html/);
      assert.match(res.text, new RegExp(`<html lang="${lang}">`));
      assert.match(res.text, /hreflang="fr"/);
      assert.match(res.text, /hreflang="en"/);
      const other = lang === 'fr' ? 'en' : 'fr';
      assert.ok(res.text.includes(`href="${r[other]}" hreflang="${other}"`), 'le sélecteur pointe vers la même page dans l\'autre langue');
    });
  }
}

test('la carte affiche tous les plats et prix du fichier content/menu.json', async () => {
  const res = await request(app).get('/carte');
  for (const c of menu.categories) {
    for (const d of c.plats) {
      assert.ok(res.text.includes(d.nom.fr.replace(/'/g, '&#39;')), d.nom.fr);
      assert.match(res.text, new RegExp(`${d.prix}\\s€`));
    }
  }
  assert.match(res.text, /exemples à valider/);
  assert.match(res.text, /L&#39;abus d&#39;alcool/);
});

test('la carte anglaise est traduite', async () => {
  const res = await request(app).get('/en/menu');
  assert.match(res.text, /Chicken colombo/);
  assert.match(res.text, /€18/);
});

test('réserver : un lundi est refusé avec un message clair', async () => {
  let d = addDays(localNow().date, 1);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
  const res = await request(app).get(`/reserver?personnes=2&date=${d}`);
  assert.match(res.text, /fermé ce jour-là/);
  assert.doesNotMatch(res.text, /name="heure"/);
});

test('réserver : une date passée est refusée', async () => {
  const res = await request(app).get('/reserver?personnes=2&date=2020-01-07');
  assert.match(res.text, /Cette date est passée/);
});

test('réserver : un nombre de personnes hors limites est signalé', async () => {
  const res = await request(app).get('/reserver?personnes=12');
  assert.match(res.text, /entre 1 et 8 personnes/);
});

test('réserver : un jour ouvert propose des créneaux et le formulaire de coordonnées', async () => {
  let d = addDays(localNow().date, 2);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() === 1) d = addDays(d, 1);
  const res = await request(app).get(`/reserver?personnes=4&date=${d}`);
  assert.match(res.text, /name="heure" value="11:30"/);
  assert.match(res.text, /name="heure" value="20:30"/);
  assert.doesNotMatch(res.text, /value="21:00"/);
  assert.match(res.text, /name="consentement"/);
});

test('réserver : avec deux champs date, la dernière valeur non vide l\'emporte', async () => {
  const d = addDays(localNow().date, 3);
  const res = await request(app).get(`/reserver?personnes=2&date=&date=${d}`);
  assert.match(res.text, new RegExp(`name="date" value="${d}"`));
});

test('404 localisée', async () => {
  const fr = await request(app).get('/nexiste-pas');
  assert.equal(fr.status, 404);
  assert.match(fr.text, /Page introuvable/);
  const en = await request(app).get('/en/nope');
  assert.match(en.text, /Page not found/);
});

test('pages : aucune ressource externe (polices, scripts, styles)', async () => {
  const res = await request(app).get('/');
  assert.doesNotMatch(res.text, /<script[^>]+src="https?:\/\//);
  assert.doesNotMatch(res.text, /<link[^>]+rel="(stylesheet|preload|icon)"[^>]+href="https?:\/\//);
  const css = await request(app).get('/css/site.css');
  assert.doesNotMatch(css.text, /url\(['"]?https?:/);
});

test('fichiers statiques servis', async () => {
  for (const f of ['/css/site.css', '/js/site.js', '/js/boot.js', '/fonts/fraunces-latin.woff2', '/img/favicon.svg']) {
    const res = await request(app).get(f);
    assert.equal(res.status, 200, f);
  }
});
