import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { hash } from '@node-rs/argon2';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { upsertAdmin } from '../../src/db/repo.js';
import { resetDb, booking, openDay, nextMonday, outbox } from '../helpers.js';

const app = createApp();
const EMAIL = 'gerant@timango-gp.example';
const PASSWORD = 'motdepasse-de-test-123';
let passwordHash;

before(async () => { passwordHash = await hash(PASSWORD); });
beforeEach(async () => { await resetDb(); await upsertAdmin(EMAIL, passwordHash); });
after(() => pool.end());

const csrfFrom = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];

/** Agent connecté + jeton CSRF. */
async function login() {
  const agent = request.agent(app);
  const page = await agent.get('/admin/connexion');
  const res = await agent.post('/admin/connexion').type('form').send({ _csrf: csrfFrom(page.text), email: EMAIL, mot_de_passe: PASSWORD, suite: '/admin' });
  assert.equal(res.status, 303);
  const home = await agent.get('/admin');
  return { agent, csrf: csrfFrom(home.text) };
}

test('pages admin inaccessibles sans connexion', async () => {
  for (const path of ['/admin', '/admin/planning', '/admin/nouvelle', '/admin/reglages']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 303, path);
    assert.match(res.headers.location, /^\/admin\/connexion/);
  }
});

test('le site public ne dépose aucun cookie', async () => {
  for (const path of ['/', '/carte', '/reserver']) {
    const res = await request(app).get(path);
    assert.equal(res.headers['set-cookie'], undefined, path);
  }
});

test('connexion : cookie de session sécurisé, mauvais mot de passe refusé', async () => {
  const agent = request.agent(app);
  const page = await agent.get('/admin/connexion');
  const cookie = page.headers['set-cookie'][0];
  assert.match(cookie, /tm_admin=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/admin/);
  const csrf = csrfFrom(page.text);
  const bad = await agent.post('/admin/connexion').type('form').send({ _csrf: csrf, email: EMAIL, mot_de_passe: 'faux-mot-de-passe' });
  assert.equal(bad.status, 401);
  assert.match(bad.text, /Email ou mot de passe incorrect/);
  const unknown = await agent.post('/admin/connexion').type('form').send({ _csrf: csrf, email: 'inconnu@exemple.fr', mot_de_passe: PASSWORD });
  assert.equal(unknown.status, 401);
  assert.match(unknown.text, /Email ou mot de passe incorrect/, 'même message : on ne révèle pas si le compte existe');
});

test('la session change d\'identifiant à la connexion (anti-fixation)', async () => {
  const agent = request.agent(app);
  const page = await agent.get('/admin/connexion');
  const before = page.headers['set-cookie'][0].split(';')[0];
  const res = await agent.post('/admin/connexion').type('form').send({ _csrf: csrfFrom(page.text), email: EMAIL, mot_de_passe: PASSWORD });
  const afterCookie = res.headers['set-cookie'][0].split(';')[0];
  assert.notEqual(before, afterCookie);
});

test('CSRF : un envoi sans jeton valide est refusé', async () => {
  const { agent } = await login();
  const res = await agent.post('/admin/reglages').type('form').send({ capacite_en_ligne: '1' });
  assert.equal(res.status, 403);
});

test('redirection après connexion : uniquement vers l\'admin', async () => {
  const agent = request.agent(app);
  const page = await agent.get('/admin/connexion');
  const res = await agent.post('/admin/connexion').type('form').send({ _csrf: csrfFrom(page.text), email: EMAIL, mot_de_passe: PASSWORD, suite: 'https://pirate.example' });
  assert.equal(res.headers.location, '/admin');
});

test('vue du jour : réservations, totaux, remarques', async () => {
  const day = openDay();
  await request(app).post('/reserver').type('form').send(booking({ date: day, personnes: '3', heure: '12:00', remarque: 'Chaise haute' }));
  await request(app).post('/reserver').type('form').send(booking({ date: day, personnes: '5', heure: '19:30' }));
  const { agent } = await login();
  const res = await agent.get(`/admin?date=${day}`);
  assert.equal(res.status, 200);
  assert.match(res.text, /<dd>2<\/dd>/);
  assert.match(res.text, /<dd>8<\/dd>/);
  assert.match(res.text, /Chaise haute/);
  assert.match(res.text, /Midi/);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('changement de statut : honorée, absent, annulation par le restaurant avec email', async () => {
  const day = openDay();
  await request(app).post('/reserver').type('form').send(booking({ date: day }));
  const { rows: [r] } = await pool.query('SELECT id FROM reservations');
  const { agent, csrf } = await login();
  const set = (statut) => agent.post(`/admin/reservations/${r.id}/statut`).type('form').send({ _csrf: csrf, statut });
  const status = async () => (await pool.query('SELECT statut FROM reservations')).rows[0].statut;

  assert.equal((await set('honoree')).status, 303); assert.equal(await status(), 'honoree');
  await set('absent'); assert.equal(await status(), 'absent');
  await set('confirmee'); assert.equal(await status(), 'confirmee');
  const n = outbox.length;
  const res = await set('annulee_restaurant');
  assert.match(res.headers.location, /ok=annulee_email/);
  assert.equal(await status(), 'annulee_restaurant');
  assert.equal(outbox.length, n + 1);
  assert.match(outbox.at(-1).text, /nous avons dû annuler/);
  // Une réservation annulée ne peut pas être rétablie (la place a pu être reprise).
  const back = await set('confirmee');
  assert.match(back.headers.location, /ok=refuse/);
  assert.equal(await status(), 'annulee_restaurant');
  assert.equal((await set('nimporte')).status, 400);
});

test('réservation par téléphone : capacité de la salle (42), pas la limite en ligne', async () => {
  const day = openDay();
  const { agent, csrf } = await login();
  const add = (over) => agent.post('/admin/nouvelle').type('form').send({ _csrf: csrf, date: day, heure: '19:45', personnes: '20', nom: 'Groupe', telephone: '0590 11 22 33', email: '', ...over });
  assert.equal((await add({})).status, 303);
  assert.equal((await add({ personnes: '22' })).status, 303);    // 42 : plein
  const full = await add({ personnes: '1' });
  assert.equal(full.status, 409);
  assert.match(full.text, /Capacité de la salle dépassée/);
  const { rows } = await pool.query("SELECT source, email, jeton_hash FROM reservations WHERE source = 'telephone'");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].email, null);
  assert.equal(rows[0].jeton_hash, null);
  assert.equal(outbox.length, 0, 'sans email, aucun message');
  // En ligne : plus aucune place à 19h30 ce jour-là
  assert.equal((await request(app).post('/reserver').type('form').send(booking({ date: day }))).status, 409);
});

