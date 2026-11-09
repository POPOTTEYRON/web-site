import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { setTransportForTests } from '../../src/mail/index.js';
import { resetDb, booking, openDay, nextMonday, outbox } from '../helpers.js';

const app = createApp();
before(resetDb);
beforeEach(resetDb);
after(() => pool.end());

const post = (data, path = '/reserver') => request(app).post(path).type('form').send(data);
const count = async () => Number((await pool.query('SELECT count(*) FROM reservations')).rows[0].count);

test('réservation valide : enregistrée, redirection vers la page de gestion, email écrit', async () => {
  const res = await post(booking({ remarque: 'Allergie aux arachides', email: 'client@exemple.fr' }));
  assert.equal(res.status, 303);
  assert.match(res.headers.location, /^\/reservation\/[A-Za-z0-9_-]{43}\?nouvelle=1$/);
  const { rows } = await pool.query('SELECT * FROM reservations');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].statut, 'confirmee');
  assert.equal(rows[0].source, 'en_ligne');
  assert.equal(rows[0].email, 'client@exemple.fr');
  assert.ok(rows[0].consentement_le);
  assert.ok(rows[0].email_envoye_le, 'envoi de l\'email enregistré');
  assert.equal(rows[0].jeton_hash.length, 32, 'seule l\'empreinte SHA-256 du jeton est stockée');

  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, 'client@exemple.fr');
  assert.match(outbox[0].subject, /Réservation confirmée/);
  assert.ok(outbox[0].text.includes(rows[0].reference));
  assert.ok(outbox[0].text.includes(res.headers.location.split('?')[0]), 'le lien de gestion figure dans l\'email');

  const page = await request(app).get(res.headers.location);
  assert.equal(page.status, 200);
  assert.match(page.text, /Votre table est réservée/);
  assert.match(page.text, /Un email de confirmation a été envoyé à client@exemple.fr/);
  assert.ok(page.text.includes(rows[0].reference));
  assert.equal(page.headers['cache-control'], 'no-store');
});

