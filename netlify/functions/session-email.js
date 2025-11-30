// netlify/functions/session-email.js

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

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

// MODELLI base per SCUSA_BASE e contesti noti
const MODELLI = { 
  CENA: [
    'Ciao, grazie mille per l’invito: mi fa davvero piacere. Purtroppo quella sera ho già un impegno e non riesco a unirmi.',
    'Ciao, mi dispiace ma mi è capitato un imprevisto e stasera non riesco proprio a venire.',
    'Ciao, onestamente non me la sento di uscire: ho bisogno di una serata tranquilla a casa. Spero capirai.',
    'Ciao, ho già mangiato e sto seguendo la dieta: stasera passo, ma organizziamo presto.',
    'Ciao, non so se riesco a venere: ti aggiorno più tardi se ce la faccio.',
    'Ciao, spero vi divertiate un sacco! Organizziamoci presto per vederci.'
  ],
  APERITIVO: [
    'Ciao, mi spiace tantissimo ma non riesco a venire: ho un altro impegno inderogabile.',
    'Ciao, avevo piacere di esserci, ma è saltato fuori un imprevisto familiare e devo occuparmene.',
    'Ciao, è appena uscita un’urgenza al lavoro e non riesco a partecipare. Recuperiamo presto!'
  ],
  EVENTO: [
    'Ciao, grazie davvero per l’invito. Purtroppo per quella data ho già un impegno e non potrò esserci.',
    'Ciao, mi sarebbe piaciuto molto partecipare ma non riesco a essere presente. Spero in un’altra occasione!',
    'Ciao, non riesco a venire ma ti auguro un evento bellissimo e ti ringrazio per la comprensione.'
  ],
  LAVORO: [
    'Gentile, ti scrivo per scusarmi dell’inconveniente: mi assumo la responsabilità e ho già messo in atto le correzioni. Ti tengo aggiornato con orari aggiornati.',
    'Oggetto: Assenza per indisposizione — ti avviso che oggi non riesco a presentarmi per un malessere improvviso. Mi scuso per il disagio e invierò certificazione appena possibile.'
  ],
  CALCETTO: [
    'Ciao, questa volta passo: ho già un altro impegno fissato.',
    'Ciao, mi sono svegliato con un bel mal di testa: meglio riposare oggi.',
    'Ciao, ho avuto un imprevisto al lavoro/studio e non riesco a liberarmi.',
    'Ciao, sono parecchio stanco e non renderei: meglio non venire oggi.',
    'Ciao, ho un piccolo infortunio e preferisco non rischiare.'
  ],
  FAMIGLIA: [
    'Ciao, mi dispiace ma devo disdire: è subentrato un imprevisto familiare urgente.',
    'Ciao, ho un impegno in famiglia che non posso rimandare e non potrò esserci. Divertitevi!',
    'Ciao, mi scuso per il breve preavviso: devo accompagnare un familiare a una visita. Recuperiamo presto.'
  ],
  SALUTE: [
    'Ciao, mi sono svegliato con febbre e mal di gola: meglio non rischiare di contagiare nessuno.',
    'Ciao, ho un attacco d’allergia forte e oggi devo fermarmi. Appena sto meglio recupero.',
    'Ciao, hanno anticipato una visita medica e devo andarci oggi pomeriggio.'
  ],
  APPUNTAMENTO: [
    'Ciao, mi dispiace ma devo annullare l’appuntamento di [data/ora] per un imprevisto. Possiamo riprogrammare?',
    'C’è stata una sovrapposizione di impegni e non riesco a rispettare l’orario: ti va di fissare un’alternativa?',
    'Purtroppo è subentrata una situazione urgente: posso proporre un’altra data che vada bene a entrambi?'
  ],
  ESAME: [
    'Ciao, mi dispiace per il ritardo: sono rimasto bloccato nel traffico per un incidente e non sono riuscito ad arrivare prima.',
    'Ciao, mi dispiace per il ritardo: sono rimasta bloccata nel traffico per un incidente e non sono riuscita ad arrivare prima.'
  ],
  TRAFFICO: [
    'Sono in ritardo per un blocco di traffico imprevisto. Mi prendo la responsabilità: arrivo e recupero il tempo, oppure riprogrammiamo oggi stesso in un orario utile per te.'
  ],
  RIUNIONE: [
    'La riunione precedente è sforata e ha impattato il nostro appuntamento. Errore mio di pianificazione: propongo nuovo slot oggi con agenda compressa e materiali in anticipo.'
  ],
  CONNESSIONE: [
    'Problemi di connessione hanno interrotto l’appuntamento. Ho già predisposto un backup per non perdere nulla del lavoro. Propongo una nuova sessione oggi con recap. Ti aggiorno sull\'orario.'
  ]
};

