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

function getSiteUrl(event) {
  const envSite =
    (process.env.SITE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL || "").trim();
  if (envSite) return envSite.replace(/\/+$/, "");
  const host = (event?.headers?.host || event?.headers?.Host || "").trim();
  return host ? `https://${host}` : "";
}

function getPriceIdFromEnv(primary, fallbacks = []) {
  const candidates = [primary, ...fallbacks];
  for (const name of candidates) {
    const v = (process.env[name] || "").trim();
    if (v) return v;
  }
  return "";
}

function skuToPriceId(skuRaw) {
  const sku = String(skuRaw || "base").toLowerCase().trim();

  // Supporta sia "base/premium/business/divertente" sia "SCUSA_BASE/..."
  const normalized =
    sku.startsWith("scusa_") ? sku.replace("scusa_", "") : sku;

  if (normalized === "premium") {
    const v = getPriceIdFromEnv("PRICE_SCUSA_PREMIUM", [
      "STRIPE_PRICE_SCUSA_PREMIUM",
      "STRIPE_PRICE_PREMIUM",
      "PRICE_PREMIUM",
    ]);
    if (!v) throw new Error("PRICE SCUSA PREMIUM mancante (env).");
    return v;
  }

  if (normalized === "business") {
    const v = getPriceIdFromEnv("PRICE_SCUSA_BUSINESS", [
      "STRIPE_PRICE_SCUSA_BUSINESS",
      "STRIPE_PRICE_BUSINESS",
      "PRICE_BUSINESS",
    ]);
    if (!v) throw new Error("PRICE SCUSA BUSINESS mancante (env).");
    return v;
  }

  if (normalized === "divertente" || normalized === "fun" || normalized === "funny") {
    const v = getPriceIdFromEnv("PRICE_SCUSA_DIVERTENTE", [
      "STRIPE_PRICE_SCUSA_DIVERTENTE",
      "STRIPE_PRICE_DIVERTENTE",
      "PRICE_DIVERTENTE",
      "PRICE_FUN",
    ]);
    if (!v) throw new Error("PRICE SCUSA DIVERTENTE mancante (env).");
    return v;
  }

  // BASE (default)
  const v = getPriceIdFromEnv("PRICE_SCUSA_BASE", [
    "STRIPE_PRICE_SCUSA_BASE",
    "STRIPE_PRICE_BASE",
    "PRICE_BASE",
  ]);
  if (!v) throw new Error("PRICE SCUSA BASE mancante (env).");
  return v;
}

async function resolvePromotionCodeId(codeRaw) {
  const code = String(codeRaw || "").trim();
  if (!code) return null;

  // Se il frontend manda "PROMO" (placeholder finito come value), ignoralo
  if (code.toUpperCase() === "PROMO") return null;

  try {
    const list = await stripe.promotionCodes.list({
      code,
      active: true,
      limit: 1,
    });
    const pc = list.data?.[0];
    return pc ? pc.id : null;
  } catch (e) {
    // Mai bloccare checkout per problemi promo
    console.error("[promo] lookup error:", e);
    return null;
  }
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

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Body JSON non valido" });
    }

    const email = String(body.email || "").trim();
    if (!email || !email.includes("@")) {
      return json(400, { error: "Email non valida" });
    }

    const sku = String(body.sku || "base").trim();
    const context = String(body.context || "").trim();
    const message = String(body.message || "").trim();
    const details = String(body.details || "").trim();

    // promo può essere: mancante / vuoto / "PROMO" / con spazi
    const promoRaw = body.promo;
    const promo = promoRaw == null ? "" : String(promoRaw).trim();

    const priceId = skuToPriceId(sku);

    const siteUrl = getSiteUrl(event);
    if (!siteUrl) {
      return json(500, { error: "SITE_URL mancante e host non rilevabile" });
    }

    // Applica sconto SOLO se promo è valido; altrimenti checkout normale
    const promoId = await resolvePromotionCodeId(promo);
    const discounts = promoId ? [{ promotion_code: promoId }] : undefined;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      discounts, // undefined se promo assente/invalid -> nessuno sconto
      allow_promotion_codes: false, // usa SOLO il tuo campo promo

      success_url: `${siteUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/checkout-canceled.html`,

      metadata: {
        sku,
        context,
        message,
        details,
        email,
        promo: promoId ? promo : "", // salva solo se effettivamente valido
      },
    });

    return json(200, { url: session.url, promoApplied: !!promoId });
  } catch (err) {
    console.error("[create-checkout] error:", err);
    return json(500, { error: err.message || "Errore creazione checkout" });
  }
};
