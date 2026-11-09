import pg from 'pg';
import { config } from '../config.js';

// Dates et heures renvoyées telles quelles ('YYYY-MM-DD', 'HH:MM') : pas de conversion de fuseau implicite.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1083, (v) => v.slice(0, 5));

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

/** Exécute fn(client) dans une transaction ; annule en cas d'erreur. */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
