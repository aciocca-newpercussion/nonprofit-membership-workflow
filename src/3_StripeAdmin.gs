/**
 * MODULO: 3_StripeAdmin.gs
 * ══════════════════════════════════════════════════════════════════════
 * Gestione completa del ciclo di vita abbonamenti Stripe:
 *
 *  A. Webhook handler (doPost) — riceve eventi da Stripe:
 *       checkout.session.completed → registra STRIPE_CUSTOMER_ID/STRIPE_SUB_ID
 *                                     sulla riga (match per ID_PRATICA)
 *       invoice.payment_succeeded → rinnovo: aggiorna scadenza quota +365
 *       invoice.payment_failed    → imposta Stato pagamento = Errore
 *       customer.subscription.deleted → abbonamento cancellato definitivamente
 *
 *  B. TriggerCancellazioneAbbonamento — intercetta "Stato pagamento" = "Cancellato"
 *       impostato manualmente dall'admin
 *
 *  C. controlloScadenzeGiornaliero — trigger giornaliero ore 08:00:
 *       - Se quota scaduta da >0 giorni e Stato pagamento ≠ Regolare → Errore
 *       - Se quota scaduta da >30 giorni → notifica Chat Presidenza per assemblea
 *
 *  D. eseguiRimborsoStripe_ — chiamato da TriggerAmmissione su rifiuto
 *
 * ── SETUP STRIPE ──────────────────────────────────────────────────────────────
 * Vedi documento Word per istruzioni complete. In sintesi:
 *  1. dashboard.stripe.com > Developers > API Keys → SECRET_KEY in CONFIG
 *  2. Crea prodotto "Quota Associativa {{NOME_GRUPPO}}" con prezzo ricorrente annuale pari a CONFIG.STRIPE.QUOTA_CENTESIMI
 *  3. Webhook endpoint: URL di questo script deployato come Web App
 *     Events: checkout.session.completed, invoice.payment_succeeded,
 *             invoice.payment_failed, customer.subscription.deleted,
 *             customer.subscription.updated
 *  4. Webhook Signing Secret → CONFIG.STRIPE.WEBHOOK_SECRET
 *  5. Ogni Socio Ordinario: registra nel foglio cus_xxx, sub_xxx, charge_id/pi_xxx
 *     (per gli iscritti dal Modulo Web, questo avviene automaticamente via
 *     checkout.session.completed — vedi creaCheckoutSessionQuotaSocio_, chiamata
 *     dal Modulo Pagamento di Fase 2 in 16_ModuloPagamentoWebApp.gs)
 *
 * NOTA sul flusso a due fasi (Fase 1 domanda → approvazione → Fase 2 pagamento):
 * il primo invoice.payment_succeeded per un Socio Ordinario appena ammesso
 * innesca automaticamente eseguiOnboarding_ (Workspace, M365, tessera, email
 * di benvenuto) — vedi gestisciPagamentoRiuscito_.
 */

// ═════════════════════════════════════════════════════════════════════════════
// A. WEBHOOK HANDLER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Entry point Web App — riceve POST da Stripe.
 * NON è un progetto separato: vive nello STESSO progetto/deployment di
 * doGet (15_ModuloIscrizioneWebApp.gs) — un deployment Web App gestisce sia
 * GET (form) sia POST (webhook) sullo stesso URL /exec. Configura questo
 * stesso URL come endpoint webhook su Stripe.
 */