test('réservation en anglais : page et email en anglais', async () => {
  const res = await post(booking(), '/en/book');
  assert.match(res.headers.location, /^\/en\/booking\//);
  assert.match(outbox[0].subject, /Booking confirmed/);
  const page = await request(app).get(res.headers.location);
  assert.match(page.text, /Your table is booked/);
});

test('champs invalides : 422, messages par champ, valeurs conservées, rien d\'enregistré', async () => {
  const res = await post(booking({ nom: '', email: 'demo@exemple', telephone: 'abc', consentement: '' }));
  assert.equal(res.status, 422);
  assert.match(res.text, /id="err-nom"/);
  assert.match(res.text, /id="err-email"[^>]*>Adresse email invalide/);
  assert.match(res.text, /id="err-telephone"/);
  assert.match(res.text, /id="err-consentement"/);
  assert.match(res.text, /value="demo@exemple"/);
  assert.equal(await count(), 0);
  assert.equal(outbox.length, 0);
});

test('les contenus HTML saisis sont échappés à l\'affichage', async () => {
  const res = await post(booking({ nom: '<script>alert(1)</script>', remarque: '<img src=x onerror=alert(1)>' }));
  const page = await request(app).get(res.headers.location);
  assert.doesNotMatch(page.text, /<script>alert/);
  assert.doesNotMatch(page.text, /<img src=x/);
  assert.match(page.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('tentative d\'injection SQL : stockée comme du texte, sans effet', async () => {
  const res = await post(booking({ nom: "Robert'); DROP TABLE reservations;--" }));
  assert.equal(res.status, 303);
  const { rows } = await pool.query('SELECT nom FROM reservations');
  assert.equal(rows[0].nom, "Robert'); DROP TABLE reservations;--");
});

test('règles métier refusées côté serveur, même en contournant le formulaire', async () => {
  assert.equal((await post(booking({ date: nextMonday() }))).status, 422);           // lundi
  assert.equal((await post(booking({ date: '2020-01-07' }))).status, 422);           // passé
  assert.equal((await post(booking({ personnes: '9' }))).status, 422);               // > 8 en ligne
  assert.equal((await post(booking({ heure: '21:00' }))).status, 409);               // hors créneaux
  assert.equal((await post(booking({ heure: '19:15' }))).status, 409);               // hors grille
  assert.equal(await count(), 0);
});

test('fermeture exceptionnelle : réservation refusée', async () => {
  const day = openDay(3);
  await pool.query('INSERT INTO fermetures (date, motif) VALUES ($1, $2)', [day, 'Congés']);
  const res = await post(booking({ date: day }));
  assert.equal(res.status, 422);
  assert.match(res.text, /exceptionnellement fermé/);
  assert.equal(await count(), 0);
});

test('capacité : au-delà de 36 couverts simultanés, le créneau est complet', async () => {
  const day = openDay();
  for (let i = 0; i < 4; i += 1) assert.equal((await post(booking({ date: day, personnes: '8' }))).status, 303); // 32
  const full = await post(booking({ date: day, personnes: '5' }));                                            // 37
  assert.equal(full.status, 409);
  assert.match(full.text, /vient d&#39;être complet/);
  assert.equal((await post(booking({ date: day, personnes: '4' }))).status, 303);                              // 36
  assert.equal((await post(booking({ date: day, personnes: '1', heure: '20:30' }))).status, 409);              // chevauche
  assert.equal((await post(booking({ date: day, personnes: '8', heure: '21:00' }))).status, 409);              // hors grille
  assert.equal((await post(booking({ date: day, personnes: '8', heure: '18:00' }))).status, 303);              // finit à 19h30

  const page = await request(app).get(`/reserver?personnes=2&date=${day}`);
  assert.match(page.text, /value="19:30"[^>]*disabled/);
  assert.match(page.text, /value="12:00"(?![^>]*disabled)/);
});

test('concurrence : 12 demandes simultanées pour les mêmes places → jamais de surréservation', async () => {
  const day = openDay();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => post(booking({ date: day, personnes: '4', email: `c${i}@exemple.fr` }))));
  const ok = results.filter((r) => r.status === 303).length;
  const refused = results.filter((r) => r.status === 409).length;
  assert.equal(ok, 9, '9 × 4 = 36 couverts');
  assert.equal(refused, 3);
  const { rows } = await pool.query('SELECT sum(personnes)::int AS n FROM reservations WHERE date = $1', [day]);
  assert.equal(rows[0].n, 36);
});

test('annulation par le client : statut, email, plus de bouton, place libérée', async () => {
  const day = openDay();
  const res = await post(booking({ date: day, personnes: '8' }));
  const url = res.headers.location.split('?')[0];
  const page = await request(app).get(url);
  assert.match(page.text, /Annuler la réservation/);

  const cancel = await request(app).post(`${url}/annuler`);
  assert.equal(cancel.status, 303);
  assert.equal(cancel.headers.location, `${url}?annulee=1&email=1`);
  const { rows } = await pool.query('SELECT statut, annule_le FROM reservations');
  assert.equal(rows[0].statut, 'annulee_client');
  assert.ok(rows[0].annule_le);
  assert.match(outbox.at(-1).subject, /Réservation annulée/);

  const after = await request(app).get(cancel.headers.location);
  assert.match(after.text, /Votre réservation est annulée/);
  assert.doesNotMatch(after.text, /Annuler la réservation/);

  // Deuxième annulation : sans effet, pas de second email
  const n = outbox.length;
  await request(app).post(`${url}/annuler`);
  assert.equal(outbox.length, n);
});

test('lien de gestion inconnu ou malformé : 404, sans fuite', async () => {
  assert.equal((await request(app).get('/reservation/inconnu')).status, 404);
  assert.equal((await request(app).get(`/reservation/${'A'.repeat(43)}`)).status, 404);
  assert.equal((await request(app).post(`/reservation/${'A'.repeat(43)}/annuler`)).status, 404);
});

test('panne d\'email : la réservation reste enregistrée et la page le dit honnêtement', async () => {
  setTransportForTests({ sendMail: async () => { throw new Error('SMTP indisponible'); } });
  const errors = console.error; console.error = () => {};
  try {
    const res = await post(booking());
    assert.equal(res.status, 303);
    const { rows } = await pool.query('SELECT email_envoye_le FROM reservations');
    assert.equal(rows[0].email_envoye_le, null);
    const page = await request(app).get(res.headers.location);
    assert.match(page.text, /n&#39;a pas pu être envoyé/);
  } finally {
    console.error = errors;
    const nodemailer = (await import('nodemailer')).default;
    setTransportForTests(nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' }));
  }
});

test('champ piège rempli (robot) : refusé, rien d\'enregistré', async () => {
  const res = await post(booking({ site_web: 'http://spam.example' }));
  assert.equal(res.status, 400);
  assert.equal(await count(), 0);
});

test('envoi depuis un autre site : refusé (403)', async () => {
  assert.equal((await post(booking()).set('Origin', 'https://pirate.example')).status, 403);
  assert.equal((await post(booking()).set('Origin', 'null')).status, 403);
  assert.equal((await post(booking()).set('Sec-Fetch-Site', 'cross-site')).status, 403);
  assert.equal(await count(), 0);
});

test('envoi depuis le site lui-même : accepté (en-têtes réels d\'un navigateur)', async () => {
  const res = await post(booking()).set('Sec-Fetch-Site', 'same-origin').set('Origin', 'http://127.0.0.1');
  assert.equal(res.status, 303);
});

test('politique de référent : same-origin (le lien de gestion ne fuit pas vers un tiers)', async () => {
  const res = await request(app).get('/');
  assert.equal(res.headers['referrer-policy'], 'same-origin');
});

test('limitation de débit : la 11e réservation en 15 min depuis la même adresse est refusée', async () => {
  const limited = createApp({ rateLimit: true });
  const day = openDay(5);
  for (let i = 0; i < 10; i += 1) await request(limited).post('/reserver').type('form').send(booking({ date: day, personnes: '1', heure: '12:00' }));
  const res = await request(limited).post('/reserver').type('form').send(booking({ date: day, personnes: '1', heure: '12:00' }));
  assert.equal(res.status, 429);
  assert.match(res.text, /Trop de tentatives/);
});

test('email : ordre des blocs (consigne avant la signature), version HTML échappée', async () => {
  await post(booking({ nom: 'A <b>B</b>' }));
  const m = outbox[0];
  assert.ok(m.text.indexOf('Merci de nous prévenir') < m.text.indexOf('À bientôt'));
  assert.match(m.html, /A &lt;b&gt;B&lt;\/b&gt;/);
  assert.match(m.text, /entreprise fictive/);
});
