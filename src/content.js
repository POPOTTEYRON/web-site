// Contenu éditable (content/*.json), chargé une fois au démarrage.
import { readFileSync } from 'node:fs';

const load = (name) => JSON.parse(readFileSync(new URL(`../content/${name}.json`, import.meta.url), 'utf8'));

export const restaurant = Object.freeze(load('restaurant'));
export const menu = Object.freeze(load('menu'));
