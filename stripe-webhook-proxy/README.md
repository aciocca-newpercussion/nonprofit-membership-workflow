# Proxy webhook Stripe → Apps Script

Le Web App di Apps Script rispondono a ogni richiesta POST con un redirect
302 verso un URL temporaneo prima di restituire il contenuto vero. Stripe
non segue i redirect e segna la consegna come fallita ("302 ERR" nella
dashboard) — indipendentemente da come è configurato il deployment. Questo
Cloudflare Worker sta in mezzo: riceve il webhook da Stripe, lo inoltra ad
Apps Script seguendo lui il redirect, e restituisce a Stripe la risposta
finale (200/OK diretto).

## Deploy

Prima del deploy, in `wrangler.toml` sostituisci `{{DEPLOYMENT_ID}}` con
l'ID del tuo deployment Apps Script (l'URL `/exec`), poi registra il segreto
del webhook Stripe come secret del Worker (non va mai scritto nei file):

```bash
cd stripe-webhook-proxy
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler deploy
```

Al termine, Wrangler stampa l'URL pubblico del Worker, del tipo:
`https://stripe-webhook-proxy.<tuo-subdomain>.workers.dev`

## Configura Stripe

Developers → Webhooks → crea (o modifica) l'endpoint e usa come URL
quello del Worker appena ottenuto, non l'URL `/exec` di Apps Script.
Gli eventi da sottoscrivere sono elencati nel README principale.

## Test rapido

```bash
curl -i -X POST "https://stripe-webhook-proxy.<tuo-subdomain>.workers.dev" \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=1,v1=test" \
  -d '{"type":"test"}'
```

Risposta attesa: `200` con corpo `Unauthorized` (perché la firma qui è
finta — è il segnale che il Worker ha raggiunto correttamente `doPost` e
la verifica HMAC dentro Apps Script funziona).

Poi, dalla dashboard Stripe, usa "Invia di nuovo" sull'evento fallito
originale, oppure "Invia evento di prova", per verificare un giro completo
con firma reale.

## Se l'URL del deployment Apps Script cambia

Ogni volta che nel progetto Apps Script si crea un nuovo deployment (non
solo una nuova versione dello stesso deployment), l'URL `/exec` cambia.
In quel caso aggiorna `APPS_SCRIPT_URL` in `wrangler.toml` e rilancia:

```bash
wrangler deploy
```

Non serve toccare l'URL su Stripe: quello resta sempre l'URL del Worker,
stabile nel tempo.

## Perché la firma viaggia come query param e non come header

`doPost()` in `3_StripeAdmin.gs` legge la firma con
`e.parameter['Stripe-Signature']` — Apps Script non espone gli header HTTP
custom a `doGet`/`doPost` (stesso motivo per cui `18_PresidenzaAdminAPI.gs`
riceve l'id token come parametro e non come header). Il Worker legge
l'header `Stripe-Signature` che Stripe invia normalmente e lo riscrive come
parametro nell'URL di destinazione.

## Perché il corpo viaggia in Base64 URL-safe

Primo tentativo: Base64 standard — non bastava, l'HMAC continuava a non
corrispondere per `invoice.payment_succeeded` (mai per `checkout.session.completed`).
Il pattern (hash diverso ma lunghezza plausibile, nessun crash nella
decodifica) è tipico della classica normalizzazione "+ diventa spazio" che
molte infrastrutture web applicano ai corpi POST indipendentemente dal
Content-Type dichiarato (comportamento da parser form-encoded) — uno spazio
non è un carattere Base64 valido, quindi la stringa decodificata non
corrisponde più a quella firmata da Stripe nei punti dove c'era un `+`.

Il Base64 **URL-safe** (`+`→`-`, `/`→`_`) non contiene mai `+` o `/`, quindi
non può subire quella sostituzione. Il Worker lo produce con
`arrayBufferToBase64Url()`, e `doPost` lo decodifica con
`Utilities.base64DecodeWebSafe` prima di verificare la firma. Di conseguenza
questo endpoint ora si aspetta **solo** richieste passate dal Worker — una
chiamata diretta con corpo JSON grezzo non supererà più la verifica firma.

Se in futuro serve richiamare `doPost` per test manuali senza passare dal
Worker, ricorda di codificare il corpo in Base64 URL-safe prima di inviarlo.
