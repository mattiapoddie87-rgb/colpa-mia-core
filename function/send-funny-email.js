// netlify/functions/send-funny-email.js

const nodemailer = require('nodemailer');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    ...CORS_HEADERS,
  },
  body: JSON.stringify(body),
});

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Metodo non consentito' });
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Body JSON non valido' });
  }

  const { email, excuseText } = data;

  if (!email || !excuseText) {
    return json(400, { error: 'email ed excuseText sono obbligatori' });
  }

  const transporter = createTransport();

  const mailOptions = {
    from: process.env.FROM_EMAIL || 'no-reply@colpamia.com',
    to: email,
    subject: 'La tua scusa divertente – COLPA MIA',
    text: excuseText,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111827;">
        <p>Ciao,</p>
        <p>ecco la tua scusa divertente pronta da copiare e incollare:</p>
        <blockquote style="border-left:4px solid #7c6dff;padding-left:12px;margin:12px 0;font-style:italic;white-space:pre-wrap;">
          ${excuseText.replace(/</g,'&lt;')}
        </blockquote>
        <p>Firmato,<br><strong>COLPA MIA – Agenzia di scuse su commissione</strong></p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    return json(200, { ok: true });
  } catch (err) {
    console.error('Errore invio email divertente:', err);
    return json(500, { error: 'Errore durante l\'invio della mail' });
  }
};
