import rateLimit from 'express-rate-limit';

/**
 * Refuse les envois de formulaire venant d'un autre site (protection CSRF de base pour les formulaires publics).
 * Les navigateurs envoient l'en-tête Origin sur les POST ; à défaut on regarde Referer.
 */
export function sameOrigin(req, res, next) {
  if (req.method !== 'POST') return next();
  const refuse = () => res.status(403).type('text').send('Origine refusée');
  // Navigateurs modernes : en-tête fiable, non modifiable par une page.
  const site = req.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none' ? next() : refuse();
  const source = req.get('origin') || req.get('referer');
  if (!source) return next(); // anciens navigateurs ou outils : pas d'information, on laisse passer
  if (source === 'null') return refuse(); // page isolée (iframe sandbox…) : refus
  try {
    if (new URL(source).host === req.get('host')) return next();
  } catch { /* en-tête invalide */ }
  return refuse();
}

export const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

/** Limiteur de débit ; désactivé si `enabled` est faux (tests). */
export function limiter({ enabled, windowMin, max, onLimit }) {
  if (!enabled) return (req, res, next) => next();
  return rateLimit({
    windowMs: windowMin * 60_000, limit: max, standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (req, res, next, options) => onLimit(req, res, options.statusCode),
  });
}
