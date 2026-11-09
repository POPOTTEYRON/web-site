// Anonymise les réservations dont la durée de conservation est dépassée.
// Usage : npm run donnees:purger  (le serveur le fait aussi automatiquement une fois par jour)
import { purgeExpiredPersonalData } from '../src/services/retention.js';
import { pool } from '../src/db/pool.js';

const { before, count } = await purgeExpiredPersonalData();
console.log(`${count} réservation(s) antérieure(s) au ${before} anonymisée(s).`);
await pool.end();
