import { z } from 'zod';
import { isValidDate } from './domain/schedule.js';

// Retire les caractères de contrôle (sauf saut de ligne) et normalise les espaces.
const clean = (s) => s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim();
const text = (max) => z.string().transform(clean).pipe(z.string().min(1, 'required').max(max, 'too_long'));

export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;
const email = z.string().transform((s) => clean(s).toLowerCase()).pipe(z.string().max(120, 'too_long').regex(EMAIL_RE, 'email'));
const phone = z.string().transform(clean).pipe(z.string().regex(/^[0-9 +().-]{6,20}$/, 'phone').refine((s) => (s.match(/\d/g) || []).length >= 6, 'phone'));
const date = z.string().refine(isValidDate, 'date');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time');
const int = (min, max) => z.coerce.number().int('int').min(min, 'range').max(max, 'range');
const optionalText = (max) => z.string().optional().default('').transform(clean).pipe(z.string().max(max, 'too_long')).transform((s) => s || null);

/** Réservation en ligne (formulaire public). */
export const onlineBookingSchema = z.object({
  personnes: int(1, 42),
  date,
  heure: time,
  nom: text(80),
  telephone: phone,
  email,
  remarque: optionalText(500),
  consentement: z.literal('oui', { error: 'consent' }),
});

/** Réservation saisie par le restaurant (téléphone). Email facultatif. */
export const adminBookingSchema = z.object({
  personnes: int(1, 500),
  date,
  heure: time,
  nom: text(80),
  telephone: phone,
  email: z.string().optional().default('').transform((s) => clean(s).toLowerCase())
    .pipe(z.union([z.literal(''), z.string().max(120).regex(EMAIL_RE, 'email')])).transform((s) => s || null),
  remarque: optionalText(500),
});

export const settingsSchema = z.object({
  capacite_en_ligne: int(1, 42),
  capacite_salle: int(1, 500),
  duree_table_min: int(30, 300),
  intervalle_min: z.coerce.number().refine((n) => [15, 30, 60].includes(n), 'range'),
  delai_min_min: int(0, 2880),
  jours_max: int(1, 365),
  personnes_max_en_ligne: int(1, 42),
  conservation_mois: int(1, 120),
}).refine((s) => s.capacite_en_ligne <= s.capacite_salle, { path: ['capacite_en_ligne'], message: 'online_gt_room' })
  .refine((s) => s.personnes_max_en_ligne <= s.capacite_en_ligne, { path: ['personnes_max_en_ligne'], message: 'party_gt_online' });

export const closureSchema = z.object({ date, motif: optionalText(120) });

/** { champ: code } à partir d'une erreur zod (premier problème de chaque champ). */
const CODES = new Set(['required', 'too_long', 'email', 'phone', 'date', 'time', 'range', 'int', 'consent', 'online_gt_room', 'party_gt_online']);

export function fieldErrors(error) {
  const out = {};
  for (const issue of error.issues) {
    const key = issue.path[0] ?? '_';
    // Champ absent ou de mauvais type → « obligatoire » ; on n'expose jamais les messages bruts de zod.
    if (!(key in out)) out[key] = CODES.has(issue.message) ? issue.message : 'required';
  }
  return out;
}
