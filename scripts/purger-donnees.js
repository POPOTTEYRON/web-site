// Anonymise les réservations dont la durée de conservation est dépassée.
// Usage : npm run donnees:purger  (le serveur le fait aussi automatiquement une fois par jour)
import { purgeExpiredPersonalData } from '../src/services/retention.js';
import { pool } from '../src/db/pool.js';

const { before, count, notes } = await purgeExpiredPersonalData();
console.log(`${count} réservation(s) antérieure(s) au ${before} anonymisée(s), ${notes} remarque(s) de plus de 30 jours effacée(s).`);
await pool.end();
