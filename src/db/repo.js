// Accès aux données. Toutes les requêtes sont paramétrées.
import { pool } from './pool.js';
import { rulesFromRow } from '../domain/schedule.js';
import { ACTIVE_STATUSES } from '../domain/availability.js';

export async function getRules(db = pool) {
  const { rows } = await db.query('SELECT * FROM reglages WHERE id = 1');
  return rulesFromRow(rows[0]);
}
export async function getSettingsRow(db = pool) {
  return (await db.query('SELECT * FROM reglages WHERE id = 1')).rows[0];
}
export async function updateSettings(s, db = pool) {
  await db.query(
    `UPDATE reglages SET capacite_en_ligne=$1, capacite_salle=$2, duree_table_min=$3, intervalle_min=$4,
       delai_min_min=$5, jours_max=$6, personnes_max_en_ligne=$7, modifie_le=now() WHERE id = 1`,
    [s.capacite_en_ligne, s.capacite_salle, s.duree_table_min, s.intervalle_min, s.delai_min_min, s.jours_max, s.personnes_max_en_ligne],
  );
}

export async function getClosures(from, to, db = pool) {
  const { rows } = await db.query('SELECT date, motif FROM fermetures WHERE date BETWEEN $1 AND $2 ORDER BY date', [from, to]);
  return rows;
}
export const closureSet = (rows) => new Set(rows.map((r) => r.date));
export async function addClosure({ date, motif }, db = pool) {
  await db.query('INSERT INTO fermetures (date, motif) VALUES ($1, $2) ON CONFLICT (date) DO UPDATE SET motif = EXCLUDED.motif', [date, motif]);
}
export async function removeClosure(date, db = pool) {
  await db.query('DELETE FROM fermetures WHERE date = $1', [date]);
}

/** Réservations actives d'une date (pour le calcul de capacité). */
export async function activeBookings(date, db = pool) {
  const { rows } = await db.query(
    'SELECT heure, personnes FROM reservations WHERE date = $1 AND statut = ANY($2::statut_reservation[])',
    [date, ACTIVE_STATUSES],
  );
  return rows;
}

/** Verrou transactionnel par date : sérialise les créations de réservation d'un même jour. */
export async function lockDate(date, db) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('reservation:' || $1))", [date]);
}

const COLUMNS = `id, reference, date, heure, personnes, nom, telephone, email, remarque, langue, statut, source,
  email_envoye_le, annule_le, cree_le`;

export async function insertReservation(r, db) {
  const { rows } = await db.query(
    `INSERT INTO reservations (reference, date, heure, personnes, nom, telephone, email, remarque, langue, source, jeton_hash, consentement_le)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${COLUMNS}`,
    [r.reference, r.date, r.heure, r.personnes, r.nom, r.telephone, r.email, r.remarque, r.langue, r.source, r.jetonHash, r.consentementLe],
  );
  return rows[0];
}

export async function findByTokenHash(hash, db = pool) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM reservations WHERE jeton_hash = $1`, [hash]);
  return rows[0] ?? null;
}
export async function findById(id, db = pool) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM reservations WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function markEmailSent(id, db = pool) {
  await db.query('UPDATE reservations SET email_envoye_le = now() WHERE id = $1', [id]);
}

/** Change le statut. Renvoie la réservation mise à jour, ou null si la transition n'est pas permise. */
export async function setStatus(id, statut, allowedFrom, db = pool) {
  const cancelled = statut === 'annulee_client' || statut === 'annulee_restaurant';
  const { rows } = await db.query(
    `UPDATE reservations SET statut = $2, modifie_le = now(),
       annule_le = CASE WHEN $3 THEN now() ELSE NULL END
     WHERE id = $1 AND statut = ANY($4::statut_reservation[]) RETURNING ${COLUMNS}`,
    [id, statut, cancelled, allowedFrom],
  );
  return rows[0] ?? null;
}

export async function reservationsForDay(date, db = pool) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM reservations WHERE date = $1 ORDER BY heure, cree_le`, [date]);
  return rows;
}

export async function dailyTotals(from, to, db = pool) {
  const { rows } = await db.query(
    `SELECT date, count(*)::int AS reservations, sum(personnes)::int AS couverts
     FROM reservations WHERE date BETWEEN $1 AND $2 AND statut = ANY($3::statut_reservation[])
     GROUP BY date ORDER BY date`,
    [from, to, ACTIVE_STATUSES],
  );
  return rows;
}

export async function findAdminByEmail(email, db = pool) {
  const { rows } = await db.query('SELECT id, email, mot_de_passe_hash FROM admins WHERE email = $1', [email]);
  return rows[0] ?? null;
}
export async function touchAdminLogin(id, db = pool) {
  await db.query('UPDATE admins SET derniere_connexion = now() WHERE id = $1', [id]);
}
export async function upsertAdmin(email, hash, db = pool) {
  await db.query(
    'INSERT INTO admins (email, mot_de_passe_hash) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET mot_de_passe_hash = EXCLUDED.mot_de_passe_hash',
    [email, hash],
  );
}
