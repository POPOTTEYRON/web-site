// Règles métier de bout en bout : cas limites et interactions entre fonctionnalités.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { hash } from '@node-rs/argon2';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { upsertAdmin } from '../../src/db/repo.js';
import { addDays, localNow } from '../../src/domain/schedule.js';
import { resetDb, booking, openDay, outbox, insertBooking } from '../helpers.js';

const app = createApp();
const EMAIL = 'gerant@timango-gp.example';
const PASSWORD = 'motdepasse-de-test-123';
let passwordHash;
before(async () => { passwordHash = await hash(PASSWORD); });
beforeEach(async () => { await resetDb(); await upsertAdmin(EMAIL, passwordHash); });
after(() => pool.end());

const post = (data, path = '/reserver') => request(app).post(path).type('form').send(data);
const csrfFrom = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
async function admin() {
  const agent = request.agent(app);
  const page = await agent.get('/admin/connexion');
  await agent.post('/admin/connexion').type('form').send({ _csrf: csrfFrom(page.text), email: EMAIL, mot_de_passe: PASSWORD });
  return { agent, csrf: csrfFrom((await agent.get('/admin')).text) };
}
const setRules = (over) => pool.query(
  `UPDATE reglages SET ${Object.keys(over).map((k, i) => `${k} = $${i + 1}`).join(', ')}`, Object.values(over),
);

// --- Doubles envois ---

