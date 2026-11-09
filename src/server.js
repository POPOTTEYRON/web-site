import { config } from './config.js';
import { createApp } from './app.js';
import { purgeExpiredPersonalData } from './services/retention.js';
import { logError } from './logger.js';

createApp().listen(config.PORT, () => {
  console.log(`Ti Mango — http://localhost:${config.PORT} (${config.NODE_ENV})`);
});

// Anonymisation des données expirées : au démarrage puis toutes les 24 h.
async function purge() {
  try {
    const { before, count, notes } = await purgeExpiredPersonalData();
    if (count) console.log(`[conservation] ${count} réservation(s) antérieure(s) au ${before} anonymisée(s)`);
    if (notes) console.log(`[conservation] ${notes} remarque(s) de plus de 30 jours effacée(s)`);
  } catch (err) {
    logError(err, '[conservation]');
  }
}
purge();
setInterval(purge, 24 * 3600 * 1000).unref();