// MODELLI per SCUSA_DIVERTENTE – generazione post pagamento
const FUNNY_MODELLI = {
  CENA: [
    'Raga, oggi il mio frigo mi ha guardato male: devo restare a casa a chiarire con lui. Salto la cena ma vi mando un brindisi vocale.',
    'Non posso venire: il divano ha aperto un ticket di assistenza perché lo sto trascurando. Devo occuparmene stasera.'
  ],
  CALCETTO: [
    'Salto il calcetto: il mio talento vuole prendersi una pausa per non umiliarvi troppo tutte le settimane.',
    'Oggi niente calcetto: ho ricevuto una chiamata dalla Serie A ma era uno scherzo, quindi ora sono in lutto sportivo.'
  ],
  RIUNIONE: [
    'Se sparisco dalla riunione è perché la connessione sta scegliendo chi licenziare tra di noi. Nel dubbio, riaggancio io.',
    'Rimando la riunione: il mio cervello ha richiesto un aggiornamento di sistema e sta ancora riavviando.'
  ],
  TRAFFICO: [
    'Sono bloccato nel traffico: pare che abbiano messo un rallentatore proprio sulla mia motivazione ad arrivare in orario.',
    'Ritardo per colpa del traffico: Google Maps ha deciso di farmi fare il tour turistico della città prima.'
  ],
  APPUNTAMENTO: [
    'Devo spostare l’appuntamento: il mio lato responsabile è in ritardo, quello irresponsabile è in ferie.',
    'Annulliamo per oggi: ho appena litigato con l’orologio e sta vincendo lui.'
  ],
  FAMIGLIA: [
    'Non riesco a venire: sono stato requisita dalla famiglia per una riunione straordinaria su “chi cucina cosa”.',
    'Oggi turno di famiglia: sto partecipando a un reality non ufficiale che si chiama “Con chi litighiamo a pranzo?”.'
  ]
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function validateStripeConfig() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Configurazione Stripe mancante: STRIPE_SECRET_KEY non impostata');
  }
}

function validateSmtpConfig() {
  const missing = [];
  if (!process.env.SMTP_HOST) missing.push('SMTP_HOST');
  if (!process.env.SMTP_PORT) missing.push('SMTP_PORT');
  if (!process.env.SMTP_USER) missing.push('SMTP_USER');
  if (!process.env.SMTP_PASS) missing.push('SMTP_PASS');
  if (!process.env.FROM_EMAIL) missing.push('FROM_EMAIL');

  if (missing.length) {
    throw new Error(
      'Configurazione SMTP incompleta. Mancano: ' + missing.join(', ')
    );
  }
}

