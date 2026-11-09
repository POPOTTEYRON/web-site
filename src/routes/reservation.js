import express, { Router } from 'express';
import { ROUTES, LANGS } from '../i18n/routes.js';
import { localize } from '../middleware/locals.js';
import { noStore, limiter } from '../middleware/protect.js';
import { render } from '../render.js';
import * as repo from '../db/repo.js';
import { dateProblem, nextDays, localNow, addDays, slotsFor } from '../domain/schedule.js';
import { slotAvailability } from '../domain/availability.js';
import { onlineBookingSchema, fieldErrors } from '../validation.js';
import { createOnlineBooking, findByToken, cancelByClient, isUpcoming, BookingError } from '../services/reservations.js';
import { isTokenShape } from '../security.js';

export const MANAGE = { fr: '/reservation', en: '/en/booking' };

/** Données de la page de réservation (étapes 1 à 4). */
async function bookingPage({ party, date, values = {}, errors = {} }) {
  const rules = await repo.getRules();
  const today = localNow().date;
  const closures = repo.closureSet(await repo.getClosures(today, addDays(today, rules.maxDaysAhead)));
  const validParty = Number.isInteger(party) && party >= 1 && party <= rules.maxPartyOnline;
  const dateError = date ? dateProblem(date, new Date(), rules, closures) : null;
  const ready = Boolean(date) && !dateError && validParty;
  const slots = ready
    ? slotAvailability({ date, party, bookings: await repo.activeBookings(date), rules, closures })
    : [];
  return {
    party: validParty ? party : 2,
    partyError: !validParty,
    date, dateError, ready, slots,
    allFull: slots.length > 0 && slots.every((s) => s.full),
    // « Aujourd'hui » n'est proposé que s'il reste au moins un horaire.
    days: nextDays(7, new Date(), closures).map((d) => (d.isToday && !d.closed && !slotsFor(d.date, new Date(), rules, closures).length
      ? { ...d, closed: true, over: true } : d)),
    minDate: today,
    maxDate: addDays(today, rules.maxDaysAhead),
    maxParty: rules.maxPartyOnline,
    maxDaysAhead: rules.maxDaysAhead,
    values, errors,
  };
}

export function reservationRouter({ rateLimit }) {
  const router = Router();
  const form = express.urlencoded({ extended: false, limit: '10kb', parameterLimit: 30 });

  for (const lang of LANGS) {
    const tooMany = (req, res, status) => {
      localize(lang, 'book')(req, res, () => render(res, 'pages/error', {
        heading: res.locals.t('book.errors.rate'), text: '', noindex: true,
      }, status));
    };

    router.get(ROUTES.book[lang], localize(lang, 'book'), async (req, res, next) => {
      try {
        const raw = req.query.personnes ?? req.query.guests;
        // « Autre date » (champ libre) prime sur les raccourcis des 7 prochains jours.
        const pickOne = (v) => [].concat(v ?? []).filter((d) => typeof d === 'string' && d !== '').at(-1);
        const date = pickOne(req.query.autre_date) ?? pickOne(req.query.date) ?? null;
        const data = await bookingPage({ party: raw === undefined ? 2 : Number(raw), date });
        render(res, 'pages/book', { ...data, noindex: Boolean(date) });
      } catch (err) { next(err); }
    });

    router.post(ROUTES.book[lang], limiter({ enabled: rateLimit, windowMin: 15, max: 10, onLimit: tooMany }),
      form, localize(lang, 'book'), noStore, async (req, res, next) => {
        const body = req.body ?? {};
        const values = {
          nom: body.nom ?? '', telephone: body.telephone ?? '', email: body.email ?? '',
          remarque: body.remarque ?? '', heure: body.heure ?? '',
        };
        const party = Number(body.personnes);
        const rerender = async (errors, status) => {
          const data = await bookingPage({ party, date: typeof body.date === 'string' ? body.date : null, values, errors });
          render(res, 'pages/book', { ...data, noindex: true }, status);
        };
        try {
          // Champ piège invisible : rempli uniquement par des robots.
          if (body.site_web) return render(res, 'pages/error', { heading: res.locals.t('book.errors.bot'), text: '' }, 400);
          const parsed = onlineBookingSchema.safeParse(body);
          if (!parsed.success) return await rerender(fieldErrors(parsed.error), 422);
          const { token } = await createOnlineBooking(parsed.data, lang);
          res.redirect(303, `${MANAGE[lang]}/${token}?nouvelle=1`);
        } catch (err) {
          if (err instanceof BookingError) {
            const field = err.field ?? 'heure';
            const status = ['full', 'slot_gone', 'duplicate'].includes(err.code) ? 409 : 422;
            if (field === 'heure') values.heure = '';
            return rerender({ [field]: err.code }, status).catch(next);
          }
          next(err);
        }
      });

    router.get(`${MANAGE[lang]}/:token`, localize(lang, null), noStore, async (req, res, next) => {
      try {
        const r = isTokenShape(req.params.token) ? await findByToken(req.params.token) : null;
        res.locals.altUrl = `${MANAGE[lang === 'fr' ? 'en' : 'fr']}/${req.params.token}`;
        if (!r) return render(res, 'pages/error', { heading: res.locals.t('manage.notFoundTitle'), text: res.locals.t('manage.notFoundText'), noindex: true }, 404);
        render(res, 'pages/manage', {
          r, token: req.params.token, isNew: req.query.nouvelle === '1',
          cancelled: req.query.annulee === '1', cancelEmailSent: req.query.email === '1',
          canCancel: r.statut === 'confirmee' && isUpcoming(r), past: !isUpcoming(r), noindex: true,
        });
      } catch (err) { next(err); }
    });

    router.post(`${MANAGE[lang]}/:token/annuler`, limiter({ enabled: rateLimit, windowMin: 15, max: 20, onLimit: tooMany }),
      localize(lang, null), noStore, async (req, res, next) => {
        try {
          if (!isTokenShape(req.params.token)) return render(res, 'pages/error', { heading: res.locals.t('manage.notFoundTitle'), text: res.locals.t('manage.notFoundText'), noindex: true }, 404);
          const result = await cancelByClient(req.params.token);
          if (result.status === 'not_found') return render(res, 'pages/error', { heading: res.locals.t('manage.notFoundTitle'), text: res.locals.t('manage.notFoundText'), noindex: true }, 404);
          const q = result.status === 'cancelled' ? `?annulee=1${result.emailSent ? '&email=1' : ''}` : '';
          res.redirect(303, `${MANAGE[lang]}/${req.params.token}${q}`);
        } catch (err) { next(err); }
      });
  }
  return router;
}
