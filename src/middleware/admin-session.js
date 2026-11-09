import session from 'express-session';
import connectPg from 'connect-pg-simple';
import { randomBytes } from 'node:crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { safeEqual } from '../security.js';

const PgStore = connectPg(session);

/** Session réservée à l'espace admin : cookie strictement nécessaire, jamais posé sur le site public. */
export function adminSession() {
  return session({
    name: 'tm_admin',
    secret: config.SESSION_SECRET,
    store: new PgStore({ pool, tableName: 'session', createTableIfMissing: false, pruneSessionInterval: config.NODE_ENV === 'test' ? false : 900 }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'strict', secure: config.isProd, maxAge: 8 * 3600 * 1000, path: '/admin' },
  });
}

/** Jeton anti-CSRF par session (formulaires de l'admin). */
export function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = randomBytes(24).toString('base64url');
  res.locals.csrf = req.session.csrf;
  if (req.method === 'POST' && !safeEqual(req.body?._csrf, req.session.csrf)) {
    return res.status(403).type('text').send('Jeton de sécurité invalide. Rechargez la page.');
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (req.session.adminId) return next();
  if (req.method === 'GET') return res.redirect(303, `/admin/connexion?suite=${encodeURIComponent(req.originalUrl)}`);
  res.status(401).type('text').send('Session expirée. Reconnectez-vous.');
}
