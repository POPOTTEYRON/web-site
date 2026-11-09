import express from 'express';
import helmet from 'helmet';
import { pool } from './db/pool.js';
import { config } from './config.js';
import { publicRouter } from './routes/public.js';
import { localize, langFromPath } from './middleware/locals.js';
import { translator } from './i18n/index.js';
import { render } from './render.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('strict routing', false);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    hsts: config.isProd,
  }));
  app.use(express.static('public', { maxAge: config.isProd ? '7d' : 0, index: false }));

  app.get('/sante', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ statut: 'ok' });
    } catch {
      res.status(503).json({ statut: 'base indisponible' });
    }
  });

  app.use(publicRouter());

  app.use((req, res, next) => {
    const lang = langFromPath(req.path);
    localize(lang)(req, res, () => {
      const t = translator(lang);
      render(res, 'pages/error', { heading: t('errors.notFoundTitle'), text: t('errors.notFoundText'), noindex: true }, 404);
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    console.error(err);
    if (res.headersSent) return;
    try {
      const lang = langFromPath(req.path);
      localize(lang)(req, res, () => {
        const t = translator(lang);
        render(res, 'pages/error', { heading: t('errors.serverTitle'), text: t('errors.serverText') }, 500);
      });
    } catch {
      res.status(500).type('text').send('Erreur interne');
    }
  });
  return app;
}
