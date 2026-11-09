import { Router } from 'express';
import { ROUTES, LANGS } from '../i18n/routes.js';
import { localize } from '../middleware/locals.js';
import { render } from '../render.js';
import { menu } from '../content.js';
import { RULES, dateProblem, slotsFor, nextDays, localNow } from '../domain/schedule.js';

const HOME_DISHES = [['entrees', 0], ['plats', 1], ['plats', 0], ['desserts', 1]];

export function publicRouter() {
  const router = Router();
  const page = (key, handler) => {
    for (const lang of LANGS) router.get(ROUTES[key][lang], localize(lang, key), handler);
  };

  page('home', (req, res) => {
    const dishes = HOME_DISHES.map(([cat, i]) => {
      const c = menu.categories.find((x) => x.id === cat);
      return { ...c.plats[i], categorie: c.titre };
    });
    render(res, 'pages/home', { dishes });
  });

  page('menu', (req, res) => render(res, 'pages/menu', { menu }));
  page('restaurant', (req, res) => render(res, 'pages/restaurant'));
  page('contact', (req, res) => render(res, 'pages/contact'));
  page('legal', (req, res) => render(res, `pages/legal.${res.locals.lang}.eta`));
  page('privacy', (req, res) => render(res, `pages/privacy.${res.locals.lang}.eta`));

  page('book', (req, res) => {
    const partyRaw = req.query.personnes ?? req.query.guests;
    const party = partyRaw === undefined ? 2 : Number(partyRaw);
    const partyError = !(Number.isInteger(party) && party >= 1 && party <= RULES.maxPartyOnline);
    // Deux champs « date » (raccourcis + « autre date ») : on garde la dernière valeur non vide.
    const dates = [].concat(req.query.date ?? []).filter((d) => typeof d === 'string' && d !== '');
    const date = dates.length ? dates[dates.length - 1] : null;
    const dateError = date ? dateProblem(date) : null;
    const ready = Boolean(date) && !dateError && !partyError;
    render(res, 'pages/book', {
      party: partyError ? 2 : party,
      partyError: partyRaw !== undefined && partyError,
      date,
      dateError,
      ready,
      slots: ready ? slotsFor(date) : [],
      days: nextDays(7),
      minDate: localNow().date,
      maxParty: RULES.maxPartyOnline,
      maxDaysAhead: RULES.maxDaysAhead,
    });
  });

  // L'enregistrement réel des réservations arrive en phase 7 : on le dit clairement, sans simuler de succès.
  for (const lang of LANGS) {
    router.post(ROUTES.book[lang], localize(lang, 'book'), (req, res) => {
      render(res, 'pages/book-unavailable', {}, 503);
    });
  }
  return router;
}
