// netlify/functions/stripe-webhook.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

function parseEnvJSON(name) {
  try { return JSON.parse(process.env[name] || '{}'); }
  catch { return {}; }
}
const PRICE_RULES = parseEnvJSON('PRICE_RULES_JSON');

exports.handler = async (event) => {
  const sig = event.headers['stripe-signature'];
  if (!sig) return { statusCode: 400, body: 'missing signature' };
  let evt;
  try {
    evt = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (evt.type === 'checkout.session.completed') {
    const session = evt.data.object;
    const email = session.customer_details?.email || session.customer_email;
    const sku = session.metadata?.sku;
    const minutes = Number(session.metadata?.minutes || (PRICE_RULES[sku]?.minutes || 0));

    if (email && minutes > 0) {
      // cerca customer
      const cust = session.customer
        ? await stripe.customers.retrieve(session.customer)
        : (await stripe.customers.search({ query: `email:"${email}"`, limit: 1 })).data[0];

      if (cust) {
        const current = Number(cust.metadata?.wallet_minutes || 0);
        await stripe.customers.update(cust.id, {
          metadata: {
            wallet_minutes: String(current + minutes)
          }
        });
      }
    }
  }

  return { statusCode: 200, body: 'ok' };
};
