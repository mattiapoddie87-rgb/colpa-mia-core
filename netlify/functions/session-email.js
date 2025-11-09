// netlify/functions/session-email.js
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion:'2024-06-20' });

const CORS = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type'
};
const json=(s,b)=>({statusCode:s,headers:{'Content-Type':'application/json',...CORS},body:JSON.stringify(b)});

exports.handler = async (event)=>{
  if (event.httpMethod === 'OPTIONS') return json(204,{});
  if (event.httpMethod !== 'POST') return json(405,{error:'method_not_allowed'});
  const { session_id } = JSON.parse(event.body || '{}');
  if (!session_id) return json(400,{error:'missing session_id'});

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['customer'] });
    const email = session.customer_details?.email || session.customer?.email;
    if (!email) return json(400,{error:'email_not_found_on_session'});

    const sku = session.metadata?.sku || 'SCUSA_BASE';
    const context = session.metadata?.context || 'situazione generica';
    const details = session.metadata?.message || '';

    // testo scusa basico
    const excuse = `Ciao, ti scrivo per chiarire ${context}. Si è verificato un imprevisto indipendente dalla mia volontà e non ho potuto rispettare quanto concordato. Mi assumo pienamente la responsabilità e mi impegno a recuperare al più presto. ${details ? 'Dettagli aggiuntivi: '+details : ''}`;

    // QUI mandi davvero la mail con nodemailer se vuoi
    // per ora rispondiamo ok
    return json(200,{ sent:true, to:email, excuse });
  } catch (err) {
    return json(500,{ error:err.message || String(err) });
  }
};
