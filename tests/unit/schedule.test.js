import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localNow, isoWeekday, isValidDate, dateProblem, slotsFor, todayStatus, nextDays, addDays } from '../../src/domain/schedule.js';

// 2026-11-10 est un mardi. Guadeloupe = UTC−4.
const at = (iso) => new Date(iso);

test('heure locale de Guadeloupe (UTC−4)', () => {
  assert.deepEqual(localNow(at('2026-11-10T03:30:00Z')), { date: '2026-11-09', minutes: 23 * 60 + 30 });
  assert.deepEqual(localNow(at('2026-11-10T15:00:00Z')), { date: '2026-11-10', minutes: 11 * 60 });
});

test('jour ISO et validation des dates', () => {
  assert.equal(isoWeekday('2026-11-09'), 1);
  assert.equal(isoWeekday('2026-11-15'), 7);
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('2026-11-10'), true);
  assert.equal(isValidDate('10/11/2026'), false);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('dates non réservables', () => {
  const now = at('2026-11-10T14:00:00Z'); // mardi 10h locale
  assert.equal(dateProblem('2026-11-09', now), 'past');
  assert.equal(dateProblem('2026-11-16', now), 'closed'); // lundi
  assert.equal(dateProblem(addDays('2026-11-10', 61), now), 'too_far');
  assert.equal(dateProblem('pas-une-date', now), 'invalid');
  assert.equal(dateProblem('2026-11-11', now), null);
});

test('créneaux d\'un jour futur : 11h30 à 20h30 toutes les 30 min', () => {
  const slots = slotsFor('2026-11-11', at('2026-11-10T14:00:00Z'));
  assert.equal(slots[0], '11:30');
  assert.equal(slots.at(-1), '20:30');
  assert.equal(slots.length, 19);
});

test('créneaux du jour même : au moins 1 h de délai', () => {
  const slots = slotsFor('2026-11-10', at('2026-11-10T22:10:00Z')); // 18h10 locale
  assert.equal(slots[0], '19:30');
  assert.deepEqual(slotsFor('2026-11-10', at('2026-11-11T00:00:00Z')), []); // 20h locale → plus rien
});

test('lundi : aucun créneau', () => {
  assert.deepEqual(slotsFor('2026-11-16', at('2026-11-10T14:00:00Z')), []);
});

test('statut ouvert / fermé', () => {
  assert.equal(todayStatus(at('2026-11-10T16:00:00Z')).open, true);          // mardi 12h
  assert.equal(todayStatus(at('2026-11-10T14:00:00Z')).later, true);        // mardi 10h
  assert.equal(todayStatus(at('2026-11-11T02:30:00Z')).open, false);         // mardi 22h30
  assert.equal(todayStatus(at('2026-11-09T16:00:00Z')).closedToday, true);   // lundi
});

test('raccourcis de dates : 7 jours, lundi marqué fermé', () => {
  const days = nextDays(7, at('2026-11-08T16:00:00Z')); // dimanche
  assert.equal(days.length, 7);
  assert.equal(days[0].isToday, true);
  assert.equal(days[1].closed, true);
  assert.equal(days.filter((d) => d.closed).length, 1);
});