function createTransport() {
  validateSmtpConfig();
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function buildFunnyExcuse(contextCode, details) {
  // context arriva come "DIVERTENTE_CENA", "DIVERTENTE_TRAFFICO", ecc.
  const key = (contextCode || '').replace(/^DIVERTENTE_/, '');
  const templates = FUNNY_MODELLI[key] || [
    'Oggi salto: ho appena scoperto che sono allergico agli impegni.'
  ];
  let base = pickRandom(templates);
  if (details) {
    base += '\n\nDettagli da tenere in conto:\n' + details;
  }
  return base;
}

function buildExcuseFromMetadata(metadata) {
  const sku = metadata.sku || 'SCUSA_BASE';
  const context = metadata.context || '';
  const details = metadata.details || '';

  // SCUSA DIVERTENTE: generata qui, dopo il pagamento
  if (sku === 'SCUSA_DIVERTENTE') {
    const text = buildFunnyExcuse(context, details);
    return {
      subject: 'La tua scusa divertente – COLPA MIA',
      text,
    };
  }

  // SCUSA BASE con contesti noti
  if (sku === 'SCUSA_BASE' && MODELLI[context]) {
    let base = pickRandom(MODELLI[context]);
    if (details) {
      base += '\n\nDettagli aggiuntivi:\n' + details;
    }
    return {
      subject: 'La tua scusa – COLPA MIA',
      text: base,
    };
  }

  // SCUSA PREMIUM
  if (sku === 'SCUSA_PREMIUM') {
    const base =
      'Ti invio di seguito una bozza di scusa strutturata, calibrata sul contesto indicato.\n\n' +
      (context ? `Contesto: ${context}\n` : '') +
      (details ? `Dettagli: ${details}\n\n` : '\n') +
      'Mi scuso sinceramente per l’inconveniente e mi rendo disponibile a recuperare nel modo più utile per te.';
    return {
      subject: 'La tua scusa premium – COLPA MIA',
      text: base,
    };
  }

  // SCUSA BUSINESS
  if (sku === 'SCUSA_BUSINESS') {
    const base =
      'Gentile destinatario,\n\n' +
      'desidero innanzitutto scusarmi per il disservizio. ' +
      'Prendo piena responsabilità dell’accaduto e sto già intervenendo per evitare che si ripeta.\n\n' +
      (context ? `Contesto: ${context}\n` : '') +
      (details ? `Dettagli operativi: ${details}\n\n` : '\n') +
      'Resto a disposizione per qualsiasi chiarimento e per concordare la soluzione più adatta alle tue esigenze.\n\n' +
      'Cordiali saluti.';
    return {
      subject: 'Comunicazione formale – COLPA MIA',
      text: base,
    };
  }

  // Fallback generico
  const fallback =
    'Ciao, ti scrivo per scusarmi per l’imprevisto.\n\n' +
    (context ? `Contesto: ${context}\n` : '') +
    (details ? `Dettagli: ${details}\n\n` : '\n') +
    'Spero che potremo recuperare al più presto in un modo che vada bene a entrambi.';
  return {
    subject: 'La tua scusa – COLPA MIA',
    text: fallback,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Metodo non consentito' });
  }

  try {
    validateStripeConfig();
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Body JSON non valido' });
  }

  const sessionId = data.sessionId;
  if (!sessionId) {
    return json(400, { error: 'sessionId mancante' });
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error('Errore nel recupero sessione Stripe:', err);
    return json(500, { error: 'Impossibile recuperare la sessione di pagamento da Stripe.' });
  }

  const metadata = session.metadata || {};
  const customerDetails = session.customer_details || {};
  const email = metadata.email || customerDetails.email;

  if (!email) {
    return json(400, { error: 'Email non presente nei metadata/sessione. Contattaci e indica il tuo ordine.' });
  }

  const { subject, text } = buildExcuseFromMetadata(metadata);

  let transporter;
  try {
    transporter = createTransport();
  } catch (e) {
    console.error('Errore configurazione SMTP:', e);
    return json(500, { error: e.message });
  }

  const mailOptions = {
    from: process.env.FROM_EMAIL || 'no-reply@colpamia.com',
    to: email,
    subject,
    text,
    html: `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111827;">
        <p>Ciao,</p>
        <p>ecco la tua scusa pronta da copiare e incollare:</p>
        <blockquote style="border-left:4px solid #7c6dff;padding-left:12px;margin:12px 0;font-style:italic;white-space:pre-wrap;">
          ${text.replace(/</g,'&lt;')}
        </blockquote>
        <p>Grazie per aver scelto <strong>COLPA MIA</strong>.</p>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    return json(200, { ok: true });
  } catch (err) {
    console.error('Errore invio email:', err);
    return json(500, { error: 'Errore durante l\'invio della mail: ' + (err.message || 'errore sconosciuto') });
  }
};
