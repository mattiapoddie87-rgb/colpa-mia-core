// netlify/functions/session-email.js

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");

// Node 18+ ha fetch globale su Netlify runtime
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
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

  if (missing.length) {
    throw new Error("Configurazione SMTP incompleta. Mancano: " + missing.join(", "));
  }
}

function createTransport() {
  validateSmtpConfig();
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function normalizeSku(rawSku) {
  const s = (rawSku || "").trim();

  // accetta sia nuovi che vecchi formati
  const map = {
    SCUSA_BASE: "base",
    SCUSA_PREMIUM: "premium",
    SCUSA_BUSINESS: "business",
    SCUSA_DIVERTENTE: "divertente",
  };

  if (map[s]) return map[s];

  // accetta già normalizzati
  const lower = s.toLowerCase();
  if (["base", "premium", "business", "divertente"].includes(lower)) return lower;

  // fallback ragionevole
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

  // Il brief NON deve diventare "Contesto: ... Dettagli: ..."
  // Deve solo dare materiale all’AI da integrare naturalmente.
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
  // Regole comuni: non mostrare “contesto/dettagli”, integrarli nel testo.
  const commonRules = `
SCRIVI IN ITALIANO.
Non inserire etichette tipo "Contesto:", "Dettagli:", "Note:" o simili.
Integra SEMPRE scenario e dettagli nel corpo della scusa in modo naturale (senza appendici).
Non usare placeholder tipo [nome], [data], [ora].
Non inventare marchi/aziende reali se non necessari.
Consegna SOLO il testo della scusa, senza spiegazioni.
`.trim();

  if (sku === "base") {
    return `
Sei un generatore di scuse credibili per la vita quotidiana.
Obiettivo: una scusa naturale, realistica, semplice, che non sembri scritta da un avvocato.

${commonRules}

Vincoli:
- Lunghezza: 70–120 parole.
- Tono: colloquiale, umano, non troppo formale.
- Deve contenere 1 dettaglio specifico dal brief (senza citarlo come "dettaglio").
- Chiudi con una proposta breve (es. recuperiamo domani / ti aggiorno tra poco).

BRIEF:
${brief}
`.trim();
  }

  if (sku === "premium") {
    return `
Sei un copywriter empatico: scrivi una scusa curata, densa, “scritta bene”, credibile.
Obiettivo: far percepire attenzione e rispetto, mantenendo il rapporto.

${commonRules}

Vincoli:
- Lunghezza: 140–220 parole.
- Tono: elegante, empatico, maturo (non formale rigido).
- Integra almeno 2 elementi dal brief (scenario + 1 dettaglio).
- Inserisci: (1) scuse + (2) spiegazione plausibile + (3) rimedio concreto + (4) proposta di alternativa.
- Niente frasi vuote tipo “mi scuso per il disagio” senza contenuto.

BRIEF:
${brief}
`.trim();
  }

  if (sku === "business") {
    return `
Sei un professionista: scrivi una scusa adatta a lavoro/contesti formali (collega, cliente, responsabile).
Obiettivo: credibilità, responsabilità, soluzione.

${commonRules}

Vincoli:
- Lunghezza: 120–190 parole.
- Registro: professionale, conciso, concreto.
- Struttura consigliata:
  1) Apertura breve (saluto neutro)
  2) Assunzione responsabilità (1 frase)
  3) Causa plausibile (1–2 frasi)
  4) Azioni correttive / prossimi passi (2–4 punti in linea, NON elenco puntato)
  5) Chiusura con disponibilità e firma "Cordiali saluti,"
- Integra scenario + 1 dettaglio dal brief.
- Non essere comico.

BRIEF:
${brief}
`.trim();
  }

  // divertente
  return `
Sei un autore di scuse DIVERTENTI ma PLAUSIBILI.
Obiettivo: far sorridere davvero senza risultare cringe, mantenendo credibilità.

${commonRules}

Vincoli comici (OBBLIGATORI):
- Usa 1 meccanismo comico chiaro: iperbole leggera / personificazione / colpo di scena breve.
- Niente formalismi (vietati: "Gentile", "Cordiali saluti", "mi scuso per il disservizio").
- Niente volgarità, niente offese, niente umorismo “aggressivo”.
- Lunghezza: 70–130 parole.
- Integra scenario + almeno 1 dettaglio del brief dentro la scusa, non in coda.
- Chiudi con una proposta ironica ma concreta (es. recupero con caffè / ti aggiorno / domani ci sono).

BRIEF:
${brief}
`.trim();
}

async function callOpenAI({ sku, prompt }) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY mancante");
  }

  // Parametri realmente diversi per profondità/tono
  const paramsBySku = {
    base: {
      temperature: 0.95,
      top_p: 0.95,
      presence_penalty: 0.4,
      frequency_penalty: 0.2,
    },
    premium: {
      temperature: 1.05,
      top_p: 0.95,
      presence_penalty: 0.6,
      frequency_penalty: 0.2,
    },
    business: {
      temperature: 0.7,
      top_p: 0.9,
      presence_penalty: 0.2,
      frequency_penalty: 0.15,
    },
    divertente: {
      temperature: 1.2,
      top_p: 0.95,
      presence_penalty: 0.85,
      frequency_penalty: 0.25,
    },
  };

  const p = paramsBySku[sku] || paramsBySku.premium;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
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
  if (!res.ok) {
    const msg = data?.error?.message || "Errore OpenAI";
    throw new Error(msg);
  }

  const text = data?.choices?.[0]?.message?.content || "";
  return sanitizeText(text);
}