test('double envoi : la même réservation (email, date, heure) n\'est créée qu\'une fois', async () => {
  const data = booking();
  assert.equal((await post(data)).status, 303);
  const again = await post(data);
  assert.equal(again.status, 409);
  assert.match(again.text, /déjà une réservation à cette date et à cette heure/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM reservations')).rows[0].n, 1);
  assert.equal(outbox.length, 1, 'un seul email');
});

test('double envoi simultané (double-clic) : une seule réservation', async () => {
  const data = booking();
  const results = await Promise.all([post(data), post(data), post(data)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [303, 409, 409]);
});

test('même client, autre horaire ou après annulation : autorisé', async () => {
  const data = booking();
  const first = await post(data);
  assert.equal((await post({ ...data, heure: '12:00' })).status, 303);
  await request(app).post(`${first.headers.location.split('?')[0]}/annuler`);
  assert.equal((await post(data)).status, 303, 'le créneau annulé peut être repris');
});

test('message de doublon en anglais', async () => {
  const data = booking();
  await post(data, '/en/book');
  assert.match((await post(data, '/en/book')).text, /already have a booking/);
});

// --- Annulations et capacité ---

test('une annulation libère immédiatement les couverts', async () => {
  const day = openDay();
  const first = await post(booking({ date: day, personnes: '8' }));
  for (let i = 0; i < 3; i += 1) await post(booking({ date: day, personnes: '8' }));
  await post(booking({ date: day, personnes: '4' })); // 36
  assert.equal((await post(booking({ date: day, personnes: '8' }))).status, 409);
  await request(app).post(`${first.headers.location.split('?')[0]}/annuler`);
  assert.equal((await post(booking({ date: day, personnes: '8' }))).status, 303);
});

test('« absent » ne compte plus dans la capacité, « honorée » compte toujours', async () => {
  const today = localNow().date;
  await insertBooking({ date: today, heure: '23:00', personnes: 30, statut: 'absent' });
  await insertBooking({ date: today, heure: '23:00', personnes: 4, statut: 'honoree' });
  const { rows } = await pool.query(
    "SELECT sum(personnes)::int AS n FROM reservations WHERE statut = ANY(ARRAY['confirmee','honoree']::statut_reservation[])",
  );
  assert.equal(rows[0].n, 4);
});

test('annulation client impossible une fois l\'heure passée', async () => {
  const res = await post(booking());
  const url = res.headers.location.split('?')[0];
  await pool.query("UPDATE reservations SET date = current_date - 1");
  const page = await request(app).get(url);
  assert.doesNotMatch(page.text, /Annuler la réservation/);
  assert.match(page.text, /est passée/);
  await request(app).post(`${url}/annuler`);
  assert.equal((await pool.query('SELECT statut FROM reservations')).rows[0].statut, 'confirmee');
});

test('lien client d\'une réservation annulée par le restaurant : consultable, plus annulable', async () => {
  const day = openDay();
  const res = await post(booking({ date: day }));
  const { agent, csrf } = await admin();
  const { rows: [r] } = await pool.query('SELECT id FROM reservations');
  await agent.post(`/admin/reservations/${r.id}/statut`).type('form').send({ _csrf: csrf, statut: 'annulee_restaurant' });
  const page = await request(app).get(res.headers.location.split('?')[0]);
  assert.match(page.text, /Annulée par le restaurant/);
  assert.doesNotMatch(page.text, /Annuler la réservation/);
});

// --- Fermetures exceptionnelles ---

test('fermeture sur un jour déjà réservé : refusée avec la liste des réservations', async () => {
  const day = openDay(3);
  await post(booking({ date: day, nom: 'Client En Ligne' }));
  await insertBooking({ date: day, heure: '12:30', nom: 'Client Téléphone', email: null });
  const { agent, csrf } = await admin();
  const res = await agent.post('/admin/fermetures').type('form').send({ _csrf: csrf, date: day, motif: 'Travaux' });
  assert.equal(res.status, 409);
  assert.match(res.text, /2 réservation\(s\) confirmée\(s\)/);
  assert.match(res.text, /Client Téléphone[^<]*pas d&#39;email : à appeler/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM fermetures')).rows[0].n, 0, 'rien n\'est fermé sans accord');
  assert.equal(outbox.length, 1, 'aucun email d\'annulation envoyé');
});

test('fermeture confirmée : réservations annulées, clients avec email prévenus, les autres signalés', async () => {
  const day = openDay(3);
  await post(booking({ date: day }));
  await insertBooking({ date: day, heure: '12:30', email: null });
  const { agent, csrf } = await admin();
  const res = await agent.post('/admin/fermetures').type('form')
    .send({ _csrf: csrf, date: day, motif: 'Travaux', annuler_reservations: 'oui' });
  assert.equal(res.status, 303);
  assert.match(res.headers.location, /n=2&prevenus=1/);
  const { rows } = await pool.query('SELECT statut FROM reservations');
  assert.ok(rows.every((r) => r.statut === 'annulee_restaurant'));
  assert.match(outbox.at(-1).subject, /annulée/);
  const page = await agent.get(res.headers.location);
  assert.match(page.text, /2 réservation\(s\) annulée\(s\), 1 client\(s\) prévenu\(s\) par email — appelez les autres/);
  assert.equal((await post(booking({ date: day }))).status, 422, 'plus de réservation en ligne ce jour-là');
});

test('fermeture d\'un jour sans réservation confirmée (seulement annulées) : directe', async () => {
  const day = openDay(3);
  const res = await post(booking({ date: day }));
  await request(app).post(`${res.headers.location.split('?')[0]}/annuler`);
  const { agent, csrf } = await admin();
  const close = await agent.post('/admin/fermetures').type('form').send({ _csrf: csrf, date: day });
  assert.match(close.headers.location, /ok=fermeture$/);
});

// --- Réglages modifiés alors que des réservations existent ---

test('capacité réduite sous le niveau déjà réservé : réservations existantes conservées, nouvelles refusées', async () => {
  const day = openDay();
  for (let i = 0; i < 3; i += 1) await post(booking({ date: day, personnes: '8' })); // 24
  await setRules({ capacite_en_ligne: 20, personnes_max_en_ligne: 8 });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM reservations WHERE statut = 'confirmee'")).rows[0].n, 3);
  assert.equal((await post(booking({ date: day, personnes: '1' }))).status, 409);
  assert.equal((await post(booking({ date: day, personnes: '1', heure: '12:00' }))).status, 303, 'le midi reste libre');
});

test('durée de table allongée : les chevauchements sont recalculés', async () => {
  const day = openDay();
  await post(booking({ date: day, personnes: '8', heure: '18:00' }));
  await setRules({ capacite_en_ligne: 10, personnes_max_en_ligne: 8 });
  assert.equal((await post(booking({ date: day, personnes: '8', heure: '19:30' }))).status, 303, '1 h 30 : libéré à 19h30');
  await pool.query("DELETE FROM reservations WHERE heure = '19:30'");
  await setRules({ duree_table_min: 120 });
  assert.equal((await post(booking({ date: day, personnes: '8', heure: '19:30' }))).status, 409, '2 h : encore occupé');
});

test('intervalle de 15 min : créneaux au quart d\'heure, dernière arrivée selon la durée', async () => {
  await setRules({ intervalle_min: 15 });
  const day = openDay();
  const page = await request(app).get(`/reserver?personnes=2&date=${day}`);
  assert.match(page.text, /value="19:15"/);
  assert.match(page.text, /value="20:30"/);
  assert.doesNotMatch(page.text, /value="20:45"/);
  assert.equal((await post(booking({ date: day, heure: '19:15' }))).status, 303);
});

test('horizon réduit : au-delà, la date est refusée', async () => {
  await setRules({ jours_max: 7 });
  const far = openDay(10);
  const res = await post(booking({ date: far }));
  assert.equal(res.status, 422);
  assert.match(res.text, /jusqu&#39;à 7 jours à l&#39;avance/, 'le message reflète le réglage réel');
});

test('délai minimum de 48 h : « aujourd\'hui » affiché comme terminé, demain sans créneau', async () => {
  await setRules({ delai_min_min: 2880 });
  const page = await request(app).get('/reserver');
  const today = localNow().date;
  assert.match(page.text, new RegExp(`value="${today}"[^>]*disabled`));
  assert.match(page.text, /terminé|fermé/);
  const tomorrow = addDays(today, 1);
  const res = await request(app).get(`/reserver?personnes=2&date=${tomorrow}`);
  assert.doesNotMatch(res.text, /name="heure" value="12:00"(?![^>]*disabled)/);
});

test('personnes max en ligne augmenté : le formulaire propose les nouveaux choix', async () => {
  await setRules({ personnes_max_en_ligne: 10 });
  const page = await request(app).get('/reserver');
  assert.match(page.text, /name="personnes" value="10"/);
  assert.match(page.text, /Plus de 10 personnes/);
  assert.equal((await post(booking({ personnes: '10' }))).status, 303);
});

// --- Admin : réservation téléphone et capacité en ligne ---

test('réservations téléphone et en ligne partagent la même salle', async () => {
  const day = openDay();
  const { agent, csrf } = await admin();
  await agent.post('/admin/nouvelle').type('form').send({ _csrf: csrf, date: day, heure: '19:30', personnes: '30', nom: 'Groupe', telephone: '0590112233' });
  assert.equal((await post(booking({ date: day, personnes: '6' }))).status, 303);   // 36 en ligne max
  assert.equal((await post(booking({ date: day, personnes: '1' }))).status, 409);
  const phone = await agent.post('/admin/nouvelle').type('form').send({ _csrf: csrf, date: day, heure: '19:30', personnes: '6', nom: 'Habitué', telephone: '0590112244' });
  assert.equal(phone.status, 303, 'le restaurant peut encore placer 6 personnes (42)');
});
