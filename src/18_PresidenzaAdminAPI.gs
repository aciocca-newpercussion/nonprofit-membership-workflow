/**
 * MODULO: 18_PresidenzaAdminAPI.gs
 * ══════════════════════════════════════════════════════════════════════
 * Espone la dashboard e le azioni di `17_PresidenzaAdmin.gs` come **JSON su
 * HTTP puro**, per l'app mobile dell'ente — la stessa identica logica del pannello web,
 * non una seconda copia. Comprese le due fasi dell'espulsione: anche da qui la
 * Presidenza può solo proporre, l'esecuzione pretende gli estremi della
 * delibera dell'Assemblea (Art. 9.3 Statuto).
 *
 * PERCHÉ SERVE UN FILE A PARTE, E PERCHÉ SOLO `doGet`:
 * Il pannello web (`doGetPresidenzaAdmin`, 17_PresidenzaAdmin.gs) si affida a
 * `Session.getActiveUser().getEmail()`, che funziona solo perché il browser
 * arriva con un vero cookie di sessione Google. L'app iOS chiama questo
 * stesso URL via `URLSession` puro: nessun cookie, quindi nessuna sessione.
 * Serve un modo di autenticare la chiamata che non dipenda dal browser — qui
 * sotto, verificando l'id token Google che l'app ottiene già al login (lo
 * stesso già verificato server-side da tutte le Edge Function Supabase del
 * progetto, `supabase/functions/_shared/googleAuth.ts`).
 *
 * Un progetto Apps Script ha **un solo `doPost`**, ed è già occupato dal
 * webhook Stripe in `3_StripeAdmin.gs` — non va toccato, è un percorso di
 * pagamento in produzione. Per questo tutte le azioni (comprese quelle che
 * scrivono) passano da `doGet` con i parametri nella query string: non è lo
 * stile REST più pulito, ma evita ogni rischio sul webhook e resta comunque
 * protetto — senza un idToken valido di un membro della Presidenza, nessuna
 * azione esegue nulla (vedi `_presidenzaRichiedeAutorizzazione_` in
 * 17_PresidenzaAdmin.gs).
 *
 * Route (via il router unico `doGet` in 15_ModuloIscrizioneWebApp.gs):
 *   ?pagina=presidenza&formato=json&action=list&idToken=...
 *   ?pagina=presidenza&formato=json&action=ammetti&idToken=...&idPratica=...&gruppo=...&ruolo=...
 *   ?pagina=presidenza&formato=json&action=rifiuta&idToken=...&idPratica=...&motivo=...
 *   ?pagina=presidenza&formato=json&action=proponi_espulsione&idToken=...&idPratica=...&motivo=...[&senzaAvviso=SI]
 *   ?pagina=presidenza&formato=json&action=espelli&idToken=...&idPratica=...&motivo=...&delibera=...
 *     (`delibera` = estremi del verbale dell'Assemblea, obbligatoria)
 *   ?pagina=presidenza&formato=json&action=annulla_proposta_espulsione&idToken=...&idPratica=...&esito=...
 *   ?pagina=presidenza&formato=json&action=registra_cessazione&idToken=...&idPratica=...&causa=Recesso&data=2026-10-03&dettaglio=...
 *     (`causa`: Decadenza | Recesso | Incapacita | Decesso — l'accento è opzionale)
 *   ?pagina=presidenza&formato=json&action=registra_ratifica&idToken=...&idPratica=...&riferimento=...
 *   ?pagina=presidenza&formato=json&action=aggiorna_anagrafica&idToken=...&idPratica=...&nome=...&cognome=...&cf=...&dataNascita=...&sesso=...&email=...&telefono=...
 *     (solo i parametri presenti vengono scritti — vedi il dispatcher sotto)
 *   ?pagina=presidenza&formato=json&action=aggiorna_liberatoria&idToken=...&idPratica=...&sito=SI&social=NO
 *   ?pagina=presidenza&formato=json&action=salva_nota&idToken=...&idPratica=...&nota=...
 *     (`nota` vuota o assente elimina la nota esistente)
 *   ?pagina=presidenza&formato=json&action=cronologia&idToken=...&idPratica=...
 *
 * Risposta sempre 200 (Apps Script non permette di impostare lo status code
 * di un web app) con corpo `{"ok":true,"data":...}` o `{"ok":false,"error":"..."}`
 * — il client iOS decide l'esito guardando `ok`, mai lo status HTTP.
 */

// ─────────────────────────────────────────────────────────────────────────────
// VERIFICA ID TOKEN GOOGLE (sostituisce Session.getActiveUser() per le
// chiamate senza sessione browser)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * L'OAuth Client ID pubblico usato dall'app mobile dell'ente per il login Google
 * (Google Sign-In). **Non è un segreto** — è già dentro il binario
 * dell'app, chiunque lo estrae — quindi vive qui e non in `0_Secrets.gs`.
 * Deve restare identico a `AppConfig.googleClientID` in
 * `<app mobile>/AppConfig` e a `GOOGLE_CLIENT_ID` nei
 * secret Supabase: se uno dei tre cambia, aggiornare gli altri due.
 */
const PRESIDENZA_API_IOS_CLIENT_ID = '{{OAUTH_CLIENT_ID}}';

