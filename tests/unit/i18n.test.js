import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dict, translator } from '../../src/i18n/index.js';
import { formatters } from '../../src/i18n/format.js';
import { ROUTES } from '../../src/i18n/routes.js';

const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));

test('FR et EN ont exactement les mêmes clés', () => {
  assert.deepEqual(keys(dict.fr).sort(), keys(dict.en).sort());
});

test('une clé manquante lève une erreur explicite', () => {
  assert.throws(() => translator('fr')('nexiste.pas'), /Traduction manquante/);
});

test('chaque page a une URL FR et EN distinctes', () => {
  for (const r of Object.values(ROUTES)) { assert.ok(r.fr && r.en); assert.notEqual(r.fr, r.en); assert.ok(r.en.startsWith('/en/')); }
});

test('formats de prix et d\'heure', () => {
  const fr = formatters('fr'); const en = formatters('en');
  assert.equal(fr.price(8).replace(/\s/g, ' '), '8 €');
  assert.equal(en.price(8), '€8');
  assert.equal(fr.time('19:30'), '19h30');
  assert.equal(fr.time('12:00'), '12h');
  assert.equal(en.time('19:30'), '7:30pm');
  assert.equal(en.time('11:30'), '11:30am');
  assert.equal(en.time('12:00'), '12pm');
});
