import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { pool, transaction } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrate.js';
import * as repo from '../../src/db/repo.js';
import { cutoffDate, purgeExpiredPersonalData } from '../../src/services/retention.js';
import { createApp } from '../../src/app.js';
import { localNow, addDays } from '../../src/domain/schedule.js';
import { resetDb, booking, openDay } from '../helpers.js';

beforeEach(resetDb);
after(() => pool.end());

const base = {
  reference: 'ABCDEFGH', date: '2026-12-01', heure: '19:00', personnes: 2, nom: 'Test', telephone: '0690000000',
  email: 'a@b.fr', remarque: null, langue: 'fr', source: 'en_ligne', jeton_hash: Buffer.alloc(32, 1), consentement_le: new Date(),
};
async function insert(over = {}) {
  const r = { ...base, ...over };
  const cols = Object.keys(r);
  await pool.query(`INSERT INTO reservations (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(r));
}
const rejects = (over, name) => assert.rejects(insert(over), (err) => {
  assert.equal(err.code, '23514', `contrainte attendue pour ${JSON.stringify(over)}, obtenu ${err.code} ${err.message}`);
  if (name) assert.equal(err.constraint, name);
  return true;
});

test('migrations : 001 et 002 appliquées, une seule fois', async () => {
  const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY name');
  assert.deepEqual(rows.map((r) => r.name), ['001_init.sql', '002_conservation.sql']);
});

test('migration en échec : annulée entièrement, non enregistrée', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
  await writeFile(path.join(dir, '900_test.sql'), 'CREATE TABLE essai_migration (id int); SELECT * FROM table_inexistante;');
  await assert.rejects(migrate({ dir, log: () => {} }), /échec de 900_test\.sql/);
  const { rows } = await pool.query("SELECT to_regclass('essai_migration') AS t, (SELECT count(*) FROM schema_migrations WHERE name = '900_test.sql')::int AS n");
  assert.equal(rows[0].t, null, 'la table créée avant l\'erreur a été annulée');
  assert.equal(rows[0].n, 0);
  await rm(dir, { recursive: true });
});

test('contraintes : une ligne valide passe', async () => {
  await insert();
});

test('contraintes : valeurs invalides refusées par la base elle-même', async () => {
  await rejects({ personnes: 0 });
  await rejects({ reference: 'abc' });
  await rejects({ nom: '' });
  await rejects({ telephone: '123' });
  await rejects({ email: 'Majuscules@Exemple.fr' });
  await rejects({ email: 'pas-un-email' });
  await rejects({ langue: 'de' });
  await rejects({ source: 'web' });
  await rejects({ remarque: 'x'.repeat(501) });
});

test('contraintes : réservation en ligne sans email, jeton ou consentement refusée', async () => {
  await rejects({ email: null }, 'reservation_en_ligne_complete');
  await rejects({ jeton_hash: null }, 'reservation_en_ligne_complete');
  await rejects({ consentement_le: null }, 'reservation_en_ligne_complete');
  await insert({ source: 'telephone', email: null, jeton_hash: null, consentement_le: null });
});

test('contraintes : statut annulé ⇔ date d\'annulation', async () => {
  await rejects({ statut: 'annulee_client' }, 'reservation_annulation_coherente');
  await rejects({ annule_le: new Date() }, 'reservation_annulation_coherente');
});

test('contraintes : coordonnées absentes seulement si anonymisée, et anonymisée = vide', async () => {
  await rejects({ nom: null }, 'reservation_coordonnees_presentes');
  await rejects({ anonymise_le: new Date() }, 'reservation_anonymisee_vide');
});

test('unicité : référence et jeton', async () => {
  await insert();
  await assert.rejects(insert({ jeton_hash: Buffer.alloc(32, 2) }), (e) => e.code === '23505');
  await assert.rejects(insert({ reference: 'ZZZZZZZZ' }), (e) => e.code === '23505');
});

test('réglages : une seule ligne, valeurs incohérentes refusées', async () => {
  await assert.rejects(pool.query('INSERT INTO reglages (id) VALUES (2)'), (e) => e.code === '23514');
  await assert.rejects(pool.query('UPDATE reglages SET capacite_en_ligne = 40, capacite_salle = 30'), (e) => e.code === '23514');
  await assert.rejects(pool.query('UPDATE reglages SET personnes_max_en_ligne = 30, capacite_en_ligne = 20'), (e) => e.code === '23514');
  await assert.rejects(pool.query('UPDATE reglages SET intervalle_min = 20'), (e) => e.code === '23514');
});

test('déclencheur : modifie_le mis à jour à chaque modification', async () => {
  await insert();
  const before = (await pool.query('SELECT modifie_le FROM reservations')).rows[0].modifie_le;
  await new Promise((r) => setTimeout(r, 20));
  await pool.query("UPDATE reservations SET remarque = 'x'");
  const afterUpdate = (await pool.query('SELECT modifie_le FROM reservations')).rows[0].modifie_le;
  assert.ok(afterUpdate > before);
});

test('lecture : dates et heures renvoyées sans décalage de fuseau', async () => {
  await insert({ date: '2026-12-31', heure: '23:30' });
  const { rows } = await pool.query('SELECT date, heure FROM reservations');
  assert.equal(rows[0].date, '2026-12-31');
  assert.equal(rows[0].heure, '23:30');
});

test('transaction : une erreur annule toutes les écritures', async () => {
  await assert.rejects(transaction(async (db) => {
    await repo.addClosure({ date: '2026-12-24', motif: 'Réveillon' }, db);
    throw new Error('panne');
  }));
  assert.equal((await repo.getClosures('2026-01-01', '2027-01-01')).length, 0);
});

test('anonymisation : coordonnées effacées, activité conservée, lien client invalidé', async () => {
  const app = createApp();
  const day = openDay();
  const res = await request(app).post('/reserver').type('form').send(booking({ date: day, remarque: 'Allergie' }));
  const { rows: [r] } = await pool.query('SELECT id FROM reservations');
  // Réservation à venir encore confirmée : refusé (il faut d'abord l'annuler).
  assert.equal(await repo.anonymizeReservation(r.id, localNow().date), false);
  await pool.query("UPDATE reservations SET statut = 'annulee_client', annule_le = now()");
  assert.equal(await repo.anonymizeReservation(r.id, localNow().date), true);
  const { rows: [after] } = await pool.query('SELECT * FROM reservations');
  for (const col of ['nom', 'telephone', 'email', 'remarque', 'jeton_hash']) assert.equal(after[col], null, col);
  assert.equal(after.personnes, 2);
  assert.equal(after.date, day);
  assert.ok(after.anonymise_le);
  assert.equal((await request(app).get(res.headers.location.split('?')[0])).status, 404);
  assert.equal(await repo.anonymizeReservation(r.id, localNow().date), false, 'déjà anonymisée');
});

test('date limite de conservation : calcul en mois calendaires', () => {
  assert.equal(cutoffDate('2026-11-09', 12), '2025-11-09');
  assert.equal(cutoffDate('2026-03-31', 1), '2026-02-28');
  assert.equal(cutoffDate('2028-03-31', 1), '2028-02-29');
  assert.equal(cutoffDate('2026-01-15', 3), '2025-10-15');
});

test('purge : seules les réservations au-delà de la durée de conservation sont anonymisées', async () => {
  const today = localNow().date;
  await insert({ reference: 'AAAAAAAA', date: addDays(today, -400), jeton_hash: Buffer.alloc(32, 3) });
  await insert({ reference: 'BBBBBBBB', date: addDays(today, -100), jeton_hash: Buffer.alloc(32, 4) });
  await pool.query('UPDATE reglages SET conservation_mois = 12');
  const { count } = await purgeExpiredPersonalData();
  assert.equal(count, 1);
  const { rows } = await pool.query('SELECT reference, nom FROM reservations ORDER BY reference');
  assert.equal(rows[0].nom, null);
  assert.equal(rows[1].nom, 'Test');
  assert.equal((await purgeExpiredPersonalData()).count, 0, 'idempotent');
  await pool.query('UPDATE reglages SET conservation_mois = 3');
  assert.equal((await purgeExpiredPersonalData()).count, 1);
});

test('index : la requête de capacité peut utiliser l\'index partiel', async () => {
  const client = await pool.connect();
  try {
    await client.query('SET enable_seqscan = off');
    const { rows } = await client.query(
      "EXPLAIN SELECT heure, personnes FROM reservations WHERE date = '2026-12-01' AND statut = ANY(ARRAY['confirmee','honoree']::statut_reservation[])",
    );
    assert.match(rows.map((r) => r['QUERY PLAN']).join('\n'), /reservations_date_actives/);
  } finally {
    await client.query('RESET enable_seqscan');
    client.release();
  }
});
