// Envoi des emails. Par défaut (MAIL_TRANSPORT=file) rien ne part : chaque message est écrit
// en .eml dans MAIL_DIR pour pouvoir être ouvert et vérifié. SMTP réel uniquement en production.
import nodemailer from 'nodemailer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';

let transport = config.MAIL_TRANSPORT === 'smtp'
  ? nodemailer.createTransport(config.SMTP_URL)
  : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

/** Derniers messages produits (inspection en développement et en test). */
export const outbox = [];

export async function sendMail({ to, subject, text, html }) {
  const info = await transport.sendMail({ from: config.MAIL_FROM, to, subject, text, html });
  if (config.MAIL_TRANSPORT === 'file') {
    await mkdir(config.MAIL_DIR, { recursive: true });
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}.eml`;
    await writeFile(path.join(config.MAIL_DIR, name), info.message);
  }
  outbox.push({ to, subject, text, html });
  if (outbox.length > 50) outbox.shift();
  return info;
}

/** Tests uniquement : remplace le transport (ex. pour simuler une panne). */
export function setTransportForTests(t) {
  if (config.NODE_ENV !== 'test') throw new Error('réservé aux tests');
  transport = t;
}
