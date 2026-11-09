import { Eta } from 'eta';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const eta = new Eta({
  views: fileURLToPath(new URL('./views', import.meta.url)),
  cache: config.isProd,
  autoEscape: true,
});

/** Rend une vue avec les variables communes (res.locals) et envoie le HTML. */
export function render(res, view, data = {}, status = 200) {
  const html = eta.render(view, { ...res.locals, ...data });
  res.status(status).type('html').send(html);
}