/**
 * Verifica un id token Google via l'endpoint pubblico `tokeninfo` (nessuna
 * chiave né libreria di verifica JWT necessaria: Google valida firma e
 * scadenza lato suo e risponde con le claim in chiaro, o un errore 4xx se il
 * token non è valido). Stesso principio di verifica già in uso lato Supabase
 * per lo stesso identico id token — qui replicato in Apps Script perché
 * questo progetto non condivide codice con quello.
 *
 * @returns {string} l'email verificata.
 * @throws se il token è assente, scaduto, non firmato per questo client, o
 *   l'email non è del dominio.
 */
function _presidenzaVerificaIdToken_(idToken) {
  if (!idToken) throw new Error('idToken mancante.');

  const resp = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  const code = resp.getResponseCode();
  let body;
  try {
    body = JSON.parse(resp.getContentText() || '{}');
  } catch (e) {
    throw new Error('Risposta di verifica token non valida.');
  }
  if (code !== 200) {
    throw new Error('Token Google non valido o scaduto: ' + (body.error_description || body.error || code));
  }
  if (body.aud !== PRESIDENZA_API_IOS_CLIENT_ID) {
    throw new Error('Token non emesso per l\'app {{NOME_GRUPPO}}.');
  }
  if (body.email_verified !== 'true' && body.email_verified !== true) {
    throw new Error('Email non verificata da Google.');
  }
  const email = String(body.email || '').toLowerCase().trim();
  if (!email || email.indexOf('@' + CONFIG.DOMINIO) === -1) {
    throw new Error('Dominio non ammesso.');
  }
  return email;
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPATCHER JSON
// ─────────────────────────────────────────────────────────────────────────────

function _presidenzaJson_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Richiamata da `doGet(e)` in 15_ModuloIscrizioneWebApp.gs. */
function doGetPresidenzaApi_(e) {
  const p = (e && e.parameter) || {};
  const idToken = p.idToken || '';

  try {
    let data;
    switch (p.action) {
      case 'list':
        data = presidenzaListaRichieste(idToken);
        break;
      case 'ammetti':
        data = presidenzaAmmetti(p.idPratica, p.gruppo, p.ruolo || '', idToken);
        break;
      case 'rifiuta':
        data = presidenzaRifiuta(p.idPratica, p.motivo, idToken);
        break;
      // Espulsione in due tempi, come vuole l'Art. 9.3 dello Statuto: la
      // Presidenza propone e apre il contraddittorio, l'Assemblea delibera.
      // `espelli` senza `delibera` viene rifiutato dal lato server: è voluto,
      // il client non deve poter saltare il passaggio.
      case 'proponi_espulsione':
        data = presidenzaProponiEspulsione(
          p.idPratica, p.motivo,
          ['SI', 'SÌ', 'TRUE', '1', 'ON', 'YES'].indexOf(String(p.senzaAvviso || '').trim().toUpperCase()) !== -1,
          idToken);
        break;
      case 'annulla_proposta_espulsione':
        data = presidenzaAnnullaPropostaEspulsione(p.idPratica, p.esito || '', idToken);
        break;
      case 'espelli':
        data = presidenzaEspelli(p.idPratica, p.motivo, p.delibera || '', idToken);
        break;
      // Le altre quattro cause dell'Art. 9.1. `causa` accetta anche la forma
      // senza accento ('Incapacita'), perché passa da una query string.
      case 'registra_cessazione':
        data = presidenzaRegistraCessazione(p.idPratica, p.causa, p.dettaglio || '', p.data || '', idToken);
        break;
      case 'registra_ratifica':
        data = presidenzaRegistraRatifica(p.idPratica, p.riferimento || '', idToken);
        break;
      case 'aggiorna_anagrafica':
        // Il client manda solo i campi che l'utente ha davvero cambiato:
        // un parametro di query assente in `e.parameter` non finisce nella
        // mappa `campi`, quindi `presidenzaAggiornaAnagrafica` lo salta
        // (vedi `if (!(campo in campi)) return;`) invece di sovrascriverlo
        // con una stringa vuota.
        var campi = {};
        ['nome', 'cognome', 'cf', 'dataNascita', 'sesso', 'email', 'telefono'].forEach(function(k) {
          if (p[k] !== undefined) campi[k] = p[k];
        });
        data = presidenzaAggiornaAnagrafica(p.idPratica, campi, idToken);
        break;
      case 'aggiorna_liberatoria':
        // Stesso contratto dell'anagrafica: solo i canali presenti nella query
        // vengono toccati. Il valore è testuale perché arriva da una query
        // string — 'SI'/'true'/'1' valgono autorizzato, tutto il resto no.
        var canali = {};
        ['sito', 'social', 'stampa', 'video'].forEach(function(k) {
          if (p[k] !== undefined) {
            canali[k] = ['SI', 'SÌ', 'TRUE', '1', 'ON', 'YES'].indexOf(String(p[k]).trim().toUpperCase()) !== -1;
          }
        });
        data = presidenzaAggiornaLiberatoria(p.idPratica, canali, idToken);
        break;
      case 'salva_nota':
        data = presidenzaSalvaNota(p.idPratica, p.nota || '', idToken);
        break;
      case 'cronologia':
        data = presidenzaCronologia(p.idPratica, idToken);
        break;
      default:
        throw new Error('Azione non riconosciuta: "' + (p.action || '') + '".');
    }
    return _presidenzaJson_({ ok: true, data: data });
  } catch (err) {
    traceLog_('[PresidenzaAdminAPI] ' + (p.action || '?') + ': ' + (err && err.message ? err.message : err));
    return _presidenzaJson_({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}
