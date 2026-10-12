/**
 * MODULO: 16_ModuloPagamentoWebApp.gs
 * ══════════════════════════════════════════════════════════════════════
 * Fase 2 del workflow di iscrizione: pagamento della quota Socio Ordinario,
 * DOPO l'approvazione della Presidenza (Fase 1 → 15_ModuloIscrizioneWebApp.gs).
 *
 * L'utente arriva qui dal pulsante "Associati adesso" nella mail di
 * approvazione (inviaEmailInvitoPagamento_ in 6_Mail.gs). Si identifica con
 * ID Pratica + Codice Fiscale (nessun login richiesto), poi viene
 * reindirizzato a una Stripe Checkout Session. La verifica del pagamento e
 * l'attivazione automatica dell'account (Workspace, tessera, email di
 * benvenuto) avvengono nel webhook Stripe — vedi gestisciPagamentoRiuscito_
 * in 3_StripeAdmin.gs.
 *
 * Servita dal router unico doGet() in 15_ModuloIscrizioneWebApp.gs
 * quando l'URL contiene ?pagina=paga.
 */

function doGetPagamento(e) {
  // IMPORTANTE: in modalità IFRAME_SANDBOX (l'unica disponibile per le Web App
  // Apps Script) il contenuto utente gira dentro un iframe sandboxato la cui
  // window.location NON eredita la query string dell'URL /exec visitato dal
  // browser. Leggere idPratica/pagamento da window.location.search lato client
  // non funziona: vanno passati come scriptlet lato server via e.parameter.
  const p = (e && e.parameter) || {};
  const idPratica = String(p.idPratica || '').trim().toUpperCase();
  const template = HtmlService.createTemplateFromFile('ModuloPagamentoHTML');
  template.idPraticaPrefill = idPratica;
  template.pagamentoEsito = String(p.pagamento || '').trim();

  // Utente tornato da Stripe con checkout annullato ("Riprova il pagamento" nel
  // Modulo): rimuove subito il blocco "in corso" invece di lasciarlo scadere da
  // solo — vedi pulisciCheckoutPendente_ in 3_StripeAdmin.gs.
  if (template.pagamentoEsito === 'annullato' && idPratica) {
    try { pulisciCheckoutPendente_(idPratica); }
    catch(err) { traceLog_('[ModuloPagamento] WARN pulizia checkout pendente: ' + err.message); }
  }

  return template.evaluate()
    .setTitle('Completa l\'iscrizione — {{NOME_GRUPPO}}')
    .setFaviconUrl('{{LOGO_URL}}')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/**
 * Funzione backend chiamata dal Modulo Pagamento client-side.
 * Verifica ID Pratica + Codice Fiscale, poi crea la Checkout Session Stripe.
 * Messaggio d'errore volutamente generico (non specifica quale campo è
 * sbagliato) per non facilitare tentativi di indovinare le combinazioni.
 */
function avviaPagamentoQuota(idPraticaInput, cfInput, codiceScontoInput) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);

    const idPratica = String(idPraticaInput||'').trim().toUpperCase();
    const cf = String(cfInput||'').trim().toUpperCase();
    const codiceSconto = String(codiceScontoInput||'').trim().toUpperCase();
    if (!idPratica || !cf) {
      return { ok:false, error:'Inserisci ID Pratica e Codice Fiscale.' };
    }
    if (codiceSconto && codiceSconto !== '{{CODICE_SCONTO_PRESIDENZA}}') {
      return { ok:false, error:'Il Codice Sconto non è valido.' };
    }

    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) throw new Error('Foglio "' + CONFIG.SHEET_NAME + '" non trovato.');

    const I = CONFIG.IDX;
    const allData = sheet.getDataRange().getValues();

    let row = -1, rowData = null;
    for (let i = 1; i < allData.length; i++) {
      const r = allData[i];
      if (r[I.TIPO_ASSOCIATO] !== 'Socio Ordinario') continue;
      if (String(r[I.ID_PRATICA]||'').trim().toUpperCase() !== idPratica) continue;
      if (String(r[I.CF_SOCIO]||'').trim().toUpperCase() !== cf) continue;
      row = i + 1; rowData = r;
      break;
    }

    const erroreGenerico = 'ID Pratica o Codice Fiscale non corretti, oppure la domanda non è ancora stata approvata dalla Presidenza.';
    if (row < 0) {
      traceLog_('[ModuloPagamento] Nessun match per ID Pratica "'+idPratica+'".');
      return { ok:false, error: erroreGenerico };
    }

    const stato = String(rowData[I.STATO_DOMANDA]||'').trim();
    if (stato !== 'Ammesso') {
      traceLog_('[ModuloPagamento] Riga '+row+' trovata ma stato="'+stato+'" (non Ammesso).');
      return { ok:false, error: erroreGenerico };
    }

    const statoPagamento = String(rowData[I.STATO_PAGAMENTO]||'').trim();
    if (statoPagamento === 'Regolare') {
      return { ok:false, error:'Il pagamento risulta già completato. Controlla la tua email per le credenziali e la tessera — se non le trovi, contattaci a '+CONFIG.EMAIL_MITTENTE+'.', giaPagato:true };
    }

    // Checkout già completato (STRIPE_SUB_ID registrato da gestisciCheckoutCompletato_)
    // ma esito del primo pagamento non ancora noto — Stripe lo sta ancora elaborando
    // (es. 3D Secure lento, SEPA, bonifico). Esclude 'Errore'/'Cancellato': se il
    // pagamento è già fallito o l'abbonamento è stato annullato, non è più "in corso"
    // e un nuovo tentativo deve poter creare una nuova Checkout Session.
    if (String(rowData[I.STRIPE_SUB_ID]||'').trim() && statoPagamento !== 'Errore' && statoPagamento !== 'Cancellato') {
      traceLog_('[ModuloPagamento] Riga '+row+' ha una subscription Stripe in elaborazione ('+rowData[I.STRIPE_SUB_ID]+').');
      return { ok:false, error:'Risulta già un pagamento in corso per questa iscrizione, che Stripe sta ancora elaborando. Controlla la tua email tra qualche minuto — se non ricevi conferma, scrivici a '+CONFIG.EMAIL_MITTENTE+'.', pagamentoInCorso:true };
    }

    // Checkout Session creata ma non ancora completata — blocca un secondo
    // tentativo finché non scade il TTL (allineato a expires_at su Stripe) o
    // finché l'esito non è noto (vedi pulisciCheckoutPendente_ in 3_StripeAdmin.gs).
    const props = PropertiesService.getScriptProperties();
    const chiavePendente = 'CHECKOUT_QUOTA_' + idPratica;
    const pendenteRaw = props.getProperty(chiavePendente);
    if (pendenteRaw) {
      let pendente = null;
      try { pendente = JSON.parse(pendenteRaw); } catch(e) {}
      const ttlMs = CONFIG.STRIPE.CHECKOUT_TTL_MIN * 60 * 1000;
      if (pendente && pendente.createdAt && (Date.now() - pendente.createdAt) < ttlMs) {
        traceLog_('[ModuloPagamento] Riga '+row+' ha già un checkout aperto ('+pendente.sessionId+').');
        return { ok:false, error:'Hai già una sessione di pagamento aperta per questa iscrizione. Se hai una scheda del browser ancora aperta su Stripe, completala da lì; altrimenti riprova tra qualche minuto.', pagamentoInCorso:true };
      }
      props.deleteProperty(chiavePendente); // scaduta, si può ripartire
    }

    // ── Liberatoria: l'unico punto che nessun percorso può aggirare ─────────
    // Qui passano il link diretto, il ritorno da Stripe e ogni nuovo tentativo.
    // Si controlla che una RISPOSTA esista, non che sia positiva: un NO sblocca
    // il pagamento esattamente come un SÌ. L'errore resta generico come gli
    // altri di questa funzione, e nella risposta non finisce mai un token.
    const statoLib = statoLiberatoria_(rowData);
    if (!statoLib.rispostaRegistrata) {
      libRichiediLiberatoria_(sheet, row, rowData, 'pagamento');
      traceLog_('[ModuloPagamento] Riga '+row+' senza liberatoria ('+statoLib.stato+'): checkout non creato.');
      return { ok:false, liberatoriaMancante:true,
        error: statoLib.attesaSecondoGenitore
          ? 'Manca ancora la firma dell\'altro genitore sull\'autorizzazione a foto, video e registrazioni. '
            + 'Gli abbiamo scritto: appena firma, potrai completare il pagamento. Se non ha ricevuto nulla, '
            + 'scrivici a ' + CONFIG.EMAIL_MITTENTE + '.'
          : 'Prima di completare l\'iscrizione ci serve una risposta sull\'autorizzazione a foto, video e '
            + 'registrazioni: va bene anche un no, e non cambia nulla dell\'iscrizione. Ti abbiamo inviato '
            + 'per email il collegamento per rispondere — controlla anche la posta indesiderata, oppure '
            + 'scrivici a ' + CONFIG.EMAIL_MITTENTE + '.' };
    }

    const baseUrl = ScriptApp.getService().getUrl();
    const esito = creaCheckoutSessionQuotaSocio_(
      idPratica,
      rowData[I.EMAIL_SOCIO],
      baseUrl + '?pagina=paga&pagamento=ok&idPratica=' + encodeURIComponent(idPratica),
      baseUrl + '?pagina=paga&pagamento=annullato&idPratica=' + encodeURIComponent(idPratica),
      codiceSconto
    );
    if (!esito.ok) {
      traceLog_('[ModuloPagamento] Checkout non creato per '+idPratica+': '+esito.errore);
      return { ok:false, error:'Pagamento momentaneamente non disponibile. Riprova più tardi o contatta la Presidenza.' };
    }

    props.setProperty(chiavePendente, JSON.stringify({ sessionId: esito.sessionId, createdAt: Date.now() }));

    traceLog_('[ModuloPagamento] Checkout creato per '+idPratica+' — sessione '+esito.sessionId);
    return { ok:true, checkoutUrl: esito.url };

  } catch(err) {
    traceLog_('[ModuloPagamento] Errore: '+err.toString());
    return { ok:false, error:'Errore imprevisto. Riprova più tardi.' };
  } finally {
    lock.releaseLock();
  }
}