function looksTooFormalForFunny(t) {
  const s = (t || "").toLowerCase();
  return (
    s.includes("cordiali saluti") ||
    s.includes("gentile") ||
    s.includes("disservizio") ||
    s.includes("prendo piena responsabilità") ||
    s.includes("oggetto:")
  );
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Metodo non consentito" });
  }

  try {
    validateStripeConfig();
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Body JSON non valido" });
  }

  const sessionId = data.sessionId;
  if (!sessionId) return json(400, { error: "sessionId mancante" });

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error("Errore recupero sessione Stripe:", err);
    return json(500, { error: "Impossibile recuperare la sessione di pagamento da Stripe." });
  }

  const metadata = session.metadata || {};
  const sku = normalizeSku(metadata.sku);
  const context = metadata.context || "";
  const message = metadata.message || "";
  const details = metadata.details || "";

  const customerDetails = session.customer_details || {};
  const email = metadata.email || customerDetails.email;

  if (!email) {
    return json(400, { error: "Email non presente nei metadata/sessione. Contattaci indicando il tuo ordine." });
  }

  const brief = buildUserBrief({ context, message, details });
  const subject = subjectBySku(sku);

  // Generazione AI con logiche diverse
  let excuseText = "";
  try {
    if (sku === "divertente") {
      // 2 tentativi per evitare che esca “premium mascherata”
      for (let i = 0; i < 2; i++) {
        const prompt = promptBySku("divertente", brief);
        const candidate = await callOpenAI({ sku: "divertente", prompt });
        if (!looksTooFormalForFunny(candidate)) {
          excuseText = candidate;
          break;
        }
        excuseText = candidate; // fallback
      }
    } else {
      const prompt = promptBySku(sku, brief);
      excuseText = await callOpenAI({ sku, prompt });
    }
  } catch (e) {
    console.error("Errore generazione AI:", e);
    return json(500, { error: "Errore durante la generazione AI della scusa: " + e.message });
  }

  // Invio email
  let transporter;
  try {
    transporter = createTransport();
  } catch (e) {
    console.error("Errore SMTP:", e);
    return json(500, { error: e.message });
  }

  const safeText = escapeHtml(excuseText);

  const mailOptions = {
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
  };

  try {
    await transporter.sendMail(mailOptions);
    return json(200, { ok: true });
  } catch (err) {
    console.error("Errore invio email:", err);
    return json(500, { error: "Errore durante l'invio della mail: " + (err.message || "errore sconosciuto") });
  }
};
