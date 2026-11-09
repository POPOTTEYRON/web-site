import { translator, url } from '../i18n/index.js';
import { ROUTES } from '../i18n/routes.js';
import { formatters } from '../i18n/format.js';
import { restaurant } from '../content.js';
import { todayStatus } from '../domain/schedule.js';
import { config } from '../config.js';

/** Variables disponibles dans toutes les vues pour une langue et une page données. */
export function localize(lang, page = null) {
  const t = translator(lang);
  const fmt = formatters(lang);
  const altLang = lang === 'fr' ? 'en' : 'fr';
  return (req, res, next) => {
    res.locals.lang = lang;
    res.locals.altLang = altLang;
    res.locals.t = t;
    res.locals.fmt = fmt;
    res.locals.page = page;
    res.locals.url = (key) => url(key, lang);
    res.locals.altUrl = page ? ROUTES[page][altLang] : ROUTES.home[altLang];
    res.locals.canonical = config.PUBLIC_BASE_URL + (page ? ROUTES[page][lang] : req.path);
    res.locals.alternates = page ? { fr: config.PUBLIC_BASE_URL + ROUTES[page].fr, en: config.PUBLIC_BASE_URL + ROUTES[page].en } : null;
    res.locals.baseUrl = config.PUBLIC_BASE_URL;
    res.locals.restaurant = restaurant;
    res.locals.status = todayStatus();
    res.locals.year = new Date().getFullYear();
    next();
  };
}

/** Langue déduite de l'URL (pages hors table de routage : 404, erreurs). */
export const langFromPath = (path) => (path === '/en' || path.startsWith('/en/') ? 'en' : 'fr');
