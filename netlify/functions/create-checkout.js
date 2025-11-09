// netlify/functions/create-checkout.js
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};
const json = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json', ...CORS }, body: JSON.stringify(b) });

function parseEnvJSON(name) {
  try { return JSON.parse(process.env[name] || '{}'); }
  catch { return {}; }
}

const PRICE_BY_SKU = parseEnvJSON('PRICE_BY_SKU_JSON');
const PRICE_RULES = parseEnvJSON('PRICE_RULES_JSON');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
  if (!process.env.STRIPE_SECRET_KEY) return json(500, { error: 'missing STRIPE_SECRET_KEY' });

  try {
    const { sku, email, context, message, promo } = JSON.parse(event.body || '{}');
    if (!sku || !email) return json(400, { error: 'sku and email required' });

    const realSku = PRICE_BY_SKU[sku] ? sku : sku; // se lo trovi, usalo
    const priceId = PRICE_BY_SKU[realSku];
    if (!priceId) return json(400, { error: 'SKU not mapped: '+sku });

    const origin = event.headers.origin || process.env.SITE_URL || 'https://'+event.headers.host;

    const form = new URLSearchParams();
    form.append('mode', 'payment');
    form.append('success_url', `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`);
    form.append('cancel_url', `${origin}/index.html`);
    form.append('customer_email', email);
    form.append('line_items[0][price]', priceId);
    form.append('line_items[0][quantity]', '1');
    form.append('allow_promotion_codes', 'true');

    // metadata che poi il webhook e la mail useranno
    form.append('metadata[sku]', realSku);
    if (context) form.append('metadata[context]', context);
    if (message) form.append('metadata[message]', message);
    if (PRICE_RULES[realSku]?.minutes) form.append('metadata[minutes]', String(PRICE_RULES[realSku].minutes));

    // promo testuale -> lo lasciamo a Stripe nel checkout
    if (promo) {
      // niente, lo scriviamo solo come metadata
      form.append('metadata[promo]', promo);
    }

    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: form.toString()
    });
    const data = await resp.json();
    if (!resp.ok) return json(resp.status, { error: data.error?.message || 'stripe_error' });
    return json(200, { url: data.url });
  } catch (err) {
    return json(500, { error: err.message || String(err) });
  }
};
