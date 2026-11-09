// Règles métier des réservations. Toute création passe par une transaction verrouillée sur la date :
// deux demandes simultanées pour les dernières places ne peuvent pas réussir toutes les deux.
import { transaction, pool } from '../db/pool.js';
import * as repo from '../db/repo.js';
import { dateProblem, slotsFor, localNow, openingHours, toMinutes } from '../domain/schedule.js';
import { fits } from '../domain/availability.js';
import { newToken, hashToken, newReference } from '../security.js';
import { sendMail } from '../mail/index.js';
import { confirmationEmail, cancellationEmail } from '../mail/messages.js';
import { config } from '../config.js';
import { logError } from '../logger.js';

export class BookingError extends Error {
  constructor(code, field = null) { super(code); this.code = code; this.field = field; }
}

export const manageUrl = (token, lang) => `${config.PUBLIC_BASE_URL}${lang === 'en' ? '/en/booking' : '/reservation'}/${token}`;

async function insertWithUniqueReference(data, db) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await db.query('SAVEPOINT ref');
      return await repo.insertReservation({ ...data, reference: newReference() }, db);
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT ref');
      if (!(err.code === '23505' && /reference/.test(err.constraint ?? ''))) throw err;
    }
  }
  throw new Error('Impossible de générer une référence unique');
}

/** Envoie un email sans jamais annuler l'opération déjà enregistrée. Renvoie vrai si envoyé. */
async function trySend(message, reservationId) {
  if (!message.to) return false;
  try {
    await sendMail(message);
    if (reservationId) await repo.markEmailSent(reservationId);
    return true;
  } catch (err) {
    logError(err, `[email] réservation ${reservationId ?? '?'}`);
    return false;
  }
}

/** Réservation en ligne. `input` est déjà validé par onlineBookingSchema. */
export async function createOnlineBooking(input, lang, now = new Date()) {
  const token = newToken();
  const reservation = await transaction(async (db) => {
    await repo.lockDate(input.date, db);
    const rules = await repo.getRules(db);
    const closures = repo.closureSet(await repo.getClosures(input.date, input.date, db));
    const problem = dateProblem(input.date, now, rules, closures);
    if (problem) throw new BookingError(problem, 'date');
    if (input.personnes > rules.maxPartyOnline) throw new BookingError('party', 'personnes');
    if (!slotsFor(input.date, now, rules, closures).includes(input.heure)) throw new BookingError('slot_gone', 'heure');
    // Double envoi (double-clic, retour arrière, renvoi du formulaire) : une seule réservation.
    if (await repo.findDuplicate(input, db)) throw new BookingError('duplicate', 'heure');
    const bookings = await repo.activeBookings(input.date, db);
    if (!fits(bookings, input.heure, input.personnes, rules.capacityOnline, rules.tableDurationMin)) {
      throw new BookingError('full', 'heure');
    }
    return insertWithUniqueReference({
      ...input, langue: lang, source: 'en_ligne', jetonHash: hashToken(token), consentementLe: now,
    }, db);
  });
  const emailSent = await trySend(confirmationEmail(reservation, manageUrl(token, lang)), reservation.id);
  return { reservation, token, emailSent };
}

/** Réservation saisie par le restaurant (prise par téléphone). Limite : capacité de la salle. */
export async function createAdminBooking(input, now = new Date()) {
  const token = input.email ? newToken() : null;
  const reservation = await transaction(async (db) => {
    await repo.lockDate(input.date, db);
    const rules = await repo.getRules(db);
    const today = localNow(now).date;
    if (input.date < today) throw new BookingError('past', 'date');
    const hours = openingHours(input.date);
    const closures = repo.closureSet(await repo.getClosures(input.date, input.date, db));
    if (!hours) throw new BookingError('closed', 'date');
    if (closures.has(input.date)) throw new BookingError('exceptional', 'date');
    const t = toMinutes(input.heure);
    if (t < toMinutes(hours.open) || t >= toMinutes(hours.close)) throw new BookingError('outside_hours', 'heure');
    const bookings = await repo.activeBookings(input.date, db);
    if (!fits(bookings, input.heure, input.personnes, rules.capacityRoom, rules.tableDurationMin)) {
      throw new BookingError('full_room', 'heure');
    }
    return insertWithUniqueReference({
      ...input, langue: 'fr', source: 'telephone', jetonHash: token ? hashToken(token) : null, consentementLe: null,
    }, db);
  });
  const emailSent = token ? await trySend(confirmationEmail(reservation, manageUrl(token, 'fr')), reservation.id) : false;
  return { reservation, emailSent };
}

