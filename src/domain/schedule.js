// Horaires, jours ouvrés et créneaux théoriques, en heure de Guadeloupe (UTC−4, sans heure d'été).
// La capacité (places restantes) est vérifiée séparément, côté réservation.
import { restaurant } from '../content.js';

export const TIMEZONE = 'America/Guadeloupe';

// Règles par défaut (hypothèse H1). Les valeurs en vigueur sont en base (table reglages), éditables dans l'admin.
export const RULES = Object.freeze({
  slotStepMin: 30,
  tableDurationMin: 90,
  minLeadMin: 60,
  maxDaysAhead: 60,
  maxPartyOnline: 8,
  capacityOnline: 36,
  capacityRoom: 42,
});

/** Convertit la ligne `reglages` en objet de règles. */
export const rulesFromRow = (r) => Object.freeze({
  slotStepMin: r.intervalle_min,
  tableDurationMin: r.duree_table_min,
  minLeadMin: r.delai_min_min,
  maxDaysAhead: r.jours_max,
  maxPartyOnline: r.personnes_max_en_ligne,
  capacityOnline: r.capacite_en_ligne,
  capacityRoom: r.capacite_salle,
});

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Date et heure locales de Guadeloupe : { date: 'YYYY-MM-DD', minutes: minutes depuis minuit }. */
export function localNow(now = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Jour ISO : 1 = lundi … 7 = dimanche. */
export function isoWeekday(dateStr) {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Horaires d'ouverture d'une date, ou null si fermé. */
export function openingHours(dateStr, hours = restaurant.horaires) {
  const h = hours[String(isoWeekday(dateStr))];
  return h ? { open: h[0], close: h[1] } : null;
}

/** Statut « ouvert / fermé » du jour, pour le bandeau d'information. */
export function todayStatus(now = new Date()) {
  const { date, minutes } = localNow(now);
  const h = openingHours(date);
  if (!h) return { open: false, closedToday: true, hours: null };
  const open = minutes >= toMinutes(h.open) && minutes < toMinutes(h.close);
  return { open, closedToday: false, hours: h, later: minutes < toMinutes(h.open) };
}

/**
 * Pourquoi une date n'est pas réservable en ligne :
 * 'invalid' | 'past' | 'too_far' | 'closed' (fermeture hebdomadaire) | 'exceptional' (fermeture exceptionnelle) | null.
 */
export function dateProblem(dateStr, now = new Date(), rules = RULES, closures = new Set()) {
  if (!isValidDate(dateStr)) return 'invalid';
  const today = localNow(now).date;
  if (dateStr < today) return 'past';
  if (dateStr > addDays(today, rules.maxDaysAhead)) return 'too_far';
  if (!openingHours(dateStr)) return 'closed';
  if (closures.has(dateStr)) return 'exceptional';
  return null;
}

/** Heures d'arrivée possibles pour une date (sans tenir compte de la capacité). */
export function slotsFor(dateStr, now = new Date(), rules = RULES, closures = new Set()) {
  if (dateProblem(dateStr, now, rules, closures)) return [];
  const h = openingHours(dateStr);
  const first = toMinutes(h.open);
  const last = toMinutes(h.close) - rules.tableDurationMin;
  const { date: today, minutes } = localNow(now);
  const earliest = dateStr === today ? minutes + rules.minLeadMin : -1;
  const out = [];
  for (let m = first; m <= last; m += rules.slotStepMin) if (m >= earliest) out.push(toHHMM(m));
  return out;
}

/** Les n prochains jours (raccourcis du formulaire), fermés compris pour les afficher comme tels. */
export function nextDays(n = 7, now = new Date(), closures = new Set()) {
  const today = localNow(now).date;
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(today, i);
    return { date, isToday: i === 0, closed: !openingHours(date) || closures.has(date) };
  });
}