function doPost(e) {
  // Lock globale: evita che due webhook identici arrivati quasi simultaneamente
  // superino entrambi il check eventoStripeGiaProcessato_ prima che uno scriva.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch(_) {
    traceLog_('[Webhook] Lock non acquisito — webhook scartato (elaborazione in corso).');
    return ContentService.createTextOutput('Locked').setMimeType(ContentService.MimeType.TEXT);
  }

  try {
    // Il corpo arriva in Base64 URL-safe dal proxy (stripe-webhook-proxy/src/index.js).
    // La verifica della firma Stripe (HMAC-SHA256) avviene ORA nel Worker stesso,
    // con Web Crypto — non più qui. Due tentativi di calcolare l'HMAC su byte[]
    // dentro Apps Script hanno urtato contro un limite del bridge V8/Java di GAS
    // (Byte[] "vero" solo se non toccato da .concat()/.slice() di JS dopo essere
    // uscito da una chiamata nativa) — vedi HANDOFF_STRIPE_WEBHOOK.md.
    // Qui si verifica solo che la richiesta venga davvero dal Worker (che ha già
    // verificato la firma Stripe) tramite un segreto condiviso passato come query
    // param `internal_key` — un confronto di stringhe, nessun byte[] coinvolto.
    const payloadBytes = Utilities.base64DecodeWebSafe(e.postData.contents);
    const payload       = Utilities.newBlob(payloadBytes).getDataAsString('UTF-8');
    const internalKey    = e.parameter['internal_key'] || '';

    if (!CONFIG.STRIPE.WEBHOOK_SECRET || CONFIG.STRIPE.WEBHOOK_SECRET.includes('INSERISCI')) {
      traceLog_('[Webhook] WEBHOOK_SECRET non configurato. Richiesta rifiutata.');
      return ContentService.createTextOutput('Unauthorized').setMimeType(ContentService.MimeType.TEXT);
    }
    if (internalKey !== CONFIG.STRIPE.WEBHOOK_SECRET) {
      traceLog_('[Webhook] internal_key mancante o non valida — richiesta non proviene dal proxy. Rifiutata.');
      return ContentService.createTextOutput('Unauthorized').setMimeType(ContentService.MimeType.TEXT);
    }

    const evento = JSON.parse(payload);
    traceLog_(`[Webhook] Evento ricevuto: ${evento.type} (${evento.id})`);

    if (eventoStripeGiaProcessato_(evento.id)) {
      traceLog_(`[Webhook] Evento già processato: ${evento.id}. Skip.`);
      return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
    }

    switch (evento.type) {
      case 'checkout.session.completed':
        gestisciCheckoutCompletato_(evento.data.object);
        break;
      case 'invoice.payment_succeeded':
        gestisciPagamentoRiuscito_(evento.data.object);
        break;
      case 'invoice.paid':
        // Per abbonamenti gratuiti Stripe può emettere invoice.paid senza
        // creare un PaymentIntent, quindi senza invoice.payment_succeeded.
        if ((evento.data.object.amount_paid || 0) === 0) {
          gestisciPagamentoRiuscito_(evento.data.object);
        }
        break;
      case 'invoice.payment_failed':
        gestisciPagamentoFallito_(evento.data.object);
        break;
      case 'customer.subscription.deleted':
        gestisciAbbonamentoCancellato_(evento.data.object);
        break;
      case 'customer.subscription.updated':
        gestisciAbbonamentoAggiornato_(evento.data.object);
        break;
      default:
        traceLog_(`[Webhook] Evento ignorato: ${evento.type}`);
    }

    registraEventoStripeProcessato_(evento.id);
    return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
  } catch(err) {
    traceLog_('[Webhook] ERRORE: ' + err.toString());
    inviaEmailErroreAmministratore(err);
    return ContentService.createTextOutput('Error').setMimeType(ContentService.MimeType.TEXT);
  } finally {
    try { lock.releaseLock(); } catch(_) {}
  }
}

// ── checkout.session.completed ────────────────────────────────────────────────
// Collega la subscription Stripe appena creata alla riga del foglio corrispondente
// (match per ID_PRATICA, passato come client_reference_id in fase di creazione
// della Checkout Session — vedi creaCheckoutSessionQuotaSocio_). Da qui in poi
// invoice.payment_succeeded troverà la riga tramite STRIPE_SUB_ID come per il
// vecchio flusso Jotform.
function gestisciCheckoutCompletato_(session) {
  const idPratica = String(session.client_reference_id||'').trim().toUpperCase();
  const custId = session.customer;
  const subId  = session.subscription;
  traceLog_(`[Webhook] Checkout completato — ID Pratica: ${idPratica}, cus: ${custId}, sub: ${subId}`);

  if (!idPratica || !subId || !custId) {
    traceLog_('[Webhook] WARN checkout.session.completed senza idPratica/customer/subscription.');
    return;
  }

  const { sheet, row } = trovaRigaPerIdPratica_(idPratica);
  if (!sheet) {
    traceLog_(`[Webhook] WARN: nessuna riga trovata per ID Pratica=${idPratica}`);
    return;
  }

  const I = CONFIG.IDX;
  sheet.getRange(row, I.STRIPE_CUSTOMER_ID+1).setValue(custId);
  sheet.getRange(row, I.STRIPE_SUB_ID+1).setValue(subId);
  SpreadsheetApp.flush();
  traceLog_(`[Webhook] Riga ${row}: STRIPE_CUSTOMER_ID/STRIPE_SUB_ID registrati.`);

  // Il checkout è completato: da qui in poi il blocco "in corso" è dato da
  // STRIPE_SUB_ID stesso (vedi avviaPagamentoQuota), non serve più il flag locale.
  pulisciCheckoutPendente_(idPratica);
}

// ── Campi invoice ristrutturati da Stripe (API 2025+) ───────────────────────────
// Da una certa versione API, Invoice.subscription/charge/payment_intent non sono
// più campi diretti: la subscription è sotto invoice.parent.subscription_details.subscription,
// e charge/payment_intent sono dentro invoice.payments.data[].payment. Questi helper
// leggono prima il campo vecchio (compatibilità) e poi il nuovo, così funzionano con
// entrambe le versioni API — scoperto perché invoice.payment_succeeded arrivava con
// invoice.subscription undefined (vedi HANDOFF_STRIPE_WEBHOOK.md).
function estraiSubIdInvoice_(invoice) {
  return invoice.subscription
    || (invoice.parent && invoice.parent.subscription_details && invoice.parent.subscription_details.subscription)
    || '';
}

function estraiChargeIdInvoice_(invoice) {
  if (invoice.charge || invoice.payment_intent) return invoice.charge || invoice.payment_intent;
  const pagamenti = (invoice.payments && invoice.payments.data) || [];
  const pagato = pagamenti.find(function(p) { return p.status === 'paid'; }) || pagamenti[0];
  if (!pagato || !pagato.payment) return '';
  return pagato.payment.payment_intent || pagato.payment.charge || '';
}

