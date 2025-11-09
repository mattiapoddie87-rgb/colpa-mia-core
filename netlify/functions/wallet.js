// netlify/functions/wallet.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion:'2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const json = (s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

exports.handler = async (event)=>{
  if (event.httpMethod === 'OPTIONS') return json(204,{});
  const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
  if (!email) return json(400,{error:'missing_email'});

  try {
    const res = await stripe.customers.search({ query:`email:"${email}"`, limit:1 });
    const customer = res.data[0];
    if (!customer) return json(200,{ minutes:0, orders:0, level:'Base', sessions:[] });

    const minutes = Number(customer.metadata?.wallet_minutes || 0);

    // per info allo storico
    const sessions = [];
    const sessList = await stripe.checkout.sessions.list({ customer: customer.id, limit: 20 });
    for (const s of sessList.data) {
      if (s.status === 'complete') {
        sessions.push({ id:s.id, minutes: 0 });
      }
    }

    const level = minutes >= 180 ? 'Gold' : minutes >= 60 ? 'Silver' : 'Base';

    return json(200,{ minutes, orders:sessions.length, level, sessions });
  } catch (err) {
    return json(500,{ error:err.message || String(err) });
  }
};
