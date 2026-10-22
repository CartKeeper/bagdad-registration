// Confirmation email. Optional: if SMTP isn't configured, PayPal's own receipt is the only email.

import nodemailer from 'nodemailer';
import { EVENT } from './settings.js';
import { badge, dollars } from './order.js';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Builds the message for a paid registration (people/shirts as stored). */
export function confirmationEmail({ people, shirts, paidCents, confirmation }) {
  const names = people.map(badge).join(', ');
  const shirtCount = shirts.reduce((n, s) => n + s.qty, 0);
  const lines = [
    `You're registered for the ${EVENT.name}!`,
    '',
    `Who: ${names}`,
    `Paid: $${dollars(paidCents)} (confirmation ${confirmation})`,
    ...(shirtCount
      ? [`T-shirts: ${shirts.map((s) => `${s.qty} × ${s.name}, ${s.size}`).join('; ')} — pick up at check-in under ${badge(people[0])}`]
      : []),
    '',
    `When: ${EVENT.dates}`,
    `Where: ${EVENT.place}`,
    `Check-in: ${EVENT.checkIn}`,
    '',
    `Lodging: book with General Butler State Resort Park at ${EVENT.lodgingPhone} or ${EVENT.lodgingUrl}`,
    `Use group code ${EVENT.lodgingCode} for the discounted rate.`,
    '',
    'Please bring a snack or dessert for the hospitality cottage if you can.',
    '',
    `Questions? Reply to this email or write to ${EVENT.contactEmail}.`,
  ];
  const text = lines.join('\n');
  const html =
    '<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#2b2b2b">' +
    lines.map((l) => (l ? `<p style="margin:0 0 4px">${esc(l)}</p>` : '<br>')).join('') +
    '</div>';
  return { subject: `You're registered – ${EVENT.name}`, text, html };
}

/** Returns a send(to, message) function, or null when SMTP isn't set up. */
export function mailer(env) {
  if (!env.SMTP_HOST || !env.EMAIL_FROM) return null;
  const port = Number(env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return (to, { subject, text, html }) =>
    transport.sendMail({ from: env.EMAIL_FROM, replyTo: EVENT.contactEmail, to, subject, text, html });
}
