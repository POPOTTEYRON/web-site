import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peakOccupancy, fits, slotAvailability } from '../../src/domain/availability.js';
import { RULES, dateProblem } from '../../src/domain/schedule.js';

const D = 90;

test('salle vide : tout tient jusqu\'à la capacité', () => {
  assert.equal(peakOccupancy([], 19 * 60, D), 0);
  assert.equal(fits([], '19:00', 36, 36, D), true);
  assert.equal(fits([], '19:00', 37, 36, D), false);
});

test('une table occupe ses couverts pendant 1 h 30', () => {
  const b = [{ heure: '19:00', personnes: 30 }];
  assert.equal(fits(b, '20:00', 8, 36, D), false); // 19h–20h30 chevauche 20h
  assert.equal(fits(b, '20:30', 8, 36, D), true);  // libérée à 20h30
  assert.equal(fits(b, '17:30', 8, 36, D), true);  // 17h30–19h00 : se termine à l'arrivée de 19h
});

test('arrivée plus tôt : les arrivées ultérieures dans l\'intervalle comptent', () => {
  const b = [{ heure: '19:30', personnes: 30 }];
  // 18h30–20h00 recouvre l'arrivée de 19h30
  assert.equal(fits(b, '18:30', 8, 36, D), false);
  assert.equal(fits(b, '18:00', 8, 36, D), true); // 18h–19h30 : se termine à l'arrivée
});

test('pic d\'occupation avec plusieurs réservations décalées', () => {
  const b = [{ heure: '19:00', personnes: 10 }, { heure: '19:30', personnes: 10 }, { heure: '20:00', personnes: 10 }];
  assert.equal(peakOccupancy(b, 19 * 60, D), 30);       // à 20h : les trois
  assert.equal(peakOccupancy(b, 20 * 60 + 30, D), 20);  // 19h30 (jusqu'à 21h) + 20h (jusqu'à 21h30)
});

test('heure hors grille (réservation par téléphone à 19h45)', () => {
  const b = [{ heure: '19:45', personnes: 30 }];
  assert.equal(fits(b, '19:00', 8, 36, D), false);
  assert.equal(fits(b, '21:15', 8, 36, D), true);
});

test('disponibilités : créneaux complets marqués, pas supprimés', () => {
  const now = new Date('2026-11-10T14:00:00Z');
  const slots = slotAvailability({ date: '2026-11-11', party: 4, bookings: [{ heure: '19:30', personnes: 34 }], rules: RULES, closures: new Set(), now });
  const byTime = Object.fromEntries(slots.map((s) => [s.time, s.full]));
  assert.equal(byTime['19:30'], true);
  assert.equal(byTime['18:30'], true);
  assert.equal(byTime['18:00'], false);
  assert.equal(byTime['21:00'], undefined); // hors grille
});

test('fermeture exceptionnelle', () => {
  const now = new Date('2026-11-10T14:00:00Z');
  assert.equal(dateProblem('2026-11-12', now, RULES, new Set(['2026-11-12'])), 'exceptional');
  assert.deepEqual(slotAvailability({ date: '2026-11-12', party: 2, bookings: [], rules: RULES, closures: new Set(['2026-11-12']), now }), []);
});

test('pic à un instant précis (fenêtre de 1 min) : les tables restent comptées 1 h 30', () => {
  const b = [{ heure: '19:00', personnes: 6 }, { heure: '20:00', personnes: 4 }];
  assert.equal(peakOccupancy(b, 20 * 60, 90, 1), 10);
  assert.equal(peakOccupancy(b, 20 * 60 + 30, 90, 1), 4);
});
