import { Router } from 'express';
import { ROUTES, LANGS } from '../i18n/routes.js';
import { localize } from '../middleware/locals.js';
import { render } from '../render.js';
import { menu } from '../content.js';
import { schemaOpeningHours } from '../domain/hours.js';

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
    render(res, 'pages/home', { dishes, openingHoursSchema: schemaOpeningHours() });
  });

  page('menu', (req, res) => render(res, 'pages/menu', { menu }));
  page('restaurant', (req, res) => render(res, 'pages/restaurant'));
  page('contact', (req, res) => render(res, 'pages/contact'));
  page('legal', (req, res) => render(res, `pages/legal.${res.locals.lang}.eta`));
  page('privacy', (req, res) => render(res, `pages/privacy.${res.locals.lang}.eta`));

  return router;
}