// ── invoice.payment_succeeded ─────────────────────────────────────────────────
function gestisciPagamentoRiuscito_(invoice) {
  const subId     = estraiSubIdInvoice_(invoice);
  const custId    = invoice.customer;
  const chargeId  = estraiChargeIdInvoice_(invoice);
  const dataPag   = new Date(invoice.created * 1000);
  const amountPaid = invoice.amount_paid || 0;

  traceLog_(`[Webhook] Pagamento riuscito — sub: ${subId}, cus: ${custId}, importo: ${amountPaid} €cent`);

  // Verifica che l'importo copra la quota. L'unica eccezione ammessa è la
  // sottoscrizione a 0 € creata dal codice sconto autorizzato.
  const codiceSconto = amountPaid === 0 ? recuperaCodiceScontoAbbonamento_(subId) : '';
  const pagamentoScontato = amountPaid === 0 && codiceSconto === '{{CODICE_SCONTO_PRESIDENZA}}';
  if (amountPaid < CONFIG.STRIPE.QUOTA_CENTESIMI && !pagamentoScontato) {
    const msg = `Webhook payment_succeeded con importo anomalo: ${amountPaid} €cent (quota attesa: ${CONFIG.STRIPE.QUOTA_CENTESIMI} €cent). Sub: ${subId}, Cus: ${custId}`;
    traceLog_('[Webhook] ⚠️ ' + msg);
    inviaEmailErroreAmministratore(new Error(msg));
    return;
  }

  if (pagamentoScontato) {
    traceLog_(`[Webhook] Codice sconto ${codiceSconto} verificato — importo 0 € accettato.`);
  }

  const { sheet, row, rowData } = trovaRigaPerStripe_(subId, custId);
  if (!sheet) {
    traceLog_(`[Webhook] WARN: Nessuna riga trovata per sub=${subId} / cus=${custId}`);
    return;
  }

  const I          = CONFIG.IDX;
  const nuovaScad  = aggiungi365Giorni_(dataPag);
  // Primo pagamento (iscrizione) vs rinnovo di un anno successivo: se non è ancora
  // membro ufficiale, questo pagamento è quello che sblocca l'onboarding completo.
  const primoPagamento = rowData[I.MEMBRO_UFFICIALE] !== 'SI';

  // Aggiorna colonne
  sheet.getRange(row, I.DATA_ULTIMO_RINNOVO+1).setValue(dataPag);
  sheet.getRange(row, I.DATA_SCADENZA_QUOTA+1).setValue(nuovaScad);
  sheet.getRange(row, I.STATO_PAGAMENTO+1).setValue('Regolare');
  if (chargeId) sheet.getRange(row, I.ID_TRANSAZIONE+1).setValue(chargeId);
  SpreadsheetApp.flush();

  traceLog_(`[Webhook] Riga ${row}: pagamento registrato, scadenza aggiornata al ${formatData_(nuovaScad)}`);

  // Pagamento risolto con successo: nessun blocco "in corso" da mantenere
  // (rete di sicurezza — normalmente già rimosso da gestisciCheckoutCompletato_).
  pulisciCheckoutPendente_(rowData[I.ID_PRATICA]);

  // Se era in stato Errore e aveva un avviso pendente → cancella la notifica pendente
  rimuoviAvvisoPendente_(rowData[I.ID_PRATICA]);

  // Genera ricevuta finanziaria (14_IntegrazioneFinanza.gs) — sempre, primo pagamento o rinnovo
  try { generaRicevutaQuotaSocio_(rowData, amountPaid, chargeId); }
  catch(err) { traceLog_('[Finanza] WARN ricevuta non generata: ' + err.message); }

  if (primoPagamento && rowData[I.STATO_DOMANDA] === 'Ammesso') {
    // Rilegge la riga: eseguiOnboarding_ deve vedere STATO_PAGAMENTO='Regolare' appena scritto.
    const rowDataFresh = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    const check = verificaPrecondizioni_(rowDataFresh, sheet);
    if (check.ok) {
      traceLog_(`[Webhook] Primo pagamento verificato per riga ${row} — avvio onboarding completo.`);
      try { eseguiOnboarding_(sheet, row, rowDataFresh); }
      catch(err) {
        traceLog_(`[Webhook] ERRORE onboarding dopo pagamento riga ${row}: ${err.toString()}`);
        inviaEmailErroreAmministratore(err);
      }
    } else if (check.inAttesaLiberatoria) {
      // Raggiungibile davvero: un checkout creato prima che il gate esistesse,
      // o una pratica retroattiva. Non è un guasto da segnalare all'admin — si
      // chiede la firma e l'onboarding riparte da sbloccaDopoLiberatoria_.
      traceLog_(`[Webhook] Pagamento OK ma liberatoria mancante (riga ${row}): ${check.motivo}`);
      libRichiediLiberatoria_(sheet, row, rowDataFresh, 'pagamento già effettuato');
    } else {
      // Pagamento ok ma manca qualcos'altro (es. Gruppo non ancora compilato dall'admin):
      // è un vero problema amministrativo, non l'attesa fisiologica del pagamento.
      traceLog_(`[Webhook] Pagamento OK ma onboarding non avviato (riga ${row}): ${check.motivo}`);
      inviaEmailErroreAmministratore(new Error(
        'Pagamento ricevuto per riga '+row+' ma onboarding bloccato: '+check.motivo
      ));
    }
  } else {
    // Rinnovo di un membro già ufficiale: email di conferma rinnovo (non ha senso al primo pagamento).
    try { inviaEmailConfermaRinnovo_(rowData, nuovaScad); }
    catch(err) { traceLog_(`WARN email rinnovo: ${err.message}`); }
  }
}

