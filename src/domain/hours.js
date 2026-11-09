// Textes d'horaires générés depuis content/restaurant.json : une seule source de vérité.
// Modifier les horaires dans ce fichier met à jour tout le site (bandeau, tableau, statut, données Google).
import { restaurant } from '../content.js';
import { localNow, addDays, isoWeekday, openingHours } from './schedule.js';

const DAYS = {
  fr: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};
const SCHEMA_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const short = (lang, d) => cap(DAYS[lang][d - 1].slice(0, 3));

/** Jours consécutifs (1 = lundi … 7) aux horaires identiques : [{ from, to, hours: [open, close] | null }]. */
export function scheduleGroups(hours = restaurant.horaires) {
  const groups = [];
  for (let d = 1; d <= 7; d += 1) {
    const h = hours[String(d)] ?? null;
    const last = groups.at(-1);
    if (last && JSON.stringify(last.hours) === JSON.stringify(h)) last.to = d;
    else groups.push({ from: d, to: d, hours: h });
  }
  return groups;
}

/** Textes d'horaires pour une langue. `fmt.time` met en forme une heure HH:MM. */
export function hoursText(lang, fmt, now = new Date(), hours = restaurant.horaires) {
  const groups = scheduleGroups(hours);
  const day = (d) => DAYS[lang][d - 1];
  const range = (g) => (g.from === g.to
    ? cap(day(g.from))
    : lang === 'fr' ? `Du ${day(g.from)} au ${day(g.to)}` : `${day(g.from)} to ${day(g.to)}`);
  const label = (g) => (g.from === g.to ? cap(day(g.from)) : `${cap(day(g.from))} – ${day(g.to)}`);
  const span = (h) => `${fmt.time(h[0])} – ${fmt.time(h[1])}`;
  const open = groups.filter((g) => g.hours);
  const closedDays = groups.filter((g) => !g.hours).flatMap((g) => Array.from({ length: g.to - g.from + 1 }, (_, i) => g.from + i));
  const join = (arr) => (arr.length < 2 ? arr.join('') : `${arr.slice(0, -1).join(', ')} ${lang === 'fr' ? 'et' : 'and'} ${arr.at(-1)}`);
  const closedText = closedDays.length
    ? (lang === 'fr' ? `fermé ${join(closedDays.map((d) => `le ${day(d)}`))}` : `closed on ${join(closedDays.map((d) => `${day(d)}s`))}`)
    : '';

  // Prochaine ouverture (pour « fermé aujourd'hui »).
  const today = localNow(now).date;
  let reopens = null;
  for (let i = 1; i <= 7 && !reopens; i += 1) {
    const date = addDays(today, i);
    const h = openingHours(date, hours);
    if (h) reopens = { day: i === 1 ? (lang === 'fr' ? 'demain' : 'tomorrow') : day(isoWeekday(date)), time: fmt.time(h.open) };
  }

  return {
    line: [open.map((g) => `${range(g)}, ${span(g.hours)}`).join(' ; '), closedText].filter(Boolean).join(' · '),
    short: open.map((g) => `${g.from === g.to ? short(lang, g.from) : `${short(lang, g.from)} – ${lang === 'fr' ? short(lang, g.to).toLowerCase() : short(lang, g.to)}`} · ${span(g.hours)}`).join(' ; '),
    closed: closedText ? cap(closedText) : '',
    rows: groups.map((g) => ({ label: label(g), value: g.hours ? span(g.hours) : null })),
    reopens,
  };
}

/** Horaires au format schema.org pour les données structurées. */
export function schemaOpeningHours(hours = restaurant.horaires) {
  return scheduleGroups(hours).filter((g) => g.hours).map((g) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: SCHEMA_DAYS.slice(g.from - 1, g.to),
    opens: g.hours[0],
    closes: g.hours[1],
  }));
}
