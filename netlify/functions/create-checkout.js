// netlify/functions/create-checkout.js

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  body: JSON.stringify(body),
});

function pickEnv(...names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function siteUrlFromEvent(event) {
  // preferisci SITE_URL se presente, altrimenti costruisci da host
  const envSite = pickEnv("SITE_URL", "URL", "DEPLOY_PRIME_URL");
  if (envSite) return envSite.replace(/\/+$/, "");
  const host = event?.headers?.host || event?.headers?.Host;
  if (!host) return ""; // se manca host, gestiamo dopo
  return `https://${host}`.replace(/\/+$/, "");
}

function skuToPriceId(sku) {
  // Supporta più nomi di env per non rompere setup esistente.
  // Imposta almeno UNA delle alternative per ciascun pacchetto.
  const map = {
    SCUSA_BASE: [
      "PRICE_SCUSA_BASE",
      "STRIPE_PRICE_SCUSA_BASE",
      "STRIPE_PRICE_BASE",
      "PRICE_BASE",
    ],
    SCUSA_PREMIUM: [
      "PRICE_SCUSA_PREMIUM",
      "STRIPE_PRICE_SCUSA_PREMIUM",
      "STRIPE_PRICE_PREMIUM",
      "PRICE_PREMIUM",
    ],
    SCUSA_BUSINESS: [
      "PRICE_SCUSA_BUSINESS",
      "STRIPE_PRICE_SCUSA_BUSINESS",
      "STRIPE_PRICE_BUSINESS",
      "PRICE_BUSINESS",
    ],
    SCUSA_DIVERTENTE: [
      "PRICE_SCUSA_DIVERTENTE",
      "STRIPE_PRICE_SCUSA_DIVERTENTE",
      "STRIPE_PRICE_DIVERTENTE",
      "PRICE_DIVERTENTE",
      "PRICE_FUN",
    ],
  };

  const key = (sku || "SCUSA_BASE").toString();
  const envNames = map[key] || map.SCUSA_BASE;

  const priceId = pickEnv(...envNames);
  if (!priceId) {
    // errore chiaro (400) invece di 500 generico
    const tried = envNames.join(", ");
    const msg = `Price ID mancante per ${key}. Imposta una di queste env: ${tried}`;
    const err = new Error(msg);
    err.statusCode = 400;
    throw err;
  }
  return priceId;
}

async function resolvePromotionCodeId(codeRaw) {
  const code = String(codeRaw || "").trim();
  if (!code) return null;

  const list = await stripe.promotionCodes.list({
    code,
    active: true,
    limit: 1,
  });

  const pc = list.data?.[0];
  return pc ? pc.id : null;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Metodo non consentito" });
  }

  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return json(500, { error: "STRIPE_SECRET_KEY mancante" });
    }

    const body = JSON.parse(event.body || "{}");

    // input
    const sku = String(body.sku || "SCUSA_BASE").trim();
    const context = String(body.context || "").trim();
    const message = String(body.message || "").trim();
    const details = String(body.details || "").trim();
    const email = String(body.email || "").trim();

    // promo: deve essere DAVVERO inserito dall’utente
    // (se per qualche motivo il value è "PROMO" lo consideriamo vuoto)
    let promo = String(body.promo || "").trim();
    if (promo.toUpperCase() === "PROMO") promo = "";

    if (!email || !email.includes("@")) {
      return json(400, { error: "Email non valida" });
    }

    const price = skuToPriceId(sku);

    const siteUrl = siteUrlFromEvent(event);
    if (!siteUrl) {
      return json(500, { error: "Impossibile determinare SITE_URL/host" });
    }

    // sconti SOLO se promo è presente e valido
    let discounts;
    if (promo) {
      const promoId = await resolvePromotionCodeId(promo);
      if (!promoId) {
        return json(400, { error: "Codice promo non valido o scaduto." });
      }
      discounts = [{ promotion_code: promoId }];
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [{ price, quantity: 1 }],
      discounts, // undefined se promo vuoto => nessuno sconto
      allow_promotion_codes: false, // usi SOLO il tuo campo

      success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/checkout-canceled.html`,

      metadata: {
        sku,
        context,
        message,
        details,
        email,
        promo: promo || "",
      },
    });

    return json(200, { url: session.url });
  } catch (err) {
    console.error("[create-checkout] error:", err);
    const status = err.statusCode || 500;
    // messaggio utile (ma non leakare stack)
    return json(status, { error: err.message || "Errore creazione checkout" });
  }
};
