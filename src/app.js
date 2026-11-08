import express from 'express';
import helmet from 'helmet';
import { pool } from './db/pool.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:'] },
    },
  }));
  app.use(express.static('public', { maxAge: '7d', index: false }));

  app.get('/sante', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ statut: 'ok' });
    } catch {
      res.status(503).json({ statut: 'base indisponible' });
    }
  });

  app.use((_req, res) => res.status(404).type('text').send('Page introuvable'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).type('text').send('Erreur interne');
  });
  return app;
}
