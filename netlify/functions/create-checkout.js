// netlify/functions/create-checkout.js

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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

function parsePriceMap() {
  try {
    return JSON.parse(process.env.PRICE_BY_SKU_JSON || "{}");
  } catch (e) {
    console.error("Errore nel parsing di PRICE_BY_SKU_JSON:", e);
    return {};
  }
}

// NOTE:
// - Prima avevi un codice promo "nascosto" sempre attivo (COLPAMIA10).
// - Ora lo applichiamo SOLO se l’utente inserisce un promo code non vuoto.
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Metodo non consentito" });
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch (e) {
    console.error("Body non valido:", e);
    return json(400, { error: "Body JSON non valido" });
  }

  const { sku, email, context, details, promo } = data;

  if (!sku) {
    return json(400, { error: "SKU mancante" });
  }

  const origin = event.headers.origin || process.env.CLIENT_URL || "https://colpamia.com";

  const successUrl =
    process.env.STRIPE_SUCCESS_URL || `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`;

  const cancelUrl =
    process.env.STRIPE_CANCEL_URL || `${origin}/checkout-canceled.html`;

  const priceMap = parsePriceMap();
  const priceId = priceMap[sku];

  const lineItems = priceId
    ? [
        {
          price: priceId,
          quantity: 1,
        },
      ]
    : [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: sku,
              description: "Scusa automatizzata COLPA MIA",
            },
            unit_amount: 100, // 1 € fallback
          },
          quantity: 1,
        },
      ];

  const metadata = {
    sku: sku || "",
    email: email || "",
    context: context || "",
    details: details || "",
    promo: promo ? String(promo).trim() : "",
  };

  // ✅ FIX: promo facoltativo, nessuno sconto se campo vuoto
  let discounts = [];
  const promoInput = promo ? String(promo).trim() : "";

  // Se il frontend per sbaglio manda "PROMO" (placeholder), ignoralo
  const usablePromo = promoInput && promoInput.toUpperCase() !== "PROMO";

  if (usablePromo) {
    try {
      const promoList = await stripe.promotionCodes.list({
        code: promoInput,
        active: true,
        limit: 1,
      });

      if (promoList.data && promoList.data.length > 0) {
        discounts = [{ promotion_code: promoList.data[0].id }];
      } else {
        console.warn(`Promo "${promoInput}" non trovata o non attiva (ignoro sconto)`);
      }
    } catch (err) {
      console.warn(`Errore nel recupero promo "${promoInput}" (ignoro sconto):`, err);
    }
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: email || undefined,
      metadata,
      discounts: discounts.length ? discounts : undefined,
    });

    return json(200, {
      id: session.id,
      url: session.url,
    });
  } catch (err) {
    console.error("Errore Stripe checkout:", err);
    return json(500, {
      error: "Errore nella creazione della sessione di pagamento",
    });
  }
};
