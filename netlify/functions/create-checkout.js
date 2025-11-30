// netlify/functions/create-checkout.js
// oppure: create-checkout-session.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

function parsePriceMap() {
  try {
    return JSON.parse(process.env.PRICE_BY_SKU_JSON || '{}');
  } catch (e) {
    console.error('Errore nel parsing di PRICE_BY_SKU_JSON:', e);
    return {};
  }
}

exports.handler = async (event) => {
  // Preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Metodo non consentito' });
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    console.error('Body non valido:', e);
    return json(400, { error: 'Body JSON non valido' });
  }

  const {
    sku,          // es. "SCUSA_BASE"
    email,        // email per inviare la scusa
    context,      // contesto (cena, lavoro, ecc.)
    details,      // dettagli da includere
    promoCode,    // opzionale, es. "COLPAMIA10"
  } = data;

  if (!sku) {
    return json(400, { error: 'SKU mancante' });
  }

  // URL di origine per success/cancel
  const origin =
    event.headers.origin ||
    process.env.CLIENT_URL ||
    'https://colpamia.com';

  const successUrl =
    process.env.STRIPE_SUCCESS_URL ||
    `${origin}/success?session_id={CHECKOUT_SESSION_ID}`;

  const cancelUrl =
    process.env.STRIPE_CANCEL_URL ||
    `${origin}/checkout-canceled`;

  const priceMap = parsePriceMap();
  const priceId = priceMap[sku];

  // Fallback robusto: se non c’è un priceId, usa price_data
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
            currency: 'eur',
            product_data: {
              name: sku || 'SCUSA',
              description: 'Scusa personalizzata COLPA MIA',
            },
            // Fallback: 1€ (100 centesimi). Puoi cambiarlo.
            unit_amount: 100,
          },
          quantity: 1,
        },
      ];

  // Metadata per il post-checkout (es. session-email)
  const metadata = {
    sku: sku || '',
    email: email || '',
    context: context || '',
    details: details || '',
  };

  try {
    let discounts = [];

    // Promo code opzionale (es. "COLPAMIA10")
    if (promoCode && typeof promoCode === 'string' && promoCode.trim()) {
      const code = promoCode.trim();

      const promoList = await stripe.promotionCodes.list({
        code,
        active: true,
        limit: 1,
      });

      if (promoList.data && promoList.data.length > 0) {
        discounts = [{ promotion_code: promoList.data[0].id }];
      } else {
        console.warn('Codice promo non trovato o non attivo:', code);
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: email || undefined,
      metadata,
      discounts: discounts.length ? discounts : undefined,
    });

    // Il frontend può fare window.location = data.url
    return json(200, {
      id: session.id,
      url: session.url,
    });
  } catch (err) {
    console.error('Errore Stripe checkout:', err);
    return json(500, {
      error: 'Errore nella creazione della sessione di pagamento',
      details:
        process.env.NODE_ENV === 'development'
          ? String(err.message || err)
          : undefined,
    });
  }
};
