const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    ...CORS,
  },
  body: JSON.stringify(body),
});

function parseEnvJSON(name, fallback = '{}') {
  try {
    return JSON.parse(process.env[name] || fallback);
  } catch {
    return JSON.parse(fallback);
  }
}

const PRICE_BY_SKU = parseEnvJSON('PRICE_BY_SKU');
const PRICE_RULES = parseEnvJSON('PRICE_RULES');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }
  let sku, email, context, message, promo;
  try {
    ({ sku, email, context, message, promo } = JSON.parse(event.body || '{}'));
  } catch {
    return json(400, { error: 'malformed_json' });
  }
  if (!sku || !email) {
    return json(400, { error: 'sku_and_email_required' });
  }
  const realSku = PRICE_BY_SKU[sku] ? sku : sku;
  const priceId = PRICE_BY_SKU[realSku];
    const lineItems = priceId ? [{ price: priceId, quantity: 1 }] : [{
    price_data: {
      currency: 'eur',
            product_data: { name: realSku },
 (!priceId) {
 /   return json(400, { error: `SKU not mapped: ${sku}` });
//
  const origin = event.headers.origin || process.env.SITE_URL || `https://${event.headers.host}`;
  const metadata = { sku: realSku };
  if (context) metadata.context = context;
  if (message) metadata.message = message;
  if (PRICE_RULES[realSku]?.minutes) metadata.minutes = String(PRICE_RULES[realSku].minutes);
  if (promo) metadata.promo = promo;
  const sessionParams = {
    mode: 'payment',
    line_items: lineItems,
    allow_promotion_codes: true,
    customer_email: email,
    success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/index.html`,
    metadata
  };
  try {
    const session = await stripe.checkout.sessions.create(sessionParams);
    return json(200, { url: session.url });
  } catch (err) {
    return json(500, { error: err.message || String(err) });
  }
};
