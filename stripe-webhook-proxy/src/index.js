/**
 * Proxy Stripe → Apps Script /exec
 * ══════════════════════════════════════════════════════════════════════
 * Perché serve: le Web App di Apps Script rispondono a ogni POST con un
 * redirect 302 verso un URL temporaneo (script.googleusercontent.com/macros/echo)
 * prima di restituire il contenuto vero. Stripe (come la maggior parte dei
 * sistemi di webhook) non segue i redirect e considera il 302 una consegna
 * fallita. Questo Worker sta in mezzo: riceve la richiesta da Stripe, la
 * inoltra ad Apps Script seguendo lui il redirect, e restituisce a Stripe
 * la risposta finale con uno status 2xx diretto.
 *
 * VERIFICA FIRMA STRIPE — fatta QUI, non in Apps Script.
 * Due tentativi di calcolare l'HMAC-SHA256 su byte[] dentro Apps Script
 * (per evitare il giro byte→stringa→ri-encode UTF-8) hanno prodotto lo
 * stesso errore di tipo del bridge V8/Java di GAS: "The parameters
 * (number[],String) don't match the method signature for
 * Utilities.computeHmacSha256Signature". È un limite della piattaforma
 * (un Byte[] "vero" per quel bridge deve arrivare intonso da una chiamata
 * nativa come Blob.getBytes(), e perde quel tag non appena lo si tocca con
 * .concat()/.slice() di JS), non risolvibile costruendo l'array in modo
 * diverso — vedi HANDOFF_STRIPE_WEBHOOK.md per la cronologia completa.
 *
 * Qui invece si usa la Web Crypto API standard (crypto.subtle), disponibile
 * nei Cloudflare Workers, sui byte grezzi esatti così come arrivano da
 * Stripe — prima di qualunque base64 o passaggio per Apps Script. Se la
 * firma non è valida, il Worker rifiuta con 400 e NON inoltra nulla a GAS.
 *
 * Autenticazione verso GAS: dato che GAS non riverifica più la firma Stripe
 * (l'ha già fatta il Worker), /exec deve comunque sapere che la richiesta
 * viene davvero da questo Worker e non da chiunque scopra l'URL pubblico
 * (il deployment è "Chiunque può accedere"). Si passa quindi un secondo
 * parametro, `internal_key`, con lo stesso valore di STRIPE_WEBHOOK_SECRET:
 * un confronto di stringhe banale lato GAS (nessun byte[] coinvolto, quindi
 * nessuno dei problemi sopra). Non è usato per verificare la firma di
 * Stripe — quella verifica è già completa a questo punto — serve solo come
 * segreto condiviso Worker↔GAS. Riusa lo stesso valore per comodità (è già
 * un segreto disponibile a entrambe le parti); volendo si può sostituire con
 * un token dedicato impostando un secret Worker diverso.
 */

function arrayBufferToBase64Url(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
}

function parseStripeSignatureHeader(header) {
  const parts = {};
  String(header || '').split(',').forEach((seg) => {
    const eq = seg.indexOf('=');
    if (eq > 0) parts[seg.slice(0, eq).trim()] = seg.slice(eq + 1).trim();
  });
  return parts;
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verificaFirmaStripe(rawBody, sigHeader, secret) {
  const { t, v1 } = parseStripeSignatureHeader(sigHeader);
  if (!t || !v1) return { ok: false, motivo: 'Header Stripe-Signature malformato o assente.' };

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parseInt(t, 10)) > 300) {
    return { ok: false, motivo: 'Timestamp scaduto (possibile replay attack).' };
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const prefixBytes = encoder.encode(t + '.');
  const combined = new Uint8Array(prefixBytes.length + rawBody.byteLength);
  combined.set(prefixBytes, 0);
  combined.set(new Uint8Array(rawBody), prefixBytes.length);

  const sigBuffer = await crypto.subtle.sign('HMAC', key, combined);
  const expected = toHex(sigBuffer);

  if (expected !== v1) {
    return { ok: false, motivo: `HMAC non corrispondente (atteso ${expected}, ricevuto ${v1}).` };
  }
  return { ok: true };
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed — questo endpoint accetta solo POST (webhook Stripe).', { status: 405 });
    }

    const appsScriptUrl = env.APPS_SCRIPT_URL;
    if (!appsScriptUrl) {
      return new Response('Configurazione mancante: APPS_SCRIPT_URL non impostata.', { status: 500 });
    }
    if (!env.STRIPE_WEBHOOK_SECRET) {
      return new Response('Configurazione mancante: STRIPE_WEBHOOK_SECRET non impostata.', { status: 500 });
    }

    const signature = request.headers.get('Stripe-Signature') || '';
    const rawBody = await request.arrayBuffer();

    const verifica = await verificaFirmaStripe(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    if (!verifica.ok) {
      return new Response('Firma Stripe non valida: ' + verifica.motivo, { status: 400 });
    }

    const base64Body = arrayBufferToBase64Url(rawBody);

    const target = new URL(appsScriptUrl);
    if (signature) target.searchParams.set('Stripe-Signature', signature);
    target.searchParams.set('internal_key', env.STRIPE_WEBHOOK_SECRET);

    // Content-Type volutamente NON application/json: il corpo è Base64 puro,
    // così nessun livello intermedio ha motivo di "interpretarlo" come JSON.
    // fetch() segue i redirect di default (redirect: 'follow'), incluso il
    // passaggio POST → GET sul 302 di Apps Script, esattamente come serve
    // per raggiungere l'URL "echo" con il contenuto vero.
    const upstream = await fetch(target.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: base64Body,
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
};
