import express, { Router } from 'express';
import { hash, verify } from '@node-rs/argon2';
import { adminSession, csrf, requireAdmin } from '../middleware/admin-session.js';
import { noStore, limiter } from '../middleware/protect.js';
import { localize } from '../middleware/locals.js';
import { render } from '../render.js';
import * as repo from '../db/repo.js';
import { localNow, addDays, isValidDate, openingHours, toMinutes, toHHMM } from '../domain/schedule.js';
import { cutoffDate } from '../services/retention.js';
import { peakOccupancy } from '../domain/availability.js';
import { adminBookingSchema, settingsSchema, closureSchema, fieldErrors } from '../validation.js';
import { createAdminBooking, changeStatusByAdmin, BookingError, allowedAdminActions, addClosure } from '../services/reservations.js';

// Empreinte factice : on vérifie toujours un mot de passe, même pour un email inconnu (temps de réponse constant).
const DUMMY_HASH = await hash('mot-de-passe-factice-pour-temps-constant');

const MESSAGES = {
  required: 'Champ obligatoire.', too_long: 'Texte trop long.', email: 'Email invalide.', phone: 'Téléphone invalide.',
  date: 'Date invalide.', time: 'Heure invalide (HH:MM).', range: 'Valeur hors limites.', int: 'Nombre entier attendu.',
  past: 'Cette date est passée.', closed: 'Le restaurant est fermé ce jour-là (lundi).', exceptional: 'Fermeture exceptionnelle ce jour-là.',
  outside_hours: 'Heure en dehors des horaires d\'ouverture.', full_room: 'Capacité de la salle dépassée sur ce créneau.',
  online_gt_room: 'Ne peut pas dépasser la capacité de la salle.', party_gt_online: 'Ne peut pas dépasser la capacité en ligne.',
};
const msg = (code) => MESSAGES[code] ?? 'Valeur invalide.';
const safeNext = (s) => (typeof s === 'string' && /^\/admin(\/[\w\-/?=&%.]*)?$/.test(s) ? s : '/admin');

