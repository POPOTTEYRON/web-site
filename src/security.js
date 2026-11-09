import { randomBytes, createHash, timingSafeEqual, randomInt } from 'node:crypto';

/** Jeton d'accès à une réservation (lien de gestion) : 32 octets aléatoires, base64url. */
export const newToken = () => randomBytes(32).toString('base64url');
/** Seule l'empreinte du jeton est stockée : une fuite de la base ne donne pas accès aux liens. */
export const hashToken = (token) => createHash('sha256').update(token).digest();
export const isTokenShape = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O ni 1/I
export const newReference = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? '')); const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}
