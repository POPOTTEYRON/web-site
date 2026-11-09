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

let seq = 0;
/** Données d'une réservation valide ; email unique par appel (sinon : refus pour doublon). */
export const booking = (over = {}) => ({
  personnes: '2', date: openDay(), heure: '19:30', nom: 'Client Démo', telephone: '0690 00 00 00',
  email: `client${++seq}@exemple.fr`, remarque: '', consentement: 'oui', ...over,
});

export { outbox };

/** Insère directement une réservation (dates passées ou du jour, impossibles par le formulaire). */
export async function insertBooking(over = {}) {
  const r = { reference: `T${String(++seq).padStart(7, '0')}`, date: localNow().date, heure: '12:00', personnes: 2,
    nom: 'Client Direct', telephone: '0690000000', email: null, source: 'telephone', statut: 'confirmee', ...over };
  const cols = Object.keys(r);
  const { rows } = await pool.query(
    `INSERT INTO reservations (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id, date`,
    Object.values(r),
  );
  return rows[0];
}
