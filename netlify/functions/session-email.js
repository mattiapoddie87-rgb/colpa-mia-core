// netlify/functions/session-email.js

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");

// ---------------- CORS ----------------
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  body: JSON.stringify(body),
});

// ---------------- VALIDATION ----------------
function validateStripeConfig() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY non impostata");
  }
}

function validateSmtpConfig() {
  const missing = [];
  if (!process.env.SMTP_HOST) missing.push("SMTP_HOST");
  if (!process.env.SMTP_PORT) missing.push("SMTP_PORT");
  if (!process.env.SMTP_USER) missing.push("SMTP_USER");
  if (!process.env.SMTP_PASS) missing.push("SMTP_PASS");
  if (!process.env.FROM_EMAIL) missing.push("FROM_EMAIL");
  if (missing.length) {
    throw new Error("Configurazione SMTP incompleta: " + missing.join(", "));
  }
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

// ---------------- UTILS ----------------
function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeSpaces(s) {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function subjectBySku(sku) {
  if (sku === "SCUSA_DIVERTENTE") return "La tua scusa divertente – COLPA MIA";
  if (sku === "SCUSA_PREMIUM") return "La tua scusa premium – COLPA MIA";
  if (sku === "SCUSA_BUSINESS") return "Comunicazione formale – COLPA MIA";
  return "La tua scusa – COLPA MIA";
}

function extractDetailTokens(details) {
  const text = String(details || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ");
  const tokens = text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4)
    .filter(
      (t) =>
        ![
          "che",
          "alla",
          "dalla",
          "delle",
          "della",
          "dello",
          "sono",
          "però",
          "quindi",
          "anche",
          "solo",
          "come",
          "quando",
          "perché",
          "questa",
          "quello",
          "quella",
          "stato",
          "stata",
        ].includes(t)
    );
  return Array.from(new Set(tokens)).slice(0, 12);
}

function textIncludesAnyToken(text, tokens) {
  const hay = String(text || "").toLowerCase();
  return tokens.some((t) => hay.includes(t));
}

// ---------------- FALLBACK BREVI ----------------
function fallbackExcuse({ sku, context, message, details }) {
  const ctx = context ? `${context}` : "la situazione";
  const msg = message ? `${message}` : "ho un imprevisto";
  const det = details ? `${details}` : "";

  if (sku === "SCUSA_BUSINESS") {
    const body = normalizeSpaces(
      `Gentile destinatario,

desidero scusarmi per l’inconveniente relativo a ${ctx}. ${msg ? `In breve: ${msg}.` : ""} ${
        det ? `Vincolo rilevante: ${det}.` : ""
      }

Sto intervenendo per minimizzare l’impatto e propongo:
- aggiornamento entro oggi con tempistiche riviste
- piano di recupero con priorità e responsabilità chiare

Resto a disposizione per concordare la soluzione più adatta.

Cordiali saluti.`
    );
    return { subject: subjectBySku(sku), text: body, isFallback: true };
  }

  if (sku === "SCUSA_PREMIUM") {
    const body = normalizeSpaces(
      `Ciao,

mi dispiace davvero: su ${ctx} voglio essere corretto e non lasciarti con un “buco”. ${
        msg ? `È successo questo: ${msg}.` : ""
      } ${det ? `In più: ${det}.` : ""}

Preferisco recuperare bene: ti propongo domani alla stessa ora, oppure dimmi tu una fascia e mi adeguo.

Grazie per la pazienza.`
    );
    return { subject: subjectBySku(sku), text: body, isFallback: true };
  }

  if (sku === "SCUSA_DIVERTENTE") {
    const body = normalizeSpaces(
      `Ok, confessione: oggi non ce la faccio su ${ctx}. ${msg ? `Motivo ufficiale: ${msg}.` : ""} ${
        det ? `Plot twist: ${det}.` : ""
      }
Recupero con stile: domani stessa ora oppure scegli tu un’alternativa e mi faccio perdonare.`
    );
    return { subject: subjectBySku(sku), text: body, isFallback: true };
  }

  const body = normalizeSpaces(
    `Ciao! Purtroppo su ${ctx} non riesco: ${msg || "ho un imprevisto"}. ${det ? `(${det})` : ""}
Se ti va, recuperiamo domani oppure ti propongo io un orario appena posso.`
  );
  return { subject: subjectBySku(sku), text: body, isFallback: true };
}

// ---------------- PROMPT (BREVE + OBBLIGO DETTAGLI) ----------------
function wordRangeBySku(sku) {
  if (sku === "SCUSA_BASE") return "45–80";
  if (sku === "SCUSA_PREMIUM") return "90–150";
  if (sku === "SCUSA_BUSINESS") return "90–150";
  if (sku === "SCUSA_DIVERTENTE") return "60–110";
  return "60–110";
}

function systemBySku(sku) {
  if (sku === "SCUSA_BUSINESS") {
    return "Sei un consulente di comunicazione aziendale. Scrivi email formali, concise, orientate alla soluzione.";
  }
  if (sku === "SCUSA_PREMIUM") {
    return "Sei un ghostwriter empatico. Scrivi scuse curate, credibili, senza risultare prolisso.";
  }
  if (sku === "SCUSA_DIVERTENTE") {
    return "Sei un autore comico italiano. Scrivi scuse ironiche ma plausibili, mai volgari, mai pesanti.";
  }
  return "Sei un copywriter italiano. Scrivi scuse credibili e brevi.";
}

function promptBySku({ sku, context, message, details, forceUseDetails }) {
  const wr = wordRangeBySku(sku);

  const userParams = normalizeSpaces(`
PARAMETRI (da integrare nel testo in modo naturale, senza etichette finali tipo "Contesto:" o "Dettagli:"):
- Contesto: ${context || "(non specificato)"}
- Situazione: ${message || "(non specificata)"}
- Dettagli aggiuntivi: ${details || "(nessuno)"}
`);

  const commonRules = normalizeSpaces(`
REGOLE:
- Lunghezza: ${wr} parole.
- Integra contesto/situazione/dettagli dentro la scusa (NON elencarli in fondo).
- Niente sezioni tipo "Dettagli:" / "Contesto:" / "Note:".
- Una sola versione.
- Inserisci SEMPRE una proposta concreta per recuperare (orario o alternativa).
${forceUseDetails && details ? "- OBBLIGATORIO: inserisci almeno UN dettaglio specifico dal campo 'Dettagli aggiuntivi' nel corpo del testo." : ""}
`);

  if (sku === "SCUSA_BUSINESS") {
    return normalizeSpaces(`
Scrivi UNA scusa BUSINESS in stile email formale.
Vincoli:
- tono professionale, nessun umorismo
- struttura compatta: apertura + responsabilità + causa plausibile + 2-3 next step concreti + chiusura

${userParams}

${commonRules}
`);
  }

  if (sku === "SCUSA_PREMIUM") {
    return normalizeSpaces(`
Scrivi UNA scusa PREMIUM: più curata della base ma non lunga.
Vincoli:
- empatia reale + responsabilità + spiegazione plausibile
- proposta concreta (due opzioni) per recuperare

${userParams}

${commonRules}
`);
  }

  if (sku === "SCUSA_DIVERTENTE") {
    return normalizeSpaces(`
Scrivi UNA scusa DIVERTENTE che faccia sorridere davvero.
Vincoli:
- ironia chiara (1 elemento comico originale), ma plausibile
- niente tono premium/business
- proposta concreta per recuperare
- niente volgarità

${userParams}

${commonRules}
`);
  }

  return normalizeSpaces(`
Scrivi UNA scusa BASE breve e credibile.
Vincoli:
- diretta e naturale
- proposta concreta di recupero

${userParams}

${commonRules}
`);
}

function paramsBySku(sku) {
  if (sku === "SCUSA_BUSINESS") {
    return { temperature: 0.55, top_p: 0.9, presence_penalty: 0.2, frequency_penalty: 0.25 };
  }
  if (sku === "SCUSA_PREMIUM") {
    return { temperature: 0.85, top_p: 0.95, presence_penalty: 0.35, frequency_penalty: 0.25 };
  }
  if (sku === "SCUSA_DIVERTENTE") {
    return { temperature: 1.0, top_p: 0.95, presence_penalty: 0.55, frequency_penalty: 0.35 };
  }
  return { temperature: 0.75, top_p: 0.9, presence_penalty: 0.25, frequency_penalty: 0.25 };
}

async function callOpenAI({ sku, context, message, details, forceUseDetails }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, reason: "missing_api_key" };

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const prompt = promptBySku({ sku, context, message, details, forceUseDetails });
  const p = paramsBySku(sku);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: p.temperature,
        top_p: p.top_p,
        presence_penalty: p.presence_penalty,
        frequency_penalty: p.frequency_penalty,
        messages: [
          { role: "system", content: systemBySku(sku) },
          { role: "user", content: prompt },
        ],
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      return { ok: false, reason: `openai_error:${res.status}`, message: msg };
    }

    const text = normalizeSpaces(data?.choices?.[0]?.message?.content || "");
    if (!text) return { ok: false, reason: "empty_generation" };
    return { ok: true, text, modelUsed: model };
  } catch (e) {
    return { ok: false, reason: "fetch_failed", message: e?.message || String(e) };
  }
}

