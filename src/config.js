import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().startsWith('postgres'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET doit contenir au moins 32 caractères'),
  MAIL_TRANSPORT: z.enum(['file', 'smtp']).default('file'),
  MAIL_FROM: z.string().min(3),
  SMTP_URL: z.string().optional(),
  MAIL_DIR: z.string().default('var/mail'),
}).refine((c) => c.MAIL_TRANSPORT !== 'smtp' || c.SMTP_URL, {
  message: 'SMTP_URL est requis quand MAIL_TRANSPORT=smtp',
  path: ['SMTP_URL'],
}).refine((c) => c.NODE_ENV !== 'production' || c.MAIL_TRANSPORT === 'smtp', {
  // Sinon le site afficherait « email envoyé » alors que rien ne part.
  message: 'en production, MAIL_TRANSPORT doit valoir smtp',
  path: ['MAIL_TRANSPORT'],
}).refine((c) => c.NODE_ENV !== 'production' || c.PUBLIC_BASE_URL.startsWith('https://'), {
  message: 'en production, PUBLIC_BASE_URL doit commencer par https://',
  path: ['PUBLIC_BASE_URL'],
}).refine((c) => c.NODE_ENV !== 'production' || !/CHANGER|^(.)\1+$/.test(c.SESSION_SECRET), {
  message: 'SESSION_SECRET doit être une valeur aléatoire',
  path: ['SESSION_SECRET'],
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Configuration invalide (voir .env.example) :\n${details}`);
}

export const config = Object.freeze({
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  timezone: 'America/Guadeloupe',
});
