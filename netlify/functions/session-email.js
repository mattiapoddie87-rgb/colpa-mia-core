// netlify/functions/session-email.js

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
  },
  body: JSON.stringify(body),
});

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`${name} mancante`);
}

function validateStripeConfig() {
  requireEnv("STRIPE_SECRET_KEY");
}

function validateSmtpConfig() {
  const missing = [];
  if (!process.env.SMTP_HOST) missing.push("SMTP_HOST");
  if (!process.env.SMTP_PORT) missing.push("SMTP_PORT");
  if (!process.env.SMTP_USER) missing.push("SMTP_USER");
  if (!process.env.SMTP_PASS) missing.push("SMTP_PASS");
  if (!process.env.FROM_EMAIL) missing.push("FROM_EMAIL");
  if (missing.length) throw new Error("Configurazione SMTP incompleta. Mancano: " + missing.join(", "));
}

function createTransport() {
  validateSmtpConfig();
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function normalizeSku(rawSku) {
  const s = (rawSku || "").trim();
  const map = {
    SCUSA_BASE: "base",
    SCUSA_PREMIUM: "premium",
    SCUSA_BUSINESS: "business",
    SCUSA_DIVERTENTE: "divertente",
  };
  if (map[s]) return map[s];

  const lower = s.toLowerCase();
  if (["base", "premium", "business", "divertente"].includes(lower)) return lower;

  return "premium";
}

function sanitizeText(t) {
  return (t || "")
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function buildUserBrief({ context, message, details }) {
  const ctx = sanitizeText(context);
  const msg = sanitizeText(message);
  const det = sanitizeText(details);

  const parts = [];
  if (ctx) parts.push(`Scenario: ${ctx}.`);
  if (msg) parts.push(`Situazione: ${msg}.`);
  if (det) parts.push(`Dettagli utili da integrare: ${det}.`);
  return parts.join(" ");
}

function subjectBySku(sku) {
  if (sku === "divertente") return "La tua scusa divertente – COLPA MIA";
  if (sku === "business") return "La tua scusa business – COLPA MIA";
  if (sku === "premium") return "La tua scusa premium – COLPA MIA";
  return "La tua scusa – COLPA MIA";
}

function promptBySku(sku, brief) {
  const commonRules = `
SCRIVI IN ITALIANO.
Non inserire etichette tipo "Contesto:", "Dettagli:", "Note:" o simili.
Integra SEMPRE scenario e dettagli nel corpo della scusa in modo naturale (senza appendici).
Non usare placeholder tipo [nome], [data], [ora].
Consegna SOLO il testo della scusa, senza spiegazioni.
`.trim();

  if (sku === "base") {
    return `
Sei un generatore di scuse credibili per la vita quotidiana.
Obiettivo: una scusa naturale, realistica, semplice.

${commonRules}

Vincoli:
- Lunghezza: 70–120 parole.
- Tono: colloquiale, umano, non troppo formale.
- Integra 1 dettaglio specifico dal brief.
- Chiudi con una proposta breve (recuperiamo / ti aggiorno).

BRIEF:
${brief}
`.trim();
  }

  if (sku === "premium") {
    return `
Sei un copywriter empatico: scrivi una scusa curata, densa, “scritta bene”.
Obiettivo: far percepire attenzione e rispetto.

${commonRules}

Vincoli:
- Lunghezza: 140–220 parole.
- Tono: elegante, empatico, maturo.
- Integra almeno 2 elementi dal brief.
- Inserisci: scuse + spiegazione plausibile + rimedio concreto + alternativa.
- Niente frasi vuote.

BRIEF:
${brief}
`.trim();
  }

  if (sku === "business") {
    return `
Sei un professionista: scusa per lavoro/contesti formali.
Obiettivo: credibilità, responsabilità, soluzione.

${commonRules}

Vincoli:
- Lunghezza: 120–190 parole.
- Registro: professionale, conciso, concreto.
- Struttura: saluto neutro → responsabilità → causa → prossimi passi → chiusura ("Cordiali saluti,").
- Integra scenario + 1 dettaglio dal brief.
- Zero comicità.

BRIEF:
${brief}
`.trim();
  }

  // divertente
  return `
Sei un autore di scuse DIVERTENTI ma PLAUSIBILI.
Obiettivo: far sorridere davvero senza cringe.

${commonRules}

Vincoli comici (OBBLIGATORI):
- Usa 1 meccanismo comico chiaro: iperbole leggera / personificazione / colpo di scena breve.
- Vietati: "Gentile", "Cordiali saluti", "disservizio", tono premium/business.
- Niente volgarità/offese.
- Lunghezza: 70–130 parole.
- Integra scenario + almeno 1 dettaglio del brief (non in coda).
- Chiudi con una proposta ironica ma concreta.

BRIEF:
${brief}
`.trim();
}

async function callOpenAI({ sku, prompt }) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY mancante");

  const paramsBySku = {
    base: { temperature: 0.95, top_p: 0.95, presence_penalty: 0.4, frequency_penalty: 0.2 },
    premium: { temperature: 1.05, top_p: 0.95, presence_penalty: 0.6, frequency_penalty: 0.2 },
    business: { temperature: 0.7, top_p: 0.9, presence_penalty: 0.2, frequency_penalty: 0.15 },
    divertente: { temperature: 1.2, top_p: 0.95, presence_penalty: 0.85, frequency_penalty: 0.25 },
  };

  const p = paramsBySku[sku] || paramsBySku.premium;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: p.temperature,
      top_p: p.top_p,
      presence_penalty: p.presence_penalty,
      frequency_penalty: p.frequency_penalty,
      messages: [
        { role: "system", content: "Sei un generatore di scuse. Segui i vincoli con precisione." },
        { role: "user", content: prompt },
      ],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || "Errore OpenAI");
  return sanitizeText(data?.choices?.[0]?.message?.content || "");
}