/** Une réservation est annulable par le client tant que l'heure d'arrivée n'est pas passée. */
export function isUpcoming(r, now = new Date()) {
  const { date, minutes } = localNow(now);
  return r.date > date || (r.date === date && toMinutes(r.heure) > minutes);
}

export async function findByToken(token) {
  return repo.findByTokenHash(hashToken(token));
}

export async function cancelByClient(token, now = new Date()) {
  const r = await findByToken(token);
  if (!r) return { status: 'not_found' };
  if (r.statut !== 'confirmee') return { status: 'not_cancellable', reservation: r };
  if (!isUpcoming(r, now)) return { status: 'past', reservation: r };
  const updated = await repo.setStatus(r.id, 'annulee_client', ['confirmee']);
  if (!updated) return { status: 'not_cancellable', reservation: r };
  const emailSent = await trySend(cancellationEmail(updated, 'client'));
  return { status: 'cancelled', reservation: updated, emailSent };
}

// Transitions autorisées dans l'admin : statut cible → statuts de départ.
export const ADMIN_TRANSITIONS = {
  honoree: ['confirmee', 'absent'],
  absent: ['confirmee', 'honoree'],
  confirmee: ['honoree', 'absent'],
  annulee_restaurant: ['confirmee'],
};

/**
 * Actions possibles sur une réservation selon son statut ET sa date :
 * - « honorée / absent / rétablir » seulement le jour même ou après (on ne constate pas une venue future) ;
 * - « annuler » seulement si l'heure n'est pas passée (sinon le client recevrait un email absurde).
 */
export function allowedAdminActions(r, now = new Date()) {
  const today = localNow(now).date;
  return Object.entries(ADMIN_TRANSITIONS)
    .filter(([target, from]) => from.includes(r.statut))
    .filter(([target]) => (target === 'annulee_restaurant' ? isUpcoming(r, now) : r.date <= today))
    .map(([target]) => target);
}

export async function changeStatusByAdmin(id, statut, now = new Date()) {
  if (!ADMIN_TRANSITIONS[statut]) throw new BookingError('bad_status');
  const r = await repo.findById(id);
  if (!r || !allowedAdminActions(r, now).includes(statut)) return { status: 'refused' };
  const updated = await repo.setStatus(id, statut, ADMIN_TRANSITIONS[statut]);
  if (!updated) return { status: 'refused' };
  const emailSent = statut === 'annulee_restaurant' ? await trySend(cancellationEmail(updated, 'restaurant')) : false;
  return { status: 'ok', reservation: updated, emailSent };
}

/**
 * Fermeture exceptionnelle. S'il reste des réservations confirmées ce jour-là, la fermeture est refusée
 * sauf demande explicite d'annulation : elles sont alors annulées et chaque client est prévenu par email.
 */
export async function addClosure({ date, motif }, { cancelBookings = false } = {}) {
  const result = await transaction(async (db) => {
    await repo.lockDate(date, db);
    const confirmed = await repo.confirmedForDate(date, db);
    if (confirmed.length && !cancelBookings) return { status: 'has_bookings', bookings: confirmed };
    await repo.addClosure({ date, motif }, db);
    const cancelled = [];
    for (const r of confirmed) cancelled.push(await repo.setStatus(r.id, 'annulee_restaurant', ['confirmee'], db));
    return { status: 'ok', cancelled };
  });
  if (result.status !== 'ok') return result;
  let notified = 0;
  for (const r of result.cancelled) if (await trySend(cancellationEmail(r, 'restaurant'))) notified += 1;
  return { status: 'ok', cancelled: result.cancelled.length, notified };
}

export { pool };