// ---------------- SESSION ID PARSING (GET + POST) ----------------
function getSessionId(event) {
  // supporta:
  // - GET /.netlify/functions/session-email?session_id=...  (Stripe standard)
  // - GET /.netlify/functions/session-email?sessionId=...
  // - POST { sessionId: "..." }
  const qs = event.queryStringParameters || {};
  const sidFromQuery = qs.session_id || qs.sessionId;

  if (sidFromQuery) return sidFromQuery;

  if (event.httpMethod === "POST") {
    try {
      const body = JSON.parse(event.body || "{}");
      return body.sessionId || body.session_id;
    } catch {
      return null;
    }
  }

  return null;
}

// ---------------- HANDLER ----------------
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  // Accetta GET e POST (fix 405)
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return json(405, { error: "Metodo non consentito" });
  }

  try {
    validateStripeConfig();
  } catch (e) {
    console.error("[session-email] Stripe config error:", e);
    return json(500, { error: "Configurazione pagamento non valida." });
  }

  const sessionId = getSessionId(event);
  if (!sessionId) return json(400, { error: "sessionId mancante" });

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error("[session-email] Stripe retrieve error:", err);
    return json(500, { error: "Impossibile recuperare la sessione di pagamento." });
  }

  const metadata = session.metadata || {};
  const customerDetails = session.customer_details || {};
  const email = metadata.email || customerDetails.email;

  if (!email) return json(400, { error: "Email mancante." });

  const sku = metadata.sku || "SCUSA_BASE";
  const context = metadata.context || "";
  const message = metadata.message || "";
  const details = metadata.details || "";

  // 1) AI
  const tokens = extractDetailTokens(details);
  const ai1 = await callOpenAI({ sku, context, message, details, forceUseDetails: false });

  let excuseText = "";
  let usedFallback = false;
  let usedRetry = false;

  if (ai1.ok) {
    excuseText = ai1.text;
  } else {
    const fb = fallbackExcuse({ sku, context, message, details });
    excuseText = fb.text;
    usedFallback = true;
    console.warn("[session-email] OpenAI failed -> fallback:", { reason: ai1.reason, msg: ai1.message });
  }

  // 2) obbligo dettagli (se presenti) con 1 retry
  if (!usedFallback && details && tokens.length > 0) {
    if (!textIncludesAnyToken(excuseText, tokens)) {
      const ai2 = await callOpenAI({ sku, context, message, details, forceUseDetails: true });
      if (ai2.ok) {
        excuseText = ai2.text;
        usedRetry = true;
      } else {
        const fb = fallbackExcuse({ sku, context, message, details });
        excuseText = fb.text;
        usedFallback = true;
        console.warn("[session-email] Retry failed -> fallback:", { reason: ai2.reason, msg: ai2.message });
      }
    }
  }

  // 3) invio mail
  let transporter;
  try {
    transporter = createTransport();
  } catch (e) {
    console.error("[session-email] SMTP config error:", e);
    return json(500, { error: "Errore invio email." });
  }

  const subject = subjectBySku(sku);

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111827;">
      <p>Ciao,</p>
      <p>ecco la tua scusa pronta da copiare e incollare:</p>
      <blockquote style="border-left:4px solid #7c3aed;padding-left:12px;margin:12px 0;font-style:italic;white-space:pre-wrap;">
        ${escapeHtml(excuseText)}
      </blockquote>
      <p>Grazie per aver scelto <strong>COLPA MIA</strong>.</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: email,
      subject,
      text: excuseText,
      html,
    });
    return json(200, { ok: true, usedFallback, usedRetry });
  } catch (err) {
    console.error("[session-email] sendMail error:", err);
    return json(500, { error: "Errore durante l’invio della mail." });
  }
};
