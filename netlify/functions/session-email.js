// netlify/functions/session-email.js
// Invia via email la scusa generata per una Stripe Checkout Session.
// NOTA: i dettagli opzionali NON vengono più appesi in coda al testo.
// Devono essere integrati nel prompt AI (gestito da post-checkout.js).

const nodemailer = require('nodemailer');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

const j = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(body),
});

function clean(s) {
  return (s ?? '').toString().trim();
}

async function fetchStripeSession(sessionId) {
  const resp = await fetch(
    'https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId),
    {
      headers: {
        Authorization: 'Bearer ' + process.env.STRIPE_SECRET_KEY,
      },
    }
  );
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error?.message || 'Stripe error');
  }
  return data;
}

async function fetchGeneratedExcuse(siteUrl, sessionId) {
  const url =
    siteUrl.replace(/\/$/, '') +
    '/.netlify/functions/post-checkout?session_id=' +
    encodeURIComponent(sessionId);

  const resp = await fetch(url, { method: 'GET' });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data?.error || 'post-checkout error');
  }
  return data; // { excuse, metadata }
}

function buildEmailText(excuse) {
  // NIENTE append di details qui.
  return `Ciao,

ecco la tua scusa pronta da copiare e incollare:

${excuse}

Grazie per aver scelto COLPA MIA.
`;
}

function buildEmailHtml(excuse) {
  // Versione HTML minimale (senza “Dettagli da tenere in conto”).
  const esc = (s) =>
    (s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.5;color:#111;">
    <p>Ciao,</p>
    <p>ecco la tua scusa pronta da copiare e incollare:</p>
    <div style="padding:12px 14px;border-left:4px solid #6c5ce7;background:#f7f7ff;margin:12px 0;">
      <em>${esc(excuse)}</em>
    </div>
    <p>Grazie per aver scelto <strong>COLPA MIA</strong>.</p>
  </div>
  `;
}

function getTransporter() {
  const host = clean(process.env.SMTP_HOST);
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = clean(process.env.SMTP_USER);
  const pass = clean(process.env.SMTP_PASS);

  if (!host || !port || !user || !pass) {
    throw new Error('SMTP env mancante: SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = true, 587 = false
    auth: { user, pass },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return j(204, {});
  if (event.httpMethod !== 'GET') return j(405, { error: 'Method not allowed' });

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return j(500, { error: 'STRIPE_SECRET_KEY mancante' });
    }

    const siteUrl = clean(process.env.SITE_URL) || '';
    if (!siteUrl) {
      return j(500, { error: 'SITE_URL mancante (es. https://tuodominio.com)' });
    }

    const sessionId = new URLSearchParams(event.rawQuery || '').get('session_id');
    if (!sessionId) return j(400, { error: 'session_id mancante' });

    // 1) Recupera sessione Stripe per email destinatario
    const session = await fetchStripeSession(sessionId);
    const to =
      clean(session.customer_details?.email) ||
      clean(session.customer_email) ||
      '';

    if (!to) return j(400, { error: 'Email destinatario non trovata in sessione Stripe' });

    // 2) Genera scusa (via post-checkout => OpenAI)
    const { excuse } = await fetchGeneratedExcuse(siteUrl, sessionId);
    const finalExcuse = clean(excuse);

    if (!finalExcuse) return j(500, { error: 'Scusa vuota (post-checkout)' });

    // 3) Invio email
    const transporter = getTransporter();
    const from = clean(process.env.MAIL_FROM) || 'COLPA MIA <noreply@colpamia.com>';

    const subject = 'La tua scusa COLPA MIA è pronta';
    const text = buildEmailText(finalExcuse);
    const html = buildEmailHtml(finalExcuse);

    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });

    return j(200, { ok: true, to, session_id: sessionId });
  } catch (err) {
    return j(500, { error: err?.message || String(err) });
  }
};