function looksTooFormalForFunny(t) {
  const s = (t || "").toLowerCase();
  return (
    s.includes("cordiali saluti") ||
    s.includes("gentile") ||
    s.includes("disservizio") ||
    s.includes("oggetto:")
  );
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Estrae sessionId da GET (?session_id=) o da POST body ({sessionId})
function extractSessionId(event) {
  const qs = event.queryStringParameters || {};
  const fromQs = qs.session_id || qs.sessionId || qs.sessionID;

  if (fromQs) return String(fromQs);

  try {
    const body = JSON.parse(event.body || "{}");
    return body.sessionId || body.session_id || body.sessionID || null;
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  // FIX: accetta sia GET che POST (per compatibilità con success.html)
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return json(405, { error: "Metodo non consentito" });
  }

  try {
    validateStripeConfig();
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }

  const sessionId = extractSessionId(event);
  if (!sessionId) return json(400, { error: "sessionId mancante" });

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error("Errore recupero sessione Stripe:", err);
    return json(500, { error: "Impossibile recuperare la sessione di pagamento da Stripe." });
  }

  // Sicurezza: invia solo se pagato
  if (session.payment_status && session.payment_status !== "paid") {
    return json(400, { error: "Pagamento non completato." });
  }

  const metadata = session.metadata || {};
  const sku = normalizeSku(metadata.sku);
  const context = metadata.context || "";
  const message = metadata.message || "";
  const details = metadata.details || "";

  const customerDetails = session.customer_details || {};
  const email = metadata.email || customerDetails.email;
  if (!email) return json(400, { error: "Email non presente nei metadata/sessione." });

  const brief = buildUserBrief({ context, message, details });
  const subject = subjectBySku(sku);

  let excuseText = "";
  try {
    if (sku === "divertente") {
      // 2 tentativi: se esce troppo “premium”, rigenera
      for (let i = 0; i < 2; i++) {
        const candidate = await callOpenAI({ sku: "divertente", prompt: promptBySku("divertente", brief) });
        if (!looksTooFormalForFunny(candidate)) {
          excuseText = candidate;
          break;
        }
        excuseText = candidate;
      }
    } else {
      excuseText = await callOpenAI({ sku, prompt: promptBySku(sku, brief) });
    }
  } catch (e) {
    console.error("Errore generazione AI:", e);
    return json(500, { error: "Errore durante la generazione AI della scusa: " + e.message });
  }

  let transporter;
  try {
    transporter = createTransport();
  } catch (e) {
    console.error("Errore SMTP:", e);
    return json(500, { error: e.message });
  }

  const safeText = escapeHtml(excuseText);

  try {
    await transporter.sendMail({
      from: process.env.FROM_EMAIL || "no-reply@colpamia.com",
      to: email,
      subject,
      text: excuseText,
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111827;">
          <p>Ciao,</p>
          <p>ecco la tua scusa pronta da copiare e incollare:</p>
          <blockquote style="border-left:4px solid #7c3aed;padding-left:12px;margin:12px 0;font-style:italic;white-space:pre-wrap;">
            ${safeText}
          </blockquote>
          <p>Grazie per aver scelto <strong>COLPA MIA</strong>.</p>
        </div>
      `,
    });

    return json(200, { ok: true });
  } catch (err) {
    console.error("Errore invio email:", err);
    return json(500, { error: "Errore durante l'invio della mail: " + (err.message || "errore sconosciuto") });
  }
};
