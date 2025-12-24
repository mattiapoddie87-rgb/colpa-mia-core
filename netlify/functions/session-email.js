// netlify/functions/session-email.js
//
// Invio email scusa (sempre generata da AI) dopo pagamento.
// Accetta sia GET che POST:
// - GET:  /.netlify/functions/session-email?session_id=...
// - POST: { "session_id": "..."} oppure { "sessionId": "..." }
//
// ENV richieste:
// - STRIPE_SECRET_KEY
// - EMAIL_USER
// - EMAIL_PASS
// - OPENAI_API_KEY

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

const j = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", ...CORS },
  body: JSON.stringify(body),
});

function clean(s) {
  return (s ?? "").toString().trim();
}
function lower(s) {
  return clean(s).toLowerCase();
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

function buildPrompt({ sku, tone, context, details, message, strict }) {
  const strictBlock = strict
    ? `
VINCOLI OBBLIGATORI (se violi uno solo, la risposta è sbagliata):
- NON scrivere "Contesto:" o "Dettagli:" o qualsiasi etichetta simile.
- NON scrivere frasi meta (es. "ti invio una bozza", "scusa strutturata", "calibrata").
- Il contesto deve emergere chiaramente nella scusa (ambientazione/azione coerente).
- I dettagli devono comparire COME FATTI dentro la scusa (non come nota finale).
- Niente elenchi puntati, niente titoli, solo testo pronto da copiare.
`
    : "";

  const effectiveTone =
    tone ||
    (sku === "premium"
      ? "premium (più curato, elegante)"
      : sku === "business"
      ? "business (professionale, credibile)"
      : sku === "divertente"
      ? "divertente (ironico, non volgare)"
      : "base (semplice, credibile)");

  return `
Genera UNA scusa pronta da copiare e incollare in italiano.
Pacchetto: ${sku}.
Tono: ${effectiveTone}.
Contesto scelto dal cliente: ${context || "generico"}.
Dettagli del cliente (da integrare nel testo): ${details || "(nessuno)"}.
Situazione/extra del cliente: ${message || "(vuoto)"}.

${strictBlock}

REQUISITI:
- 70–120 parole.
- Prima persona singolare.
- Deve includere: 1) scusa + responsabilità minima, 2) motivo credibile, 3) rimedio concreto (proposta di recupero).
- Deve essere sempre diversa: cambia apertura, struttura e lessico; evita formule ripetute.
- NON usare etichette come "Contesto:"/"Dettagli:" e NON mettere i dettagli come nota separata.
- Integra contesto e dettagli organicamente.

Scrivi solo la scusa, senza titoli e senza prefazioni.
`.trim();
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
      Authorization: `Bearer ${OPENAI_API_KEY}`,
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

async function generateExcuseAI({ sku, tone, context, details, message }) {
  const detailTokens = extractDetailTokens(details);
  const reference = `${context}\n${details}\n${message}\n${sku}\n${tone}`;

  // 1) non-strict
  const prompt1 = buildPrompt({ sku, tone, context, details, message, strict: false });
  const cands1 = await callOpenAI({ prompt: prompt1, sku });

  let best = cands1[0] || "";
  let bestScore = -1;
  for (const c of cands1) {
    const s = diversityScore(c, reference);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }

  const bad = violatesForbiddenPatterns(best) || !integratesDetails(best, detailTokens);

  // 2) retry strict
  if (bad) {
    const prompt2 = buildPrompt({ sku, tone, context, details, message, strict: true });
    const cands2 = await callOpenAI({ prompt: prompt2, sku });

    let best2 = cands2[0] || best;
    let best2Score = -1;
    for (const c of cands2) {
      const s = diversityScore(c, reference);
      if (s > best2Score) {
        best2Score = s;
        best2 = c;
      }
    }
    best = best2;
  }

  // Guard rail finale
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

function buildEmailSubject(sku) {
  if (sku === "premium") return "La tua scusa premium — COLPA MIA";
  if (sku === "business") return "La tua scusa business — COLPA MIA";
  if (sku === "divertente") return "La tua scusa divertente — COLPA MIA";
  return "La tua scusa — COLPA MIA";
}

function buildEmailText(excuse) {
  return `Ciao,

ecco la tua scusa pronta da copiare e incollare:

${excuse}

Grazie per aver scelto COLPA MIA.
`;
}

function buildEmailHtml(excuse) {
  const safe = (excuse || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");

  return `
<div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
  <p>Ciao,</p>
  <p>ecco la tua scusa pronta da copiare e incollare:</p>
  <div style="border-left: 4px solid #7c3aed; padding-left: 12px; margin: 16px 0;">
    <em>${safe}</em>
  </div>
  <p>Grazie per aver scelto <strong>COLPA MIA</strong>.</p>
</div>
`.trim();
}

function makeTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) throw new Error("EMAIL_USER/EMAIL_PASS mancanti");

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return j(204, {});
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
    return j(405, { error: "Method not allowed" });
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) return j(500, { error: "STRIPE_SECRET_KEY mancante" });
    if (!OPENAI_API_KEY) return j(500, { error: "OPENAI_API_KEY mancante" });

    // --- session_id da GET o POST ---
    let sessionId = "";

    if (event.httpMethod === "GET") {
      sessionId = clean(new URLSearchParams(event.rawQuery || "").get("session_id"));
    }

    if (event.httpMethod === "POST") {
      let body = {};
      try {
        const raw = event.isBase64Encoded
          ? Buffer.from(event.body || "", "base64").toString("utf8")
          : (event.body || "");
        body = raw ? JSON.parse(raw) : {};
      } catch (_) {
        body = {};
      }
      sessionId = sessionId || clean(body.session_id || body.sessionId || "");
    }

    if (!sessionId) return j(400, { error: "session_id mancante" });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const md = session?.metadata || {};

    const sku = lower(md.sku || md.plan || "base");
    const email = clean(md.email || session?.customer_details?.email || "");
    const tone = clean(md.tone || md.style || "");
    const context = clean(md.context || md.scenario || md.category || "");
    const message = clean(md.message || md.notes || "");
    const details = clean(md.details || md.extra || "");

    if (!email) return j(400, { error: "email mancante nei metadata/session" });

    const excuse = await generateExcuseAI({ sku, tone, context, details, message });

    const transporter = makeTransporter();
    const subject = buildEmailSubject(sku);

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject,
      text: buildEmailText(excuse),
      html: buildEmailHtml(excuse),
    });

    return j(200, { ok: true, sentTo: email, sku });
  } catch (e) {
    return j(500, { error: e.message || String(e) });
  }
};