test('réservation par téléphone : validations (lundi, hors horaires, champs)', async () => {
  const { agent, csrf } = await login();
  const add = (over) => agent.post('/admin/nouvelle').type('form').send({ _csrf: csrf, date: openDay(), heure: '19:00', personnes: '2', nom: 'X', telephone: '0590112233', ...over });
  assert.match((await add({ date: nextMonday() })).text, /fermé ce jour-là/);
  assert.match((await add({ heure: '23:00' })).text, /en dehors des horaires/);
  const bad = await add({ nom: '', email: 'pas-un-email' });
  assert.equal(bad.status, 422);
  assert.match(bad.text, /Champ obligatoire/);
  assert.match(bad.text, /Email invalide/);
});

test('réglages : modification prise en compte par la réservation en ligne', async () => {
  const { agent, csrf } = await login();
  const settings = { _csrf: csrf, capacite_en_ligne: '10', capacite_salle: '42', personnes_max_en_ligne: '4', duree_table_min: '90', intervalle_min: '30', delai_min_min: '60', jours_max: '60', conservation_mois: '12' };
  assert.equal((await agent.post('/admin/reglages').type('form').send(settings)).status, 303);
  assert.equal((await request(app).post('/reserver').type('form').send(booking({ personnes: '5' }))).status, 422); // > 4
  assert.equal((await request(app).post('/reserver').type('form').send(booking({ personnes: '4' }))).status, 303);
  assert.equal((await request(app).post('/reserver').type('form').send(booking({ personnes: '4' }))).status, 303);
  assert.equal((await request(app).post('/reserver').type('form').send(booking({ personnes: '4' }))).status, 409); // 12 > 10

  const bad = await agent.post('/admin/reglages').type('form').send({ ...settings, capacite_en_ligne: '50' });
  assert.equal(bad.status, 422);
  const incoherent = await agent.post('/admin/reglages').type('form').send({ ...settings, capacite_en_ligne: '10', personnes_max_en_ligne: '12' });
  assert.equal(incoherent.status, 422);
  assert.match(incoherent.text, /Ne peut pas dépasser la capacité en ligne/);
});

test('fermetures exceptionnelles : ajout, effet, suppression', async () => {
  const day = openDay(4);
  const { agent, csrf } = await login();
  assert.equal((await agent.post('/admin/fermetures').type('form').send({ _csrf: csrf, date: day, motif: 'Privatisation' })).status, 303);
  assert.equal((await request(app).post('/reserver').type('form').send(booking({ date: day }))).status, 422);
  const page = await agent.get('/admin/reglages');
  assert.match(page.text, /Privatisation/);
  await agent.post(`/admin/fermetures/${day}/supprimer`).type('form').send({ _csrf: csrf });
  assert.equal((await request(app).post('/reserver').type('form').send(booking({ date: day }))).status, 303);
  assert.equal((await agent.post('/admin/fermetures').type('form').send({ _csrf: csrf, date: '2020-01-01' })).status, 422);
});

test('déconnexion : la session ne donne plus accès', async () => {
  const { agent, csrf } = await login();
  await agent.post('/admin/deconnexion').type('form').send({ _csrf: csrf });
  const res = await agent.get('/admin');
  assert.equal(res.status, 303);
});

test('connexion : 6e tentative en 15 min bloquée', async () => {
  const limited = createApp({ rateLimit: true });
  const agent = request.agent(limited);
  const csrf = csrfFrom((await agent.get('/admin/connexion')).text);
  for (let i = 0; i < 5; i += 1) await agent.post('/admin/connexion').type('form').send({ _csrf: csrf, email: EMAIL, mot_de_passe: 'faux' });
  const res = await agent.post('/admin/connexion').type('form').send({ _csrf: csrf, email: EMAIL, mot_de_passe: PASSWORD });
  assert.equal(res.status, 429);
});

test('admin : effacement des données personnelles d\'une réservation passée', async () => {
  const { rows: [r] } = await pool.query(
    `INSERT INTO reservations (reference, date, heure, personnes, nom, telephone, source, statut)
     VALUES ('PASSEE01', current_date - 30, '19:00', 2, 'Ancien Client', '0690000000', 'telephone', 'honoree') RETURNING id, date`,
  );
  const { agent, csrf } = await login();
  const day = await agent.get(`/admin?date=${r.date}`);
  assert.match(day.text, /Effacer les données personnelles/);
  const res = await agent.post(`/admin/reservations/${r.id}/anonymiser`).type('form').send({ _csrf: csrf });
  assert.match(res.headers.location, /ok=anonymisee/);
  const page = await agent.get(`/admin?date=${r.date}`);
  assert.doesNotMatch(page.text, /Ancien Client/);
  assert.match(page.text, /Données personnelles effacées/);
});
