// Calcul de capacité (fonctions pures). Une réservation occupe ses couverts de son heure d'arrivée
// jusqu'à arrivée + durée d'une table. On refuse tout ajout qui dépasserait la capacité à un instant donné.
import { toMinutes, slotsFor } from './schedule.js';

/** Statuts qui occupent des couverts. */
export const ACTIVE_STATUSES = ['confirmee', 'honoree'];

/**
 * Nombre maximal de couverts occupés simultanément sur [start, start + window[.
 * @param {{heure: string, personnes: number}[]} bookings réservations actives de la date
 * @param durationMin durée d'occupation d'une table
 * @param windowMin   largeur de l'intervalle observé (par défaut : une durée de table)
 */
export function peakOccupancy(bookings, startMin, durationMin, windowMin = durationMin) {
  const end = startMin + windowMin;
  const spans = bookings.map((b) => { const s = toMinutes(b.heure); return [s, s + durationMin, b.personnes]; });
  // L'occupation ne change qu'aux heures d'arrivée : on l'évalue au début de l'intervalle
  // et à chaque arrivée qui tombe dedans.
  const points = [startMin, ...spans.map(([s]) => s).filter((s) => s > startMin && s < end)];
  let peak = 0;
  for (const t of points) {
    const seats = spans.reduce((sum, [s, e, n]) => (s <= t && t < e ? sum + n : sum), 0);
    if (seats > peak) peak = seats;
  }
  return peak;
}

/** Vrai si `party` personnes peuvent arriver à `hhmm` sans dépasser `capacity`. */
export function fits(bookings, hhmm, party, capacity, durationMin) {
  return peakOccupancy(bookings, toMinutes(hhmm), durationMin) + party <= capacity;
}

/** Créneaux d'une date avec leur disponibilité pour un groupe : [{ time, full }]. */
export function slotAvailability({ date, party, bookings, rules, closures, now = new Date() }) {
  return slotsFor(date, now, rules, closures).map((time) => ({
    time,
    full: !fits(bookings, time, party, rules.capacityOnline, rules.tableDurationMin),
  }));
}
