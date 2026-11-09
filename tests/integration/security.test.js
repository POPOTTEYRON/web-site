// Sécurité et conformité : en-têtes, journaux, configuration de production, conservation des remarques.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { logError } from '../../src/logger.js';
import { purgeExpiredPersonalData } from '../../src/services/retention.js';
import { localNow, addDays } from '../../src/domain/schedule.js';
import { resetDb, insertBooking } from '../helpers.js';

const app = createApp();
beforeEach(resetDb);
after(() => pool.end());

test('en-têtes de sécurité sur toutes les pages', async () => {
  for (const path of ['/', '/reserver', '/admin/connexion', '/inconnu']) {
    const res = await request(app).get(path);
    const csp = res.headers['content-security-policy'];
    assert.match(csp, /default-src 'self'/, path);
    assert.match(csp, /script-src 'self'/, path);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/, path);
    assert.match(csp, /frame-ancestors 'none'/, path);
    assert.match(csp, /form-action 'self'/, path);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', path);
    assert.equal(res.headers['referrer-policy'], 'same-origin', path);
    assert.match(res.headers['permissions-policy'], /camera=\(\).*geolocation=\(\)/, path);
    assert.equal(res.headers['x-powered-by'], undefined, path);
  }
});

test('robots.txt : admin et liens clients exclus de l\'indexation', async () => {
  const res = await request(app).get('/robots.txt');
  assert.equal(res.status, 200);
  assert.match(res.text, /Disallow: \/admin/);
  assert.match(res.text, /Disallow: \/reservation\//);
});

test('journaux : aucune donnée personnelle issue des erreurs PostgreSQL', async () => {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  try {
    await pool.query("INSERT INTO reservations (reference, date, heure, personnes, nom, telephone, email, source) VALUES ('XXXXXXXX', '2026-12-01', '19:00', 0, 'Marie Secret', '0690123456', 'marie@secret.fr', 'telephone')")
      .catch((err) => { assert.match(err.detail, /Marie Secret/, 'PostgreSQL met bien la ligne dans detail'); logError(err, 'test'); });
  } finally { console.error = original; }
  const out = lines.join('\n');
  assert.match(out, /contrainte=reservations_personnes_check/);
  assert.doesNotMatch(out, /Marie Secret|0690123456|marie@secret/);
});

test('journaux : le jeton d\'un lien client n\'apparaît pas dans le chemin journalisé', async () => {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  const realQuery = pool.query.bind(pool);
  pool.query = async () => { throw new Error('base indisponible (simulation)'); };
  try {
    const token = 'A'.repeat(43);
    const res = await request(app).get(`/reservation/${token}`);
    assert.equal(res.status, 500);
    assert.match(res.text, /Une erreur est survenue/);
    assert.doesNotMatch(res.text, /base indisponible|at |\.js:/, 'aucun détail technique montré au visiteur');
    assert.doesNotMatch(lines.join('\n'), new RegExp(token));
  } finally {
    pool.query = realQuery;
    console.error = original;
  }
});

test('remarques (allergies) effacées 30 jours après la réservation, coordonnées conservées', async () => {
  const today = localNow().date;
  await insertBooking({ date: addDays(today, -31), remarque: 'Allergie arachides', statut: 'honoree' });
  await insertBooking({ date: addDays(today, -10), remarque: 'Allergie gluten', statut: 'honoree' });
  const { notes } = await purgeExpiredPersonalData();
  assert.equal(notes, 1);
  const { rows } = await pool.query('SELECT remarque, nom FROM reservations ORDER BY date');
  assert.equal(rows[0].remarque, null);
  assert.equal(rows[0].nom, 'Client Direct');
  assert.equal(rows[1].remarque, 'Allergie gluten');
});

test('formulaire : consentement explicite mentionnant l\'allergie', async () => {
  const day = (await import('../helpers.js')).openDay();
  const res = await request(app).get(`/reserver?personnes=2&date=${day}`);
  assert.match(res.text, /y compris une éventuelle allergie/);
  assert.match(res.text, /effacée 30 jours après votre venue/);
});

// --- Production ---

const prodEnv = (over = {}) => ({
  PATH: process.env.PATH, NODE_ENV: 'production', PORT: '3998',
  PUBLIC_BASE_URL: 'https://timango.example', DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: 'f'.repeat(10) + 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', MAIL_TRANSPORT: 'smtp',
  SMTP_URL: 'smtp://utilisateur:motdepasse@smtp.invalid:587', MAIL_FROM: 'Ti Mango <test@timango.example>', ...over,
});
const loadConfig = (env) => spawnSync(process.execPath, ['-e', "import('./src/config.js').then(() => console.log('OK'))"], { env, encoding: 'utf8' });

test('production : configuration valide acceptée', () => {
  const r = loadConfig(prodEnv());
  assert.equal(r.status, 0, r.stderr);
});

test('production : refuse les emails non envoyés, l\'URL http et un secret factice', () => {
  const mail = loadConfig(prodEnv({ MAIL_TRANSPORT: 'file' }));
  assert.notEqual(mail.status, 0);
  assert.match(mail.stderr, /MAIL_TRANSPORT doit valoir smtp/);
  const http = loadConfig(prodEnv({ PUBLIC_BASE_URL: 'http://timango.example' }));
  assert.match(http.stderr, /doit commencer par https/);
  const secret = loadConfig(prodEnv({ SESSION_SECRET: 'x'.repeat(40) }));
  assert.match(secret.stderr, /valeur aléatoire/);
});

test('production : redirection HTTPS, HSTS, cookie admin Secure (serveur réel)', async () => {
  const child = spawn(process.execPath, ['src/server.js'], { env: { ...prodEnv(), PORT: '3999' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (d) => { if (/localhost:3999/.test(d)) resolve(); });
      child.on('exit', (code) => reject(new Error(`serveur arrêté (${code})`)));
      setTimeout(() => reject(new Error('délai dépassé')), 8000);
    });
    const base = 'http://localhost:3999';
    const plain = await fetch(`${base}/carte`, { redirect: 'manual' });
    assert.equal(plain.status, 301);
    assert.equal(plain.headers.get('location'), 'https://localhost:3999/carte');
    const health = await fetch(`${base}/sante`);
    assert.equal(health.status, 200, 'contrôle de santé de l\'hébergeur sans redirection');
    const https = await fetch(`${base}/carte`, { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(https.status, 200);
    assert.match(https.headers.get('strict-transport-security'), /max-age=\d+/);
    const login = await fetch(`${base}/admin/connexion`, { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.match(login.headers.get('set-cookie'), /; Secure/);
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  } finally {
    child.kill();
  }
});