export function adminRouter({ rateLimit }) {
  const router = Router();
  router.use('/admin', noStore, adminSession(), express.urlencoded({ extended: false, limit: '10kb', parameterLimit: 30 }),
    localize('fr'), (req, res, next) => { res.locals.msg = msg; res.locals.noindex = true; next(); }, csrf);

  // --- Connexion ---
  router.get('/admin/connexion', (req, res) => {
    if (req.session.adminId) return res.redirect(303, '/admin');
    render(res, 'admin/login', { suite: safeNext(req.query.suite), error: null });
  });

  const loginLimiter = limiter({
    enabled: rateLimit, windowMin: 15, max: 5,
    onLimit: (req, res, status) => render(res, 'admin/login', { suite: '/admin', error: 'Trop de tentatives. Réessayez dans 15 minutes.' }, status),
  });

  router.post('/admin/connexion', loginLimiter, async (req, res, next) => {
    try {
      const email = String(req.body.email ?? '').trim().toLowerCase().slice(0, 120);
      const password = String(req.body.mot_de_passe ?? '').slice(0, 200);
      const admin = await repo.findAdminByEmail(email);
      const ok = await verify(admin?.mot_de_passe_hash ?? DUMMY_HASH, password).catch(() => false);
      if (!admin || !ok) {
        return render(res, 'admin/login', { suite: safeNext(req.body.suite), error: 'Email ou mot de passe incorrect.' }, 401);
      }
      // Nouvelle session à la connexion (protection contre la fixation de session).
      req.session.regenerate(async (err) => {
        if (err) return next(err);
        req.session.adminId = admin.id;
        req.session.adminEmail = admin.email;
        await repo.touchAdminLogin(admin.id);
        req.session.save((e) => (e ? next(e) : res.redirect(303, safeNext(req.body.suite))));
      });
    } catch (err) { next(err); }
  });

  router.post('/admin/deconnexion', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('tm_admin', { path: '/admin' });
      res.redirect(303, '/admin/connexion');
    });
  });

  router.use('/admin', requireAdmin, (req, res, next) => { res.locals.adminEmail = req.session.adminEmail; next(); });

  // --- Réservations du jour ---
  router.get('/admin', async (req, res, next) => {
    try {
      const today = localNow().date;
      const date = isValidDate(req.query.date) ? req.query.date : today;
      const [rows, rules, closures] = await Promise.all([repo.reservationsForDay(date), repo.getRules(), repo.getClosures(date, date)]);
      const active = rows.filter((r) => r.statut === 'confirmee' || r.statut === 'honoree');
      // Pic d'occupation de la journée (au pas des créneaux).
      let peak = { seats: 0, time: null };
      const bookings = active.map((r) => ({ heure: r.heure, personnes: r.personnes }));
      const hours = openingHours(date);
      if (hours) {
        for (let m = toMinutes(hours.open); m < toMinutes(hours.close); m += rules.slotStepMin) {
          const seats = peakOccupancy(bookings, m, rules.tableDurationMin, 1);
          if (seats > peak.seats) peak = { seats, time: toHHMM(m) };
        }
      }
      render(res, 'admin/day', {
        title: 'Réservations du jour', section: 'jour', date, today,
        prev: addDays(date, -1), next: addDays(date, 1),
        lunch: rows.filter((r) => r.heure < '16:00'), dinner: rows.filter((r) => r.heure >= '16:00'),
        totals: { reservations: active.length, couverts: active.reduce((s, r) => s + r.personnes, 0) },
        peak, rules, closed: !hours, closure: closures[0] ?? null, actionsFor: (r) => allowedAdminActions(r),
        flash: req.query.ok ?? null,
      });
    } catch (err) { next(err); }
  });

  router.post('/admin/reservations/:id/statut', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const r = Number.isSafeInteger(id) ? await repo.findById(id) : null;
      if (!r) return res.status(404).type('text').send('Réservation introuvable');
      const result = await changeStatusByAdmin(id, String(req.body.statut));
      const ok = result.status === 'ok' ? (req.body.statut === 'annulee_restaurant' ? (result.emailSent ? 'annulee_email' : 'annulee') : 'statut') : 'refuse';
      res.redirect(303, `/admin?date=${r.date}&ok=${ok}#r${r.id}`);
    } catch (err) {
      if (err instanceof BookingError) return res.status(400).type('text').send('Statut invalide');
      next(err);
    }
  });

  // Droit à l'effacement : efface les coordonnées (date, couverts et statut restent pour l'activité).
  router.post('/admin/reservations/:id/anonymiser', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const r = Number.isSafeInteger(id) ? await repo.findById(id) : null;
      if (!r) return res.status(404).type('text').send('Réservation introuvable');
      const done = await repo.anonymizeReservation(id, localNow().date);
      res.redirect(303, `/admin?date=${r.date}&ok=${done ? 'anonymisee' : 'anonymisation_refusee'}#r${r.id}`);
    } catch (err) { next(err); }
  });

  // --- Planning ---
  router.get('/admin/planning', async (req, res, next) => {
    try {
      const today = localNow().date;
      const to = addDays(today, 20);
      const [totals, closures, rules] = await Promise.all([repo.dailyTotals(today, to), repo.getClosures(today, to), repo.getRules()]);
      const byDate = Object.fromEntries(totals.map((t) => [t.date, t]));
      const closed = Object.fromEntries(closures.map((c) => [c.date, c]));
      const days = Array.from({ length: 21 }, (_, i) => {
        const date = addDays(today, i);
        return { date, isToday: i === 0, weeklyClosed: !openingHours(date), closure: closed[date] ?? null, ...(byDate[date] ?? { reservations: 0, couverts: 0 }) };
      });
      render(res, 'admin/planning', { title: 'Planning', section: 'planning', days, rules });
    } catch (err) { next(err); }
  });

  // --- Nouvelle réservation (téléphone) ---
  router.get('/admin/nouvelle', (req, res) => {
    const date = isValidDate(req.query.date) ? req.query.date : localNow().date;
    render(res, 'admin/new', { title: 'Nouvelle réservation', section: 'nouvelle', values: { date, personnes: 2 }, errors: {} });
  });

  router.post('/admin/nouvelle', async (req, res, next) => {
    const values = { ...req.body };
    try {
      const parsed = adminBookingSchema.safeParse(req.body);
      if (!parsed.success) return render(res, 'admin/new', { title: 'Nouvelle réservation', section: 'nouvelle', values, errors: fieldErrors(parsed.error) }, 422);
      const { reservation, emailSent } = await createAdminBooking(parsed.data);
      res.redirect(303, `/admin?date=${reservation.date}&ok=${emailSent ? 'creee_email' : 'creee'}#r${reservation.id}`);
    } catch (err) {
      if (err instanceof BookingError) {
        return render(res, 'admin/new', { title: 'Nouvelle réservation', section: 'nouvelle', values, errors: { [err.field ?? 'heure']: err.code } }, 409);
      }
      next(err);
    }
  });

  // --- Réglages et fermetures ---
  const settingsPage = async (res, extra = {}, status = 200) => {
    const today = localNow().date;
    const [row, closures] = await Promise.all([repo.getSettingsRow(), repo.getClosures(today, addDays(today, 365))]);
    render(res, 'admin/settings', {
      title: 'Réglages', section: 'reglages', values: row, errors: {}, closures, closureValues: {}, closureErrors: {}, flash: null,
      cutoff: cutoffDate(today, row.conservation_mois), closureConflict: null, ...extra,
    }, status);
  };

  router.get('/admin/reglages', (req, res, next) => settingsPage(res, {
    flash: req.query.ok ?? null, flashN: Number(req.query.n) || 0, flashNotified: Number(req.query.prevenus) || 0,
  }).catch(next));

  router.post('/admin/reglages', async (req, res, next) => {
    try {
      const parsed = settingsSchema.safeParse(req.body);
      if (!parsed.success) return settingsPage(res, { values: req.body, errors: fieldErrors(parsed.error) }, 422);
      await repo.updateSettings(parsed.data);
      res.redirect(303, '/admin/reglages?ok=reglages');
    } catch (err) { next(err); }
  });

  router.post('/admin/fermetures', async (req, res, next) => {
    try {
      const parsed = closureSchema.safeParse(req.body);
      if (!parsed.success) return settingsPage(res, { closureValues: req.body, closureErrors: fieldErrors(parsed.error) }, 422);
      if (parsed.data.date < localNow().date) return settingsPage(res, { closureValues: req.body, closureErrors: { date: 'past' } }, 422);
      const result = await addClosure(parsed.data, { cancelBookings: req.body.annuler_reservations === 'oui' });
      if (result.status === 'has_bookings') {
        return settingsPage(res, { closureValues: req.body, closureConflict: result.bookings }, 409);
      }
      const ok = result.cancelled ? `fermeture_annulations&n=${result.cancelled}&prevenus=${result.notified}` : 'fermeture';
      res.redirect(303, `/admin/reglages?ok=${ok}`);
    } catch (err) { next(err); }
  });

  router.post('/admin/fermetures/:date/supprimer', async (req, res, next) => {
    try {
      if (!isValidDate(req.params.date)) return res.status(400).type('text').send('Date invalide');
      await repo.removeClosure(req.params.date);
      res.redirect(303, '/admin/reglages?ok=fermeture_supprimee');
    } catch (err) { next(err); }
  });

  return router;
}
