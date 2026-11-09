import { pool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { addDays, localNow, isoWeekday } from '../src/domain/schedule.js';
import { outbox } from '../src/mail/index.js';

/** Base de test vide, réglages par défaut. */
export async function resetDb() {
  await migrate({ log: () => {} });
  await pool.query('TRUNCATE reservations, fermetures, admins, session RESTART IDENTITY');
  await pool.query('DELETE FROM reglages');
  await pool.query('INSERT INTO reglages DEFAULT VALUES');
  outbox.length = 0;
}

/** Un jour ouvert (pas un lundi) au moins `minOffset` jours après aujourd'hui. */
export function openDay(minOffset = 2) {
  let d = addDays(localNow().date, minOffset);
  while (isoWeekday(d) === 1) d = addDays(d, 1);
  return d;
}

export function nextMonday() {
  let d = addDays(localNow().date, 1);
  while (isoWeekday(d) !== 1) d = addDays(d, 1);
  return d;
}

export const booking = (over = {}) => ({
  personnes: '2', date: openDay(), heure: '19:30', nom: 'Client Démo', telephone: '0690 00 00 00',
  email: 'client@exemple.fr', remarque: '', consentement: 'oui', ...over,
});

export { outbox };
