/**
 * MODULO: 19_SupabaseSync.gs
 * ══════════════════════════════════════════════════════════════════════
 * Ponte verso Supabase (Edge Function `workflow-membership-sync`) —
 * l'unico punto di tutto questo progetto che scrive su Supabase.
 *
 * PERCHÉ ESISTE SOLO DA ORA: fino al 16/08/2026 questo progetto era
 * dichiaratamente indipendente da Supabase (vedi CLAUDE.md, "Gli Apps
 * Script non toccano mai Supabase") — la tabella `members` dell'app iOS
 * l'app mobile restava ferma a soci di prova, il "Registro Movimenti" reale
 * (14_IntegrazioneFinanza.gs) viveva solo su questo foglio. Richiesto
 * esplicitamente dall'utente per collegare i due sistemi.
 *
 * REGOLA ASSOLUTA: nessuna chiamata qui dentro deve poter far fallire
 * l'onboarding o il pagamento reale. Ogni funzione pubblica è avvolta in
 * try/catch che non rilancia mai — solo `traceLog_` in caso di errore,
 * stesso principio già in uso per la Chat (`inviaNotificaAmmissione_`) e
 * per la ricevuta finanziaria in questo stesso file gemello
 * (14_IntegrazioneFinanza.gs).
 */

function _supabaseSyncPost_(action, payload) {
  const url = CONFIG.SUPABASE_SYNC_URL;
  const secret = CONFIG.SUPABASE_SYNC_SECRET;
  if (!url || !secret) {
    traceLog_('[SupabaseSync] SKIP ' + action + ': URL/secret non configurati in 0_Secrets.gs.');
    return;
  }
  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-Workflow-Secret': secret },
      payload: JSON.stringify(Object.assign({ action: action }, payload)),
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      traceLog_('[SupabaseSync] ' + action + ' — HTTP ' + code + ': ' + resp.getContentText());
      return;
    }
    traceLog_('[SupabaseSync] ' + action + ' OK.');
  } catch (err) {
    traceLog_('[SupabaseSync] ' + action + ' ERRORE: ' + err.message);
  }
}

/**
 * Identità del socio — chiamata da `eseguiOnboarding_` (2_TriggerAmmissione.gs)
 * sia per un Socio Ordinario (dopo il pagamento) sia per un Volontario
 * (subito, non paga). Non manda mai tags/incarichi: restano di competenza
 * esclusiva della Presidenza nell'app (vedi il commento gemello lato
 * Supabase, `handleUpsertMember`).
 */
function syncMemberIdentity_(rowData, tipo, emailIst) {
  if (!emailIst) return;
  const I = CONFIG.IDX;
  const dati = getDatiAnagrafici_(rowData, tipo);
  _supabaseSyncPost_('upsert_member', {
    email: emailIst,
    firstName: dati.nome,
    lastName: dati.cognome,
    phoneNumber: dati.tel,
    applicationId: rowData[I.ID_PRATICA] || '',
    gruppo: rowData[I.GRUPPO] || '',
  });
}

/**
 * Quota — chiamata da dentro `generaRicevutaQuotaSocio_`
 * (14_IntegrazioneFinanza.gs) per ogni pagamento confermato, primo o
 * rinnovo. `dataPagamento` è un vero `Date`, non una stringa già formattata.
 */
function syncMemberPayment_(rowData, dataPagamento, stripeCustomerId) {
  const I = CONFIG.IDX;
  const emailIst = String(rowData[I.EMAIL_ISTITUZIONALE] || '').trim();
  if (!emailIst) return;
  const paidAtISO = Utilities.formatDate(dataPagamento, 'Europe/Rome', 'yyyy-MM-dd');
  _supabaseSyncPost_('sync_payment', {
    email: emailIst,
    paidAtISODate: paidAtISO,
    stripeCustomerId: stripeCustomerId || '',
  });
}

/**
 * Espulsione — chiamata da `eseguiEspulsione_` (17_PresidenzaAdmin.gs).
 * Solo aggiornamento: se la riga non esiste ancora su Supabase (un membro
 * ammesso prima che questo ponte esistesse, mai passato dal backfill), la
 * function lo segnala con `found:false` senza crearne una — non ha senso
 * far comparire su Supabase una persona già espulsa che non c'era mai stata.
 */
function syncMemberExpelled_(emailIst) {
  if (!emailIst) return;
  _supabaseSyncPost_('mark_expelled', { email: emailIst });
}

/**
 * Riga nel Registro Movimenti reale — chiamata accanto a
 * `_fnAppendRegistro_` (14_IntegrazioneFinanza.gs). `externalRef` rende
 * l'inserimento idempotente: un redelivery dello stesso webhook Stripe non
 * deve duplicare la riga (vedi la colonna `finance_movements.external_ref`,
 * migrazione `finance_movements_external_ref`).
 */
function syncFinanceMovement_(params) {
  _supabaseSyncPost_('record_finance_movement', {
    movementDateISO: params.movementDateISO,
    amountCents: params.amountCents,
    description: params.description,
    counterpart: params.counterpart,
    category: params.category,
    notes: params.notes,
    createdByEmail: params.createdByEmail,
    externalRef: params.externalRef,
  });
}

