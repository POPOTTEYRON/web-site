import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { pool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrate.js';

after(() => pool.end());

test('GET /sante répond ok quand la base est joignable', async () => {
  const res = await request(createApp()).get('/sante');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { statut: 'ok' });
});

test('les en-têtes de sécurité sont présents', async () => {
  const res = await request(createApp()).get('/sante');
  assert.ok(res.headers['content-security-policy']);
  assert.equal(res.headers['x-powered-by'], undefined);
});

test('une route inconnue renvoie 404', async () => {
  const res = await request(createApp()).get('/nexiste-pas');
  assert.equal(res.status, 404);
});

test('le migrateur s\'exécute sans erreur (idempotent)', async () => {
  await migrate({ log: () => {} });
  await migrate({ log: () => {} });
  const { rows } = await pool.query("SELECT to_regclass('schema_migrations') AS t");
  assert.equal(rows[0].t, 'schema_migrations');
});
