// Conservation des données : les coordonnées des clients sont effacées
// `conservation_mois` mois après la date de leur réservation.
import * as repo from '../db/repo.js';
import { localNow, addDays } from '../domain/schedule.js';

/** Les remarques peuvent contenir une allergie (donnée de santé) : conservées 30 jours seulement. */
export const NOTE_RETENTION_DAYS = 30;

/** Date limite (YYYY-MM-DD) : tout ce qui est strictement antérieur est anonymisé. */
export function cutoffDate(today, months) {
  const [y, m, d] = today.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 - months, 1));
  // Même jour du mois, borné au dernier jour du mois visé (ex. 31 mars − 1 mois → 28/29 février).
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export async function purgeExpiredPersonalData(now = new Date()) {
  const { conservation_mois: months } = await repo.getSettingsRow();
  const before = cutoffDate(localNow(now).date, months);
  const today = localNow(now).date;
  const notes = await repo.clearNotesBefore(addDays(today, -NOTE_RETENTION_DAYS));
  const count = await repo.anonymizeBefore(before);
  return { before, count, notes };
}
