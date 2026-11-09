import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hoursText, schemaOpeningHours, scheduleGroups } from '../../src/domain/hours.js';
import { formatters } from '../../src/i18n/format.js';

const fr = formatters('fr'); const en = formatters('en');
const REAL = { 1: null, 2: ['11:30', '22:00'], 3: ['11:30', '22:00'], 4: ['11:30', '22:00'], 5: ['11:30', '22:00'], 6: ['11:30', '22:00'], 7: ['11:30', '22:00'] };
// Autre restaurant : fermé dimanche et lundi, samedi en soirée seulement.
const OTHER = { 1: null, 2: ['12:00', '22:00'], 3: ['12:00', '22:00'], 4: ['12:00', '22:00'], 5: ['12:00', '22:00'], 6: ['18:00', '23:00'], 7: null };
const monday = new Date('2026-11-09T16:00:00Z');

test('horaires actuels : textes identiques à la fiche', () => {
  const h = hoursText('fr', fr, monday, REAL);
  assert.equal(h.line, 'Du mardi au dimanche, 11h30 – 22h · fermé le lundi');
  assert.equal(h.short, 'Mar – dim · 11h30 – 22h');
  assert.equal(h.closed, 'Fermé le lundi');
  assert.deepEqual(h.rows, [{ label: 'Lundi', value: null }, { label: 'Mardi – dimanche', value: '11h30 – 22h' }]);
  assert.deepEqual(h.reopens, { day: 'demain', time: '11h30' });
  const e = hoursText('en', en, monday, REAL);
  assert.equal(e.line, 'Tuesday to Sunday, 11:30am – 10pm · closed on Mondays');
  assert.equal(e.short, 'Tue – Sun · 11:30am – 10pm');
});

test('horaires modifiés : tout le texte suit le fichier', () => {
  const h = hoursText('fr', fr, monday, OTHER);
  assert.equal(h.line, 'Du mardi au vendredi, 12h – 22h ; Samedi, 18h – 23h · fermé le lundi et le dimanche');
  assert.equal(h.closed, 'Fermé le lundi et le dimanche');
  assert.equal(h.rows.length, 4);
  assert.deepEqual(hoursText('en', en, monday, OTHER).closed, 'Closed on Mondays and Sundays');
  assert.equal(scheduleGroups(OTHER).length, 4);
  assert.deepEqual(schemaOpeningHours(OTHER).map((s) => [s.dayOfWeek.length, s.opens]), [[4, '12:00'], [1, '18:00']]);
});
