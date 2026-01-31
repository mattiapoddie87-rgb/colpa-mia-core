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

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} mancante in env`);
  return v;
}

// Mappa SKU a ID prezzo Stripe (definiti nelle env)
function skuToPriceId(sku) {
  switch (sku) {
    case "SCUSA_PREMIUM":
      return mustEnv("PRICE_SCUSA_PREMIUM");
    case "SCUSA_BUSINESS":
      return mustEnv("PRICE_SCUSA_BUSINESS");
    case "SCUSA_DIVERTENTE":
      return mustEnv("PRICE_SCUSA_DIVERTENTE");
    case "SCUSA_BASE":
    default:
      return mustEnv("PRICE_SCUSA_BASE");
  }
}

// Se l’utente inserisce un codice, verifica che esista un promotion code attivo in Stripe.
// Restituisce l’ID del promotion code se valido, altrimenti null.
async function resolvePromotionCodeId(codeRaw) {
  const code = String(codeRaw || "").trim();
  if (!code) return null;

  const list = await stripe.promotionCodes.list({
    code,
    active: true,
    limit: 1,
  });

  const pc = list.data?.[0];
  if (!pc) return null;
  return pc.id; // ID del promotion code da usare nella sessione
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
      return json(500, { error: "Stripe non configurato (STRIPE_SECRET_KEY mancante)" });
    }

    const body = JSON.parse(event.body || "{}");

    const sku = (body.sku || "SCUSA_BASE").toString();
    const context = (body.context || "").toString();
    const message = (body.message || "").toString();
    const details = (body.details || "").toString();
    const email = (body.email || "").toString().trim();
    const promo = (body.promo || "").toString().trim();

    if (!email || !email.includes("@")) {
      return json(400, { error: "Email non valida" });
    }

    const price = skuToPriceId(sku);
    const siteUrl = mustEnv("SITE_URL");

    // Applica promozione solo se inserita dall’utente e valida su Stripe
    let discounts;
    if (promo) {
      const promoId = await resolvePromotionCodeId(promo);
      if (!promoId) {
        // Codice inserito ma non valido: ritorna errore e non procede
        return json(400, { error: "Codice promo non valido o scaduto." });
      }
      discounts = [{ promotion_code: promoId }];
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [{ price, quantity: 1 }],
      discounts, // undefined se non c’è promo → nessuno sconto
      // NON permettere l’inserimento manuale di codici su Stripe:
      allow_promotion_codes: false,
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
    return json(500, { error: "Errore creazione checkout" });
  }
};
