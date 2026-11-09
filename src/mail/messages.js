import { translator } from '../i18n/index.js';
import { formatters } from '../i18n/format.js';
import { restaurant } from '../content.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(lang, paragraphs, table, link, after = []) {
  const t = translator(lang);
  const footer = `${restaurant.nom} · ${restaurant.adresse.rue}, ${restaurant.adresse.codePostal} ${restaurant.adresse.ville} · ${restaurant.telephone}`;
  const text = [
    ...paragraphs,
    table.map(([k, v]) => `${k} : ${v}`).join('\n'),
    ...(link ? [`${link.label}\n${link.url}`] : []),
    ...after,
    t('mail.signature'),
    `—\n${footer}\n${t('mail.demo')}`,
  ].join('\n\n');
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;background:#F5EEDF;font-family:Arial,sans-serif;color:#1B2420">
<div style="max-width:560px;margin:0 auto;padding:24px">
<p style="font-family:Georgia,serif;font-size:22px;letter-spacing:.05em;color:#1F3B2D;margin:0 0 20px">TI MANGO</p>
${paragraphs.map((p) => `<p style="font-size:16px;line-height:1.5">${esc(p)}</p>`).join('\n')}
<table style="border-collapse:collapse;font-size:16px;margin:16px 0">${table.map(([k, v]) => `<tr><th style="text-align:left;padding:6px 16px 6px 0;font-weight:600">${esc(k)}</th><td style="padding:6px 0">${esc(v)}</td></tr>`).join('')}</table>
${link ? `<p style="font-size:16px">${esc(link.label)}<br><a href="${esc(link.url)}" style="color:#A4472A">${esc(link.url)}</a></p>` : ''}
${after.map((p) => `<p style="font-size:14px;color:#4A4434">${esc(p)}</p>`).join('\n')}
<p style="font-size:16px;white-space:pre-line">${esc(t('mail.signature'))}</p>
<p style="font-size:13px;color:#4A4434;border-top:1px solid #DCCDB0;padding-top:12px">${esc(footer)}<br>${esc(t('mail.demo'))}</p>
</div></body></html>`;
  return { text, html };
}

function details(r, t, fmt) {
  const rows = [
    [t('mail.reference'), r.reference],
    [t('mail.when'), `${fmt.dateLong(r.date)}, ${fmt.time(r.heure)}`],
    [t('mail.guests'), String(r.personnes)],
  ];
  if (r.remarque) rows.push([t('mail.note'), r.remarque]);
  return rows;
}

export function confirmationEmail(r, manageUrl) {
  const t = translator(r.langue); const fmt = formatters(r.langue);
  const body = layout(r.langue,
    [t('mail.hello', { name: r.nom }), t('mail.confirmIntro')],
    details(r, t, fmt),
    manageUrl ? { label: t('mail.manage'), url: manageUrl } : null,
    [t('mail.cancelHint')]);
  return { to: r.email, subject: t('mail.confirmSubject', { date: fmt.dateLong(r.date), time: fmt.time(r.heure) }), ...body };
}

export function cancellationEmail(r, by) {
  const t = translator(r.langue); const fmt = formatters(r.langue);
  const intro = by === 'restaurant' ? t('mail.cancelIntroRestaurant') : t('mail.cancelIntroClient');
  const body = layout(r.langue, [t('mail.hello', { name: r.nom }), intro], details(r, t, fmt), null);
  return { to: r.email, subject: t('mail.cancelSubject', { date: fmt.dateLong(r.date) }), ...body };
}
