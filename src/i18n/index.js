import { readFileSync } from 'node:fs';
import { ROUTES } from './routes.js';

const dict = {
  fr: JSON.parse(readFileSync(new URL('./fr.json', import.meta.url), 'utf8')),
  en: JSON.parse(readFileSync(new URL('./en.json', import.meta.url), 'utf8')),
};

/** Renvoie la traduction de `key` ("a.b.c") ; remplace {var}. Lève une erreur si la clé manque (détectée en test). */
export function translator(lang) {
  return function t(key, vars) {
    const value = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict[lang]);
    if (value === undefined) throw new Error(`Traduction manquante [${lang}] : ${key}`);
    if (typeof value !== 'string' || !vars) return value;
    return value.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  };
}

export const url = (key, lang) => ROUTES[key][lang];
export { dict };