/**
 * Backfill una tantum — esegui dall'editor Apps Script per portare su
 * Supabase i soci già ammessi PRIMA che questo ponte esistesse (che
 * altrimenti restano invisibili finché non pagano di nuovo o li aggiunge a
 * mano la Presidenza). Itera ogni riga `MEMBRO_UFFICIALE='SI'`: identità
 * sempre, quota solo se `STATO_PAGAMENTO='Regolare'` (con la data storica
 * del foglio, non "oggi" — `DATA_ULTIMO_RINNOVO` se c'è, altrimenti
 * `DATA_AMMISSIONE`: il primo pagamento mai ancora rinnovato), espulsione se
 * `ESPULSO='SI'`.
 *
 * Non crea righe in `finance_movements`: il foglio tiene solo l'ultimo
 * rinnovo, non uno storico pagamento per pagamento — inventare ricevute con
 * dati incompleti inquinerebbe la Banca reale con voci non verificabili.
 *
 * Idempotente e rilanciabile senza rischio: ogni azione lato Supabase è un
 * upsert/update per email, mai un insert nudo.
 *
 * ⚠️ Niente underscore finale di proposito: in Apps Script quella
 * convenzione segna una funzione "privata" e l'editor la nasconde dal menu
 * a tendina di esecuzione in alto — qui va invece eseguita a mano da lì.
 */
function backfillWorkflowSync() {
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  const allData = sheet.getDataRange().getValues();
  const I = CONFIG.IDX;

  let identita = 0, quota = 0, espulsi = 0, saltati = 0;

  for (let i = 1; i < allData.length; i++) {
    const row = allData[i];
    if (row[I.MEMBRO_UFFICIALE] !== 'SI') continue;

    const tipo = row[I.TIPO_ASSOCIATO];
    const emailIst = String(row[I.EMAIL_ISTITUZIONALE] || '').trim();
    if (!emailIst) { saltati++; continue; }

    syncMemberIdentity_(row, tipo, emailIst);
    identita++;

    if (row[I.STATO_PAGAMENTO] === 'Regolare') {
      const dataRaw = row[I.DATA_ULTIMO_RINNOVO] || row[I.DATA_AMMISSIONE];
      const dataPagamento = (dataRaw instanceof Date) ? dataRaw : new Date(dataRaw);
      if (!isNaN(dataPagamento.getTime())) {
        syncMemberPayment_(row, dataPagamento, row[I.STRIPE_CUSTOMER_ID] || '');
        quota++;
      }
    }

    if (String(row[I.ESPULSO] || '').trim()) {
      syncMemberExpelled_(emailIst);
      espulsi++;
    }

    Utilities.sleep(150); // non bombardare Supabase su fogli con molte righe
  }

  traceLog_('[Backfill SupabaseSync] Fatto — identità: ' + identita + ', quota: ' + quota +
    ', espulsi: ' + espulsi + ', saltati (email mancante): ' + saltati);
}

/**
 * Test manuale — esegui dall'editor Apps Script su una riga reale già
 * "Ammesso" per verificare la catena end-to-end (stesso principio di
 * `testRouterModuliManuale`/`testNotificaChat`/`testGeneraTessera`, già
 * in questo progetto — nessuna di quelle ha l'underscore finale, per lo
 * stesso motivo spiegato sopra su `backfillWorkflowSync`). Non scrive nulla
 * di distruttivo: crea/aggiorna una riga `members` e una riga
 * `finance_movements` di prova su Supabase, entrambe riconoscibili e
 * rimovibili a mano dopo il test.
 */
function testWorkflowSync() {
  const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  const allData = sheet.getDataRange().getValues();
  const I = CONFIG.IDX;
  for (let i = 1; i < allData.length; i++) {
    const row = allData[i];
    if (row[I.STATO_DOMANDA] !== 'Ammesso') continue;
    const tipo = row[I.TIPO_ASSOCIATO];
    const emailIst = String(row[I.EMAIL_ISTITUZIONALE] || '').trim();
    if (!emailIst) continue;

    traceLog_('[Test SupabaseSync] Riga ' + (i + 1) + ' — ' + emailIst);
    syncMemberIdentity_(row, tipo, emailIst);
    syncMemberPayment_(row, new Date(), row[I.STRIPE_CUSTOMER_ID] || '');
    syncFinanceMovement_({
      movementDateISO: Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd'),
      amountCents: 100,
      description: '[TEST] Verifica ponte workflow-membership-sync',
      counterpart: emailIst,
      category: 'Test',
      notes: 'Riga di prova — cancellabile a mano da Supabase.',
      createdByEmail: CONFIG.EMAIL_ADMIN_ERRORI,
      externalRef: 'test-workflow-sync-' + Date.now(),
    });
    traceLog_('[Test SupabaseSync] Fatto — controlla i log qui sopra per HTTP/errori.');
    return;
  }
  traceLog_('[Test SupabaseSync] Nessuna riga "Ammesso" con email istituzionale trovata.');
}
