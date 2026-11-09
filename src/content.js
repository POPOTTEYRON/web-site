// Contenu éditable (content/*.json), chargé une fois au démarrage.
import { readFileSync } from 'node:fs';

const load = (name) => JSON.parse(readFileSync(new URL(`../content/${name}.json`, import.meta.url), 'utf8'));

const raw = load('restaurant');
// Espaces insécables : un numéro de téléphone ne se coupe jamais en fin de ligne.
export const restaurant = Object.freeze({ ...raw, telephone: raw.telephone.replace(/ /g, '\u00A0') });
export const menu = Object.freeze(load('menu'));
