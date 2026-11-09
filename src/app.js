import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { pool } from './db/pool.js';
import { config } from './config.js';
import { publicRouter } from './routes/public.js';
import { reservationRouter } from './routes/reservation.js';
import { adminRouter } from './routes/admin.js';
import { sameOrigin } from './middleware/protect.js';
import { localize, langFromPath } from './middleware/locals.js';
import { translator } from './i18n/index.js';
import { render } from './render.js';
import { logError } from './logger.js';

/** @param {{ rateLimit?: boolean }} options  rateLimit : désactivé par défaut en test. */
export function createApp({ rateLimit = config.NODE_ENV !== 'test' } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('strict routing', false);

  // Production : tout passe en HTTPS (l'hébergeur termine TLS et transmet X-Forwarded-Proto).
  if (config.isProd) {
    app.use((req, res, next) => (req.secure || req.path === '/sante' ? next() : res.redirect(301, `https://${req.get('host')}${req.originalUrl}`)));
  }

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
    // same-origin : le lien de gestion (jeton) n'est jamais transmis à un site tiers,
    // mais le navigateur envoie bien l'origine sur nos propres formulaires.
    referrerPolicy: { policy: 'same-origin' },
  }));
  app.use(compression());

  // Fonctionnalités du navigateur dont le site n'a pas besoin : désactivées.
  app.use((req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  });
  app.use(express.static('public', { maxAge: config.isProd ? '7d' : 0, index: false }));

  app.get('/sante', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ statut: 'ok' });
    } catch {
      res.status(503).json({ statut: 'base indisponible' });
    }
  });

  app.use(sameOrigin);
  app.use(publicRouter());
  app.use(reservationRouter({ rateLimit }));
  app.use(adminRouter({ rateLimit }));

  app.use((req, res, next) => {
    const lang = langFromPath(req.path);
    localize(lang)(req, res, () => {
      const t = translator(lang);
      render(res, 'pages/error', { heading: t('errors.notFoundTitle'), text: t('errors.notFoundText'), noindex: true }, 404);
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    logError(err, `${req.method} ${req.path.replace(/\/(reservation|booking)\/[^/]+/, '/$1/…')}`);
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
