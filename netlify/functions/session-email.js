// netlify/functions/session-email.js
//
// Invio email scusa dopo pagamento.
// - Recupera Checkout Session Stripe
// - Genera la scusa con OpenAI usando CONTEXT + DETAILS (integrati nel testo, no etichette)
// - Invia email via SMTP (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS + FROM_EMAIL)
//
// Supporta:
// - GET  /.netlify/functions/session-email?session_id=...
// - POST { sessionId: "..." } oppure { session_id: "..." }

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");

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

function clean(s) {
  return (s ?? "").toString().trim();
}
function lower(s) {
  return clean(s).toLowerCase();
}

function validateStripeConfig() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Configurazione Stripe mancante: STRIPE_SECRET_KEY non impostata");
  }
}

function validateOpenAIConfig() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Configurazione OpenAI mancante: OPENAI_API_KEY non impostata");
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
    throw new Error("Configurazione SMTP incompleta. Mancano: " + missing.join(", "));
  }
}

function createTransport() {
  validateSmtpConfig();
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// Compatibilità SKU vecchi -> nuovi
function normalizeSku(rawSku) {
  const s = clean(rawSku);
  if (!s) return "base";

  const u = s.toUpperCase();
  if (u === "SCUSA_DIVERTENTE") return "divertente";
  if (u === "SCUSA_PREMIUM") return "premium";
  if (u === "SCUSA_BUSINESS") return "business";
  if (u === "SCUSA_BASE") return "base";

  // se già in formato nuovo
  const l = lower(s);
  if (["base", "premium", "business", "divertente"].includes(l)) return l;

  return "base";
}

function normalizeContext(rawContext) {
  // compatibilità: "DIVERTENTE_CENA" -> "CENA"
  const c = clean(rawContext);
  return c.replace(/^DIVERTENTE_/, "");
}

function buildEmailSubject(sku) {
  if (sku === "premium") return "La tua scusa premium — COLPA MIA";
  if (sku === "business") return "La tua scusa business — COLPA MIA";
  if (sku === "divertente") return "La tua scusa divertente — COLPA MIA";
  return "La tua scusa — COLPA MIA";
}

function buildPrompt({ sku, context, details, message, strict }) {
  const tone =
    sku === "business"
      ? "professionale, credibile, concreto"
      : sku === "premium"
      ? "curato, elegante, empatico"
      : sku === "divertente"
      ? "ironico e leggero, non volgare, comunque credibile"
      : "semplice, naturale, credibile";

  const strictBlock = strict
    ? `
VINCOLI OBBLIGATORI:
- NON usare etichette come "Contesto:" o "Dettagli:".
- NON scrivere frasi meta tipo "ti invio una bozza", "scusa strutturata", "calibrata".
- Il contesto deve emergere chiaramente nella scusa (ambientazione/azione coerente).
- I dettagli devono comparire come fatti dentro la scusa (non in nota finale).
- Niente elenchi puntati, niente titoli: solo testo pronto da copiare.
`
    : "";

  return `
Scrivi UNA scusa in italiano pronta da copiare e incollare.
Tono: ${tone}.
Lunghezza: 70–120 parole.
Voce: prima persona singolare.

Contesto scelto dal cliente: ${context || "generico"}.
Dettagli del cliente da integrare nel testo: ${details || "(nessuno)"}.
Situazione/extra: ${message || "(vuoto)"}.

${strictBlock}

REQUISITI:
- Deve includere: 1) scusa, 2) motivo credibile, 3) rimedio concreto (proposta recupero).
- Deve essere sempre diversa: cambia apertura/struttura/lessico.
- Integra contesto e dettagli dentro la scusa, senza etichette.

Scrivi SOLO la scusa.
`.trim();
}

function violatesForbiddenPatterns(text) {
  const t = lower(text);
  const forbidden = [
    "ti invio di seguito",
    "bozza di scusa",
    "scusa strutturata",
    "calibrata",
    "contesto:",
    "dettagli:",
    "dettagli da tenere",
    "ecco una bozza",
    "ti lascio una bozza",
  ];
  return forbidden.some((f) => t.includes(f));
}

function extractDetailTokens(details) {
  const tokens = lower(details)
    .split(/\W+/)
    .filter((w) => w.length >= 4)
    .slice(0, 12);
  return [...new Set(tokens)];
}

function integratesDetails(text, detailTokens) {
  if (!detailTokens.length) return true;
  const t = lower(text);
  return detailTokens.some((tok) => t.includes(tok));
}

function diversityScore(candidate, reference) {
  const a = new Set(lower(candidate).split(/\W+/).filter((w) => w.length >= 4));
  const b = new Set(lower(reference).split(/\W+/).filter((w) => w.length >= 4));
  if (!a.size) return 0;
  let overlap = 0;
  for (const w of a) if (b.has(w)) overlap++;
  return 1 - overlap / Math.max(1, a.size);
}

async function callOpenAI({ prompt, sku }) {
  const isFunny = sku === "divertente";

  const payload = {
    model: "gpt-4.1-mini",
    temperature: isFunny ? 1.15 : 1.05,
    top_p: 0.9,
    presence_penalty: isFunny ? 0.75 : 0.6,
    frequency_penalty: 0.55,
    n: 3,
    messages: [
      {
        role: "system",
        content:
          "Sei un copywriter italiano. Scrivi scuse credibili, naturali e varie. Niente meta-commenti, niente etichette.",
      },
      { role: "user", content: prompt },
    ],
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || "OpenAI error");

  return (d.choices || [])
    .map((c) => clean(c?.message?.content))
    .filter(Boolean);
}

async function generateExcuseAI({ sku, context, details, message }) {
  const detailTokens = extractDetailTokens(details);
  const reference = `${context}\n${details}\n${message}\n${sku}`;

  // 1) first pass
  const p1 = buildPrompt({ sku, context, details, message, strict: false });
  const c1 = await callOpenAI({ prompt: p1, sku });

  let best = c1[0] || "";
  let bestScore = -1;
  for (const c of c1) {
    const s = diversityScore(c, reference);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }

  const bad = violatesForbiddenPatterns(best) || !integratesDetails(best, detailTokens);

  // 2) strict retry
  if (bad) {
    const p2 = buildPrompt({ sku, context, details, message, strict: true });
    const c2 = await callOpenAI({ prompt: p2, sku });

    let best2 = c2[0] || best;
    let best2Score = -1;
    for (const c of c2) {
      const s = diversityScore(c, reference);
      if (s > best2Score) {
        best2Score = s;
        best2 = c;
      }
    }
    best = best2;
  }

  // last cleanup guard
  if (violatesForbiddenPatterns(best)) {
    best = best
      .replace(/Contesto:\s*.*(\n|$)/gi, "")
      .replace(/Dettagli:\s*.*(\n|$)/gi, "")
      .replace(/ti invio.*(\n|$)/gi, "")
      .replace(/bozza.*(\n|$)/gi, "")
      .trim();
  }

  return best;
}

function buildEmailHtml(text) {
  const safe = (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111827;">
      <p>Ciao,</p>
      <p>ecco la tua scusa pronta da copiare e incollare:</p>
      <blockquote style="border-left:4px solid #7c6dff;padding-left:12px;margin:12px 0;font-style:italic;white-space:pre-wrap;">
        ${safe}
      </blockquote>
      <p>Grazie per aver scelto <strong>COLPA MIA</strong>.</p>
    </div>
  `;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return json(405, { error: "Metodo non consentito" });
  }

  try {
    validateStripeConfig();
    validateOpenAIConfig();
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }

  // session_id da GET o POST
  let sessionId = "";
  if (event.httpMethod === "GET") {
    sessionId = clean(new URLSearchParams(event.rawQuery || "").get("session_id"));
  } else {
    let data = {};
    try {
      data = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Body JSON non valido" });
    }
    sessionId = clean(data.sessionId || data.session_id || "");
  }

  if (!sessionId) {
    return json(400, { error: "session_id/sessionId mancante" });
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error("Errore nel recupero sessione Stripe:", err);
    return json(500, { error: "Impossibile recuperare la sessione di pagamento da Stripe." });
  }

  const metadata = session.metadata || {};
  const customerDetails = session.customer_details || {};

  const sku = normalizeSku(metadata.sku || metadata.plan);
  const context = normalizeContext(metadata.context || "");
  const details = clean(metadata.details || "");
  const message = clean(metadata.message || metadata.notes || "");
  const email = clean(metadata.email || customerDetails.email || "");

  if (!email) {
    return json(400, {
      error: "Email non presente nei metadata/sessione. Contattaci e indica il tuo ordine.",
    });
  }

  // Generazione AI (sempre)
  let excuse;
  try {
    excuse = await generateExcuseAI({ sku, context, details, message });
  } catch (err) {
    console.error("Errore OpenAI:", err);
    return json(500, { error: "Errore generazione AI: " + (err.message || "errore sconosciuto") });
  }

  // Invio email via SMTP (come prima)
  let transporter;
  try {
    transporter = createTransport();
  } catch (e) {
    console.error("Errore configurazione SMTP:", e);
    return json(500, { error: e.message });
  }

  const subject = buildEmailSubject(sku);

  const mailOptions = {
    from: process.env.FROM_EMAIL || "no-reply@colpamia.com",
    to: email,
    subject,
    text: excuse,
    html: buildEmailHtml(excuse),
  };

  try {
    await transporter.sendMail(mailOptions);
    return json(200, { ok: true });
  } catch (err) {
    console.error("Errore invio email:", err);
    return json(500, {
      error: "Errore durante l'invio della mail: " + (err.message || "errore sconosciuto"),
    });
  }
};
