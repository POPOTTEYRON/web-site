// Données de démonstration pour le développement : réservations fictives sur 10 jours passés
// et 14 jours à venir, en respectant les règles de capacité, plus une fermeture exceptionnelle.
// Usage : npm run donnees:demo                   (ajoute des données)
//         npm run donnees:demo -- --reinitialiser (vide d'abord réservations et fermetures)
// Aucun email n'est envoyé. Refusé en production.
import { config } from '../src/config.js';
import { transaction, pool } from '../src/db/pool.js';
import * as repo from '../src/db/repo.js';
import { localNow, addDays, slotsFor, openingHours } from '../src/domain/schedule.js';
import { fits } from '../src/domain/availability.js';
import { newToken, hashToken, newReference } from '../src/security.js';
import { manageUrl } from '../src/services/reservations.js';

if (config.isProd) { console.error('Refusé : données de démonstration interdites en production.'); process.exit(1); }

// Générateur pseudo-aléatoire déterministe : mêmes données à chaque exécution.
function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(20261108);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const NOTES = [null, null, null, null, 'Chaise haute', 'Anniversaire', 'Table en terrasse si possible', 'Allergie aux fruits à coque'];

const reset = process.argv.includes('--reinitialiser');
const today = localNow().date;
let n = 0;
let demoLink = null;

await transaction(async (db) => {
  if (reset) await db.query('TRUNCATE reservations, fermetures RESTART IDENTITY');
  const rules = await repo.getRules(db);
  const closureDay = (() => { let d = addDays(today, 10); while (!openingHours(d)) d = addDays(d, 1); return d; })();
  await repo.addClosure({ date: closureDay, motif: 'Démonstration — fermeture exceptionnelle' }, db);

  for (let offset = -10; offset <= 14; offset += 1) {
    const date = addDays(today, offset);
    if (!openingHours(date) || date === closureDay) continue;
    // Créneaux de la grille, sans contrainte de délai (dates passées comprises).
    const grid = slotsFor(date, new Date(`${date}T00:00:00-04:00`), { ...rules, minLeadMin: 0, maxDaysAhead: 400 });
    const bookings = await repo.activeBookings(date, db);
    const wanted = 4 + Math.floor(rand() * 7);
    for (let i = 0; i < wanted; i += 1) {
      const heure = pick(grid.filter((h) => h <= '13:30' || h >= '19:00'));
      const personnes = pick([2, 2, 2, 3, 4, 4, 5, 6, 8]);
      const online = rand() < 0.7;
      if (!fits(bookings, heure, personnes, online ? rules.capacityOnline : rules.capacityRoom, rules.tableDurationMin)) continue;
      n += 1;
      const num = String(n).padStart(3, '0');
      const token = online ? newToken() : null;
      const r = await repo.insertReservation({
        reference: newReference(), date, heure, personnes,
        nom: `Client démo ${num}`, telephone: `0690 00 0${num.slice(0, 1)} ${num.slice(1)}`,
        email: online || rand() < 0.3 ? `demo${num}@timango-demo.example` : null,
        remarque: pick(NOTES), langue: rand() < 0.2 ? 'en' : 'fr',
        source: online ? 'en_ligne' : 'telephone', jetonHash: token ? hashToken(token) : null,
        consentementLe: online ? new Date() : null,
      }, db);
      bookings.push({ heure, personnes });
      if (offset < 0) {
        const s = rand() < 0.88 ? 'honoree' : 'absent';
        await db.query('UPDATE reservations SET statut = $2 WHERE id = $1', [r.id, s]);
      } else if (rand() < 0.08) {
        await db.query("UPDATE reservations SET statut = 'annulee_client', annule_le = now() WHERE id = $1", [r.id]);
      } else if (!demoLink && online && offset >= 2) {
        demoLink = manageUrl(token, r.langue);
      }
    }
  }
});

console.log(`${n} réservation(s) de démonstration créée(s)${reset ? ' (base réinitialisée)' : ''}, une fermeture exceptionnelle.`);
if (demoLink) console.log(`Exemple de lien client (page de gestion) : ${demoLink}`);
await pool.end();