// ── invoice.payment_failed ────────────────────────────────────────────────────
function gestisciPagamentoFallito_(invoice) {
  const subId  = estraiSubIdInvoice_(invoice);
  const custId = invoice.customer;
  traceLog_(`[Webhook] Pagamento fallito — sub: ${subId}`);

  const { sheet, row, rowData } = trovaRigaPerStripe_(subId, custId);
  if (!sheet) return;

  const I = CONFIG.IDX;
  sheet.getRange(row, I.STATO_PAGAMENTO+1).setValue('Errore');
  SpreadsheetApp.flush();

  // Pagamento fallito: il socio deve poter ritentare subito, non aspettare il TTL.
  pulisciCheckoutPendente_(rowData[I.ID_PRATICA]);

  const dati = getDatiAnagrafici_(rowData, rowData[I.TIPO_ASSOCIATO]);
  const scad = formatData_(calcolaDataScadenza_(rowData));

  try { inviaEmailPagamentoFallito_(dati, rowData[I.ID_PRATICA]||'N/D', scad); }
  catch(err) { traceLog_(`WARN email pagamento fallito: ${err.message}`); }

  traceLog_(`[Webhook] Stato pagamento → Errore per riga ${row}`);
}

// ── customer.subscription.deleted ────────────────────────────────────────────
function gestisciAbbonamentoCancellato_(sub) {
  traceLog_(`[Webhook] Abbonamento cancellato: ${sub.id}`);
  const { sheet, row, rowData } = trovaRigaPerStripe_(sub.id, sub.customer);
  if (!sheet) return;
  // Avvia flusso cancellazione come se fosse manuale
  eseguiFlussoAnnullamento_(sheet, row, rowData);
}

