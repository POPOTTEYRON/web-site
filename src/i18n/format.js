import { TIMEZONE, toMinutes } from '../domain/schedule.js';

const LOCALE = { fr: 'fr-FR', en: 'en-GB' };

export function formatters(lang) {
  const price = new Intl.NumberFormat(LOCALE[lang], { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const long = new Intl.DateTimeFormat(LOCALE[lang], { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const full = new Intl.DateTimeFormat(LOCALE[lang], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dow = new Intl.DateTimeFormat(LOCALE[lang], { weekday: 'short', timeZone: 'UTC' });
  const asDate = (s) => new Date(`${s}T00:00:00Z`);
  return {
    price: (euros) => price.format(euros),
    /** "19:30" → "19h30" (fr) / "7:30pm" (en) */
    time(hhmm) {
      const m = toMinutes(hhmm); const h = Math.floor(m / 60); const mm = m % 60;
      if (lang === 'fr') return `${h}h${mm ? String(mm).padStart(2, '0') : ''}`;
      const h12 = ((h + 11) % 12) + 1;
      return `${h12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`;
    },
    dateLong: (s) => long.format(asDate(s)),
    dateFull: (s) => full.format(asDate(s)),
    weekdayShort: (s) => dow.format(asDate(s)).replace('.', ''),
    dayNumber: (s) => String(asDate(s).getUTCDate()),
  };
}
export { TIMEZONE };