// ── customer.subscription.updated ────────────────────────────────────────────
function gestisciAbbonamentoAggiornato_(sub) {
  if (sub.cancel_at_period_end === true) {
    traceLog_(`[Webhook] Abbonamento ${sub.id} impostato su cancel_at_period_end`);
    const { sheet, row, rowData } = trovaRigaPerStripe_(sub.id, sub.customer);
    if (!sheet) return;
    eseguiFlussoAnnullamento_(sheet, row, rowData);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// B. TRIGGER MANUALE — "Stato pagamento" = "Cancellato"
// ═════════════════════════════════════════════════════════════════════════════

function TriggerCancellazioneAbbonamento(e) {
  if (!e || !e.range) return;
  if (e.range.getColumn() !== CONFIG.IDX.STATO_PAGAMENTO+1) return;
  if (e.value !== 'Cancellato') return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;
  const row = e.range.getRow();
  if (row <= 1) return;

  const rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (rowData[CONFIG.IDX.MEMBRO_UFFICIALE] !== 'SI') return;

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    eseguiFlussoAnnullamento_(sheet, row, rowData);
  } catch(err) {
    traceLog_('ERRORE TriggerCancellazioneAbbonamento: ' + err.toString());
    inviaEmailErroreAmministratore(err);
  } finally {
    lock.releaseLock();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// FLUSSO ANNULLAMENTO — condiviso da webhook e trigger manuale
// ═════════════════════════════════════════════════════════════════════════════

function eseguiFlussoAnnullamento_(sheet, row, rowData) {
  const I    = CONFIG.IDX;
  const tipo = rowData[I.TIPO_ASSOCIATO];
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[I.ID_PRATICA]||'N/D';
  const subId = String(rowData[I.STRIPE_SUB_ID]||'').trim();
  const props = PropertiesService.getScriptProperties();
  const chiaveAnnullamento = 'ANNULLAMENTO_' + (idP !== 'N/D' ? idP : subId || row);

  traceLog_(`=== ANNULLAMENTO ABBONAMENTO: ${dati.nome} ${dati.cognome} (${idP}) ===`);

  if (props.getProperty(chiaveAnnullamento)) {
    traceLog_(`[Annullamento] Flusso già gestito per ${idP}. Skip.`);
    return;
  }

  // 1. Cancella abbonamento Stripe se non già cancellato
  if (subId && subId.startsWith('sub_')) {
    try {
      const ris = cancellaAbbonamentoStripe_(subId);
      if (!ris.ok) traceLog_(`[Annullamento] WARN Stripe: ${ris.errore}`);
    } catch(err) { traceLog_(`[Annullamento] WARN: ${err.message}`); }
  }

  // 2. Stato pagamento → Errore (membro rimane ufficiale fino a scadenza)
  sheet.getRange(row, I.STATO_PAGAMENTO+1).setValue('Errore');
  SpreadsheetApp.flush();

  // Abbonamento annullato: rimuove un eventuale blocco "in corso" residuo.
  pulisciCheckoutPendente_(idP);

  // 3. Calcola data scadenza
  const dataScadenza    = calcolaDataScadenza_(rowData);
  const dataScadenzaStr = dataScadenza ? formatData_(dataScadenza) : 'N/D';

  // 4. Email al socio: rimane attivo fino a scadenza
  try { inviaEmailAnnullamentoAbbonamento_(rowData, tipo, idP, dataScadenzaStr); }
  catch(err) { traceLog_(`WARN email annullamento: ${err.message}`); }

  // 5. Se ha volontari collegati → email ai volontari
  try { notificaVolontariCollegati_(rowData, dataScadenzaStr); }
  catch(err) { traceLog_(`WARN email volontari: ${err.message}`); }

  // 6. Registra avviso da inviare alla presidenza dopo 30 giorni
  registraAvvisoPendente_(row, idP, dati.nome, dati.cognome, dataScadenza);
  props.setProperty(chiaveAnnullamento, JSON.stringify({
    idPratica: idP,
    subId: subId,
    gestitoIl: new Date().toISOString(),
  }));

  traceLog_(`=== ANNULLAMENTO COMPLETATO: ${dati.nome} ${dati.cognome} ===`);
}

// ═════════════════════════════════════════════════════════════════════════════
// C. CONTROLLO GIORNALIERO SCADENZE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Eseguito ogni giorno alle 08:00.
 * Controlla:
 *  1. Avvisi pendenti >30 giorni → invia notifica Chat Presidenza
 *  2. Quote scadute con Stato pagamento = Errore → verifica e aggiorna
 */
function controlloScadenzeGiornaliero() {
  traceLog_('=== CONTROLLO SCADENZE GIORNALIERO ===');
  processaAvvisiPendenti_();

  // Liberatoria: pulizia dei token scaduti (ScriptProperties ha mezzo mega in
  // tutto) e promemoria a chi non ha ancora risposto, a 30/15/7 giorni dalla
  // scadenza della quota. Best-effort: un problema qui non deve impedire il
  // controllo delle morosità, che è l'adempimento dell'Art. 9.1.b.
  try { libPurgeTokenScaduti_(); }
  catch(err) { traceLog_('[Liberatoria] WARN purge token: ' + (err && err.message ? err.message : err)); }
  try { liberatoriaPromemoriaRinnovi_(); }
  catch(err) { traceLog_('[Liberatoria] WARN promemoria rinnovi: ' + (err && err.message ? err.message : err)); }

  traceLog_('=== FINE CONTROLLO SCADENZE ===');
}

// ── Avvisi pendenti (30 giorni post-annullamento) ─────────────────────────────

function registraAvvisoPendente_(row, idPratica, nome, cognome, dataScadenza) {
  const props  = PropertiesService.getScriptProperties();
  const chiave = 'AVVISI_PENDENTI';
  let lista = [];
  try { lista = JSON.parse(props.getProperty(chiave)||'[]'); } catch(e) {}

  if (!lista.find(a => a.row === row)) {
    lista.push({
      row, idPratica, nome, cognome,
      dataScadenzaStr: dataScadenza ? formatData_(dataScadenza) : 'N/D',
      dataRegistrazione: new Date().toISOString(),
      avvisoInviato: false,
    });
    props.setProperty(chiave, JSON.stringify(lista));
    traceLog_(`[Avviso] Registrato avviso pendente per ${nome} ${cognome} (riga ${row})`);
  }
}

function rimuoviAvvisoPendente_(idPratica) {
  const props  = PropertiesService.getScriptProperties();
  const chiave = 'AVVISI_PENDENTI';
  let lista = [];
  try { lista = JSON.parse(props.getProperty(chiave)||'[]'); } catch(e) {}
  lista = lista.filter(a => a.idPratica !== idPratica);
  props.setProperty(chiave, JSON.stringify(lista));
}

function processaAvvisiPendenti_() {
  const props  = PropertiesService.getScriptProperties();
  const chiave = 'AVVISI_PENDENTI';
  let lista = [];
  try { lista = JSON.parse(props.getProperty(chiave)||'[]'); } catch(e) { return; }
  if (!lista.length) return;

  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  const oggi  = new Date();
  let modificato = false;

  lista.forEach((avviso, idx) => {
    if (avviso.avvisoInviato) return;

    const dataReg = new Date(avviso.dataRegistrazione);
    const giorniPassati = Math.floor((oggi - dataReg) / (1000*60*60*24));

    if (giorniPassati >= 30) {
      // Verifica che il membro non abbia già rinnovato
      try {
        const rowData = sheet.getRange(avviso.row, 1, 1, sheet.getLastColumn()).getValues()[0];
        if (rowData[CONFIG.IDX.STATO_PAGAMENTO] === 'Regolare') {
          traceLog_(`[Avviso] ${avviso.nome} ${avviso.cognome} ha rinnovato. Rimuovo avviso.`);
          lista[idx].avvisoInviato = true;
          modificato = true;
          return;
        }

        // Invia notifica Chat Presidenza
        inviaNotificaPresidenzaScadenza_(avviso, giorniPassati);
        lista[idx].avvisoInviato = true;
        modificato = true;
        traceLog_(`[Avviso] Notifica inviata per ${avviso.nome} ${avviso.cognome} (${giorniPassati} giorni)`);
      } catch(err) {
        traceLog_(`[Avviso] WARN: ${err.message}`);
      }
    }
  });

  if (modificato) props.setProperty(chiave, JSON.stringify(lista));
}

// La decadenza per mancato pagamento (Art. 9.1.b) NON passa dall'Assemblea:
// è accertata dalla Presidenza (Art. 9.2). All'Assemblea compete l'espulsione
// (Art. 9.3), che è un'altra cosa — una misura disciplinare, non l'effetto di
// una quota non versata. Questa card chiede quindi alla Presidenza di
// accertare, non di convocare.
function inviaNotificaPresidenzaScadenza_(avviso, giorni) {
  if (!CONFIG.CHAT_WEBHOOK_URL || CONFIG.CHAT_WEBHOOK_URL.includes('INSERISCI')) return;
  inviaChatCard_({
    id: 'scadenza_quota',
    titolo: '⚠️ Quota non rinnovata — accertare la decadenza',
    sottotitolo: `${giorni} giorni senza rinnovo`,
    headerColor: '#B06500',
    idPratica: avviso.idPratica,
    testo: `<b>${avviso.nome} ${avviso.cognome}</b> non ha rinnovato la quota da <b>${giorni} giorni</b>.\n\nAi sensi dell\'Art. 9.1.b dello Statuto il mancato pagamento della quota determina la decadenza dalla qualifica di Socio, che la Presidenza accerta ai sensi dell\'Art. 9.2 e comunica all\'interessato. Si registra dal pannello Presidenza, azione «Registra cessazione» → causa «Decadenza».`,
    campi: [
      { label:'ID Pratica',    valore: avviso.idPratica },
      { label:'Quota scaduta', valore: avviso.dataScadenzaStr },
      { label:'Giorni morosità', valore: String(giorni) },
      { label:'Azione richiesta', valore: 'Accertamento della Presidenza (Art. 9.1.b e 9.2 Statuto)' },
    ],
  });
}

// ── Volontari collegati ───────────────────────────────────────────────────────

function notificaVolontariCollegati_(rowDataGenitore, dataScadenzaStr) {
  const I    = CONFIG.IDX;
  const cfG  = String(rowDataGenitore[I.CF_SOCIO]||'').trim().toUpperCase();
  const idPG = String(rowDataGenitore[I.ID_PRATICA]||'').trim().toUpperCase();
  if (!cfG || !idPG) return;

  const sheet    = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  const allData  = sheet.getDataRange().getValues();
  let trovati    = 0;

  for (let i = 1; i < allData.length; i++) {
    const row = allData[i];
    if (row[I.TIPO_ASSOCIATO] !== 'Volontario') continue;
    if (row[I.MEMBRO_UFFICIALE] !== 'SI') continue;
    const cfV  = String(row[I.CF_GENITORE]||'').trim().toUpperCase();
    const idPV = String(row[I.ID_PRATICA_GENITORE]||'').trim().toUpperCase();
    if (cfV !== cfG || idPV !== idPG) continue;

    const datiVol = getDatiAnagrafici_(row, 'Volontario');
    const idPVol  = row[I.ID_PRATICA]||'N/D';
    try {
      inviaEmailVolontarioGenitoreAnnullato_(datiVol, idPVol,
        rowDataGenitore[I.NOME_SOCIO]+' '+rowDataGenitore[I.COGNOME_SOCIO],
        dataScadenzaStr);
      trovati++;
    } catch(err) { traceLog_(`WARN email volontario collegato: ${err.message}`); }
  }
  if (trovati > 0) traceLog_(`[Annullamento] Notificati ${trovati} volontari collegati.`);
}

// ═════════════════════════════════════════════════════════════════════════════
// D. RIMBORSO STRIPE (su rifiuto domanda)
// ═════════════════════════════════════════════════════════════════════════════

function eseguiRimborsoStripe_(idTransazione, idPratica, dati) {
  const cfg = CONFIG.STRIPE;
  if (!cfg.SECRET_KEY || cfg.SECRET_KEY.includes('INSERISCI'))
    return { ok:false, errore:'Stripe non configurato.' };

  let chargeId = idTransazione;

  if (idTransazione.startsWith('pi_')) {
    const pi = stripeGet_(`/v1/payment_intents/${idTransazione}`);
    if (!pi.ok) return { ok:false, errore:`PaymentIntent non trovato: ${pi.errore}` };
    chargeId = pi.data.latest_charge;
    if (!chargeId) return { ok:false, errore:'PaymentIntent senza charge associato.' };
  }

  const ris = stripePost_('/v1/refunds', { charge: chargeId, reason:'requested_by_customer' });
  if (!ris.ok) return { ok:false, errore: ris.errore };

  const refund = ris.data;
  traceLog_(`[Stripe] Rimborso OK: ${refund.id} — ${(refund.amount/100).toFixed(2)} EUR`);

  try { inviaEmailConfermaRimborso_(dati, idPratica, refund); } catch(e) {}
  return { ok:true };
}

// ═════════════════════════════════════════════════════════════════════════════
// E. CHECKOUT — avvio pagamento quota dal Modulo Iscrizione Web
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Crea una Checkout Session Stripe in modalità abbonamento per la quota
 * associativa. Usata dal Modulo Pagamento di Fase 2 (16_ModuloPagamentoWebApp.gs)
 * dopo che la Presidenza ha già approvato la domanda "Socio Ordinario".
 * Il prezzo è generato inline (price_data) con lo stesso importo verificato
 * dal webhook in gestisciPagamentoRiuscito_ (CONFIG.STRIPE.QUOTA_CENTESIMI),
 * così non serve configurare un Price ID su Stripe.
 */
function creaCheckoutSessionQuotaSocio_(idPratica, emailSocio, successUrl, cancelUrl, codiceSconto) {
  const cfg = CONFIG.STRIPE;
  if (!cfg.SECRET_KEY || cfg.SECRET_KEY.includes('INSERISCI'))
    return { ok:false, errore:'Stripe non configurato.' };

  const scontoPresidenza = String(codiceSconto||'').trim().toUpperCase() === '{{CODICE_SCONTO_PRESIDENZA}}';
  const params = {
    'mode': 'subscription',
    'client_reference_id': idPratica,
    'success_url': successUrl,
    'cancel_url': cancelUrl,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': cfg.CURRENCY,
    'line_items[0][price_data][unit_amount]': String(scontoPresidenza ? 0 : cfg.QUOTA_CENTESIMI),
    'line_items[0][price_data][recurring][interval]': 'year',
    'line_items[0][price_data][product_data][name]': 'Quota Associativa {{NOME_GRUPPO}}',
    // Allineata al TTL del blocco "pagamento in corso" lato nostro (+1 min di
    // margine così la sessione Stripe non scade mai PRIMA del nostro blocco —
    // altrimenti un utente ancora sul checkout a ridosso dei 30 min si
    // ritroverebbe con un link già scaduto). Minimo consentito da Stripe: 30 min.
    'expires_at': String(Math.floor(Date.now()/1000) + (cfg.CHECKOUT_TTL_MIN + 1) * 60),
  };
  if (scontoPresidenza) {
    // Il metadata viene letto dal webhook tramite l'API Stripe: non ci si fida
    // del valore eventualmente manipolato nel browser.
    params['subscription_data[metadata][codice_sconto]'] = '{{CODICE_SCONTO_PRESIDENZA}}';
  }
  if (emailSocio) params['customer_email'] = emailSocio;

  const ris = stripePost_('/v1/checkout/sessions', params);
  if (!ris.ok) return { ok:false, errore: ris.errore };
  return { ok:true, url: ris.data.url, sessionId: ris.data.id };
}

/**
 * Rimuove il blocco "pagamento in corso" (ScriptProperties CHECKOUT_QUOTA_<idPratica>,
 * impostato da avviaPagamentoQuota_ in 16_ModuloPagamentoWebApp.gs quando crea una
 * Checkout Session). Va chiamata appena l'esito del checkout è noto — completato,
 * fallito o annullato — così un nuovo tentativo di pagamento non resta bloccato
 * fino alla scadenza naturale del TTL. Nessun effetto se la chiave non esiste.
 */
function pulisciCheckoutPendente_(idPratica) {
  const id = String(idPratica||'').trim().toUpperCase();
  if (!id) return;
  PropertiesService.getScriptProperties().deleteProperty('CHECKOUT_QUOTA_' + id);
}

/**
 * Recupera il codice sconto dalla subscription Stripe, dove è stato scritto
 * dal backend durante la creazione del Checkout. Usato solo per autorizzare
 * un invoice a 0 € nel webhook.
 */
function recuperaCodiceScontoAbbonamento_(subId) {
  if (!subId) return '';
  try {
    const ris = stripeGet_('/v1/subscriptions/' + encodeURIComponent(subId));
    if (!ris.ok) {
      traceLog_('[Webhook] Impossibile verificare il codice sconto della subscription: ' + ris.errore);
      return '';
    }
    return String((ris.data.metadata||{}).codice_sconto||'').trim().toUpperCase();
  } catch(err) {
    traceLog_('[Webhook] Errore verifica codice sconto: ' + err.message);
    return '';
  }
}

function cancellaAbbonamentoStripe_(subId) {
  const cfg = CONFIG.STRIPE;
  if (!cfg.SECRET_KEY || cfg.SECRET_KEY.includes('INSERISCI'))
    return { ok:false, errore:'Stripe non configurato.' };

  const ris = stripePost_(`/v1/subscriptions/${subId}`, { cancel_at_period_end:'true' });
  if (!ris.ok) return { ok:false, errore: ris.errore };
  traceLog_(`[Stripe] Abbonamento ${subId} → cancel_at_period_end`);
  return { ok:true };
}

/**
 * Cancellazione IMMEDIATA (non a fine periodo) — usata solo dall'espulsione
 * (17_PresidenzaAdmin.gs), dove l'accesso va revocato subito, non alla scadenza.
 */
function cancellaAbbonamentoStripeImmediato_(subId) {
  const cfg = CONFIG.STRIPE;
  if (!cfg.SECRET_KEY || cfg.SECRET_KEY.includes('INSERISCI'))
    return { ok:false, errore:'Stripe non configurato.' };

  const ris = stripeDelete_(`/v1/subscriptions/${subId}`);
  if (!ris.ok) return { ok:false, errore: ris.errore };
  traceLog_(`[Stripe] Abbonamento ${subId} cancellato immediatamente (espulsione).`);
  return { ok:true };
}

// ═════════════════════════════════════════════════════════════════════════════
// STRIPE HTTP HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function eventoStripeGiaProcessato_(eventId) {
  if (!eventId) return false;
  const props = PropertiesService.getScriptProperties();
  let mappa = {};
  try {
    const raw = JSON.parse(props.getProperty('STRIPE_EVENTI_PROCESSATI') || '{}');
    mappa = Array.isArray(raw) ? {} : raw; // migrazione da vecchio formato array
  } catch(e) {}
  return Object.prototype.hasOwnProperty.call(mappa, eventId);
}

function registraEventoStripeProcessato_(eventId) {
  if (!eventId) return;
  const props = PropertiesService.getScriptProperties();
  let mappa = {};
  try {
    const raw = JSON.parse(props.getProperty('STRIPE_EVENTI_PROCESSATI') || '{}');
    if (Array.isArray(raw)) {
      // Migrazione da array a oggetto con timestamp
      raw.forEach(function(id) { if (id) mappa[id] = Date.now(); });
    } else {
      mappa = raw;
    }
  } catch(e) {}

  // Stripe ritenta i webhook al massimo per 3 giorni: puliamo le voci oltre 48h.
  // Questo mantiene la chiave ScriptProperties ben al di sotto del limite di 9KB.
  const limite48h = Date.now() - 48 * 60 * 60 * 1000;
  Object.keys(mappa).forEach(function(k) { if (mappa[k] < limite48h) delete mappa[k]; });

  mappa[eventId] = Date.now();
  props.setProperty('STRIPE_EVENTI_PROCESSATI', JSON.stringify(mappa));
}

function stripePost_(endpoint, params) {
  const body = Object.entries(params)
    .map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const resp = UrlFetchApp.fetch(`https://api.stripe.com${endpoint}`, {
    method:'post',
    headers:{ 'Authorization':`Bearer ${SECRETS.STRIPE_SECRET_KEY}`, 'Content-Type':'application/x-www-form-urlencoded', 'Stripe-Version':'2023-10-16' },
    payload:body, muteHttpExceptions:true,
  });
  const code = resp.getResponseCode();
  if (code >= 200 && code < 300) return { ok:true, data: JSON.parse(resp.getContentText()) };
  const err = JSON.parse(resp.getContentText());
  return { ok:false, errore: (err.error&&err.error.message)||`HTTP ${code}` };
}

function stripeDelete_(endpoint) {
  const resp = UrlFetchApp.fetch(`https://api.stripe.com${endpoint}`, {
    method:'delete',
    headers:{ 'Authorization':`Bearer ${SECRETS.STRIPE_SECRET_KEY}`, 'Stripe-Version':'2023-10-16' },
    muteHttpExceptions:true,
  });
  const code = resp.getResponseCode();
  if (code >= 200 && code < 300) return { ok:true, data: JSON.parse(resp.getContentText()) };
  const err = JSON.parse(resp.getContentText());
  return { ok:false, errore: (err.error&&err.error.message)||`HTTP ${code}` };
}

function stripeGet_(endpoint) {
  const resp = UrlFetchApp.fetch(`https://api.stripe.com${endpoint}`, {
    method:'get',
    headers:{ 'Authorization':`Bearer ${SECRETS.STRIPE_SECRET_KEY}`, 'Stripe-Version':'2023-10-16' },
    muteHttpExceptions:true,
  });
  if (resp.getResponseCode() === 200) return { ok:true, data: JSON.parse(resp.getContentText()) };
  const err = JSON.parse(resp.getContentText());
  return { ok:false, errore: (err.error&&err.error.message)||`HTTP ${resp.getResponseCode()}` };
}

// ── Trova riga per ID Stripe ──────────────────────────────────────────────────
function trovaRigaPerStripe_(subId, custId) {
  const sheet   = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  const allData = sheet.getDataRange().getValues();
  const I       = CONFIG.IDX;

  // Prima passata: subscription ID — univoco per definizione, sempre preferito.
  if (subId) {
    for (let i = 1; i < allData.length; i++) {
      if (String(allData[i][I.STRIPE_SUB_ID]||'').trim() === subId)
        return { sheet, row: i+1, rowData: allData[i] };
    }
  }
  // Seconda passata: customer ID — fallback per eventi senza subscription (es. one-time).
  // Meno preciso: se un cliente ha più subscription nel foglio, prende la prima riga trovata.
  if (custId) {
    for (let i = 1; i < allData.length; i++) {
      if (String(allData[i][I.STRIPE_CUSTOMER_ID]||'').trim() === custId)
        return { sheet, row: i+1, rowData: allData[i] };
    }
  }
  return { sheet:null, row:null, rowData:null };
}

// ── Trova riga per ID Pratica ──────────────────────────────────────────────────
function trovaRigaPerIdPratica_(idPratica) {
  const sheet   = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  const allData = sheet.getDataRange().getValues();
  const I       = CONFIG.IDX;
  const target  = String(idPratica||'').trim().toUpperCase();

  for (let i = 1; i < allData.length; i++) {
    if (String(allData[i][I.ID_PRATICA]||'').trim().toUpperCase() === target)
      return { sheet, row: i+1, rowData: allData[i] };
  }
  return { sheet:null, row:null, rowData:null };
}

// ── Utility SKU ──────────────────────────────────────────────────────────────
function getSkuDisponibiliM365() {
  const token = getTokenM365_();
  if (!token) { traceLog_('Token M365 non disponibile'); return; }
  const resp = UrlFetchApp.fetch('https://graph.microsoft.com/v1.0/subscribedSkus', {
    headers:{ 'Authorization':`Bearer ${token}` }, muteHttpExceptions:true,
  });
  const skus = JSON.parse(resp.getContentText()).value || [];
  skus.forEach(s => traceLog_(`SKU: ${s.skuPartNumber} | ID: ${s.skuId} | Totale: ${s.prepaidUnits.enabled} | Usate: ${s.consumedUnits}`));
}
