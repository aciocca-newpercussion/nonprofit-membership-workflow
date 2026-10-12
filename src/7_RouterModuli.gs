/**
 * MODULO: 7_RouterModuli.gs
 * ══════════════════════════════════════════════════════════════════════
 * Gestisce nuove righe da Jotform (trigger onChange INSERT_ROW).
 * Invia Mail 1 (Confema invio domanda) e notifica Chat.
 */

function RouterModuli(e) {
  traceLog_('=== ROUTER MODULI START ===');
  traceLog_('Evento: '+JSON.stringify(e));

  if (!e) { traceLog_('STOP: evento null.'); return; }
  if (e.changeType !== 'INSERT_ROW') {
    traceLog_('STOP: changeType="'+e.changeType+'" — atteso INSERT_ROW.');
    return;
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    // Usa openById — getActiveSpreadsheet() non è affidabile nei trigger automatici
    const ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) { traceLog_('ERRORE: foglio "'+CONFIG.SHEET_NAME+'" non trovato.'); return; }

    const righePendenti = trovaRigheRouterPendenti_(sheet);
    if (!righePendenti.length) {
      traceLog_('STOP: nessuna nuova riga pendente da processare.');
      return;
    }

    let processate = 0;
    righePendenti.forEach(row => {
      try {
        processaRigaRouter_(sheet, row);
        processate++;
      } catch(err) {
        traceLog_('ERRORE RouterModuli riga '+row+': '+err.toString());
        try { inviaEmailErroreAmministratore(err); } catch(e2) {}
      }
    });

    traceLog_('=== ROUTER MODULI END OK — righe processate: '+processate+' ===');

  } catch (err) {
    traceLog_('ERRORE FATALE RouterModuli: '+err.toString()+'\n'+(err.stack||''));
    try { inviaEmailErroreAmministratore(err); } catch(e2) {}
  } finally {
    lock.releaseLock();
  }
}

function trovaRigheRouterPendenti_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const I       = CONFIG.IDX;
  const numCols = sheet.getLastColumn();
  const data    = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  const righe   = [];

  // Deduplicazione per Submission ID: se lo stesso Submission ID appare in più righe,
  // tiene solo la prima (riga con indice più basso). Previene il doppio onboarding
  // causato da doppi POST di Jotform.
  const submissionIdVisti = new Set();

  data.forEach((rowData, idx) => {
    const statoDomanda = String(rowData[I.STATO_DOMANDA] || '').trim();
    const statoMail1 = String(rowData[I.MAIL_1_SOCIO] || '').trim().toUpperCase();
    const tipo = String(rowData[I.TIPO_ASSOCIATO] || '').trim();
    const idPratica = String(rowData[I.ID_PRATICA] || '').trim();
    const submissionId = String(rowData[I.SUBMISSION_ID] || '').trim();

    if (!tipo || (!idPratica && !submissionId)) return;
    if (statoDomanda) return;
    if (statoMail1) return;

    // Scarta righe duplicate: stessa submission già vista e pendente
    if (submissionId) {
      if (submissionIdVisti.has(submissionId)) {
        traceLog_('[Router] SKIP duplicato Submission ID "'+submissionId+'" alla riga '+(idx+2)+'. Già in coda la prima occorrenza.');
        // Marca la riga duplicata come "Duplicato" per visibilità nel foglio
        sheet.getRange(idx + 2, I.STATO_DOMANDA + 1).setValue('Duplicato');
        sheet.getRange(idx + 2, I.MAIL_1_SOCIO + 1).setValue('Duplicato');
        return;
      }
      submissionIdVisti.add(submissionId);
    }

    righe.push(idx + 2);
  });

  return righe;
}

function processaRigaRouter_(sheet, row) {
  const I       = CONFIG.IDX;
  const numCols = sheet.getLastColumn();
  const rowData = sheet.getRange(row, 1, 1, numCols).getValues()[0];
  const statoMail1 = String(rowData[I.MAIL_1_SOCIO] || '').trim().toUpperCase();

  if (statoMail1 === 'OK') {
    traceLog_('STOP: Mail 1 già inviata per la riga '+row+'. Nessun duplicato.');
    return;
  }

  // Stato iniziale: impostalo solo la prima volta, non sovrascrivere lavorazioni già avviate.
  if (!String(rowData[I.STATO_DOMANDA] || '').trim()) {
    sheet.getRange(row, I.STATO_DOMANDA+1).setValue('In Corso');
    rowData[I.STATO_DOMANDA] = 'In Corso';
  }

  // Inizializza colonne di tracciamento azioni (AY–BI) solo se ancora vuote.
  const tracking = rowData.slice(I.MAIL_1_SOCIO, I.MAIL_1_SOCIO + 11);
  const trackingVuoto = tracking.every(v => String(v || '').trim() === '');
  if (trackingVuoto) {
    sheet.getRange(row, I.MAIL_1_SOCIO+1, 1, 11).setValues([Array(11).fill('-')]);
  }
  SpreadsheetApp.flush();
  const tipo = rowData[I.TIPO_ASSOCIATO];

  traceLog_('Riga: '+row+' — Tipo: "'+tipo+'"');
  traceLog_('Email Socio: "'+rowData[I.EMAIL_SOCIO]+'" — Email Vol: "'+rowData[I.EMAIL_VOLONTARIO]+'"');
  traceLog_('ID Pratica: "'+rowData[I.ID_PRATICA]+'"');

  // Normalizza CF
  [I.CF_SOCIO, I.CF_VOLONTARIO, I.CF_GENITORE].forEach(idx => {
    if (rowData[idx]) {
      const norm = String(rowData[idx]).trim().toUpperCase();
      rowData[idx] = norm;
      sheet.getRange(row, idx+1).setValue(norm);
    }
  });

  if (tipo === 'Socio Ordinario') {
    try {
      inviaMailConfermaRicezione_('Socio Ordinario', rowData);
      sheet.getRange(row, I.MAIL_1_SOCIO+1).setValue('OK');
    } catch(err) {
      sheet.getRange(row, I.MAIL_1_SOCIO+1).setValue('Errore');
      throw err;
    }
    inviaNotificaNuovaPratica('Socio Ordinario',
      (rowData[I.NOME_SOCIO]||'')+' '+(rowData[I.COGNOME_SOCIO]||''),
      null, rowData[I.ID_PRATICA]);

  } else if (tipo === 'Volontario') {
    const ok = Mail1Volontario(sheet, row, rowData);
    sheet.getRange(row, I.MAIL_1_SOCIO+1).setValue(ok ? 'OK' : 'Errore');

  } else {
    traceLog_('STOP: tipo "'+tipo+'" non riconosciuto.');
    sheet.getRange(row, I.STATO_DOMANDA+1).setValue('Errore Tipo');
    sheet.getRange(row, I.MAIL_1_SOCIO+1).setValue('Errore');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mail 1 — Confema invio domanda
// ─────────────────────────────────────────────────────────────────────────────

function inviaMailConfermaRicezione_(tipo, rowData) {
  const I    = CONFIG.IDX;
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[I.ID_PRATICA]||'N/D';
  const ip   = rowData[I.SUBMISSION_IP]||'N/D';
  const dataStr = formatData_(rowData[I.DATA_INVIO]);
  const oraStr  = formatOra_(rowData[I.ORA_INVIO]);

  traceLog_('[Mail1] Destinatario: "'+dati.email+'" — Nome: "'+dati.nome+' '+dati.cognome+'"');

  if (!dati.email || String(dati.email).trim() === '') {
    traceLog_('[Mail1] SKIP: email vuota per tipo "'+tipo+'".');
    return;
  }

  const contenuto = `
    <div class="greeting">Ciao ${dati.nome} ${dati.cognome},</div>
    <div class="text">Abbiamo ricevuto la tua domanda di adesione all'<strong>${CONFIG.NOME_LEGALE}</strong>
      come <strong>${tipo}</strong>. La Presidenza la esaminerà e ti contatterà presto.</div>
    <div class="highlight-box">
      <div class="highlight-title">Il tuo ID Pratica</div>
      <div class="highlight-value">${idP}</div>
    </div>
    <div class="card">
      <div class="card-title">Riepilogo richiesta</div>
      ${_riga('Nome e Cognome', dati.nome+' '+dati.cognome)}
      ${_riga('Tipo', tipo)}
      ${_riga('Data invio', dataStr)}
      ${_riga('Ora invio', oraStr)}
      ${_riga('IP richiesta', '<code>'+ip+'</code>')}
    </div>
    ${DISCLAIMER_SICUREZZA}`;

  inviaEmail_(dati.email, 'Domanda di ammissione ricevuta — '+CONFIG.NOME_GRUPPO,
    _htmlWrapper('Confema invio domanda', contenuto));
}

// ─────────────────────────────────────────────────────────────────────────────
// Mail 1 Volontario
// ─────────────────────────────────────────────────────────────────────────────

function Mail1Volontario(sheet, row, rowData) {
  const I       = CONFIG.IDX;
  const cfG     = String(rowData[I.CF_GENITORE]||'').trim().toUpperCase();
  const idPG    = String(rowData[I.ID_PRATICA_GENITORE]||'').trim().toUpperCase();
  const nomeVol = (rowData[I.NOME_VOLONTARIO]||'') + ' ' + (rowData[I.COGNOME_VOLONTARIO]||'');

  traceLog_('[Mail1Vol] CF Genitore: "'+cfG+'" — ID Pratica Genitore: "'+idPG+'"');

  const genitore = cercaGenitore_(sheet, cfG, idPG);
  traceLog_('[Mail1Vol] Trovato: '+genitore.trovato+' — Stato: "'+(genitore.statoDomanda||'N/A')+'"');

  if (!genitore.trovato) {
    sheet.getRange(row, I.STATO_DOMANDA+1).setValue('Errore');
    inviaEmailErroreVolontario_(rowData, 'GENITORE_NON_TROVATO', null);
    return false;
  }
  // Con il flusso a due fasi (approvazione poi pagamento) essere "Ammesso" non
  // basta più: il genitore deve avere anche la quota Socio Ordinario in regola.
  if (!genitoreInRegola_(genitore)) {
    sheet.getRange(row, I.STATO_DOMANDA+1).setValue('Errore');
    inviaEmailErroreVolontario_(rowData, 'GENITORE_NON_APPROVATO', genitore);
    return false;
  }

  // Conferma volontario
  inviaMailConfermaRicezione_('Volontario', rowData);

  // Notifica al genitore
  const emailG = genitore.emailIstituzionale || genitore.emailPersonale;
  if (emailG) {
    const idPVol  = rowData[I.ID_PRATICA]||'N/D';
    const contenuto = `
      <div class="greeting">Gentile ${genitore.nome} ${genitore.cognome},</div>
      <div class="text">Abbiamo ricevuto la domanda di adesione come <strong>Volontario</strong>
        per il minorenne da te autorizzato: <strong>${nomeVol}</strong>.</div>
      <div class="highlight-box">
        <div class="highlight-title">ID Pratica Volontario</div>
        <div class="highlight-value">${idPVol}</div>
      </div>
      <div class="info-note">La domanda sarà esaminata dalla Presidenza.
        Riceverai comunicazione dell'esito.</div>
      ${DISCLAIMER_SICUREZZA}`;
    inviaEmail_(emailG, 'Richiesta Volontario ricevuta — '+CONFIG.NOME_GRUPPO,
      _htmlWrapper('Richiesta Volontario', contenuto));
    traceLog_('[Mail1Vol] Email genitore inviata a: '+emailG);
  }

  inviaNotificaNuovaPratica('Volontario', nomeVol.trim(),
    (genitore.nome||'')+' '+(genitore.cognome||''), rowData[I.ID_PRATICA]);

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

function cercaGenitore_(sheet, cfGenitore, idPraticaGenitore) {
  const all = sheet.getDataRange().getValues();
  const I   = CONFIG.IDX;
  for (let i=1;i<all.length;i++) {
    const r = all[i];
    if (r[I.TIPO_ASSOCIATO] !== 'Socio Ordinario') continue;
    if (String(r[I.CF_SOCIO]||'').trim().toUpperCase()===cfGenitore &&
        String(r[I.ID_PRATICA]||'').trim().toUpperCase()===idPraticaGenitore)
      return { trovato:true, riga:i+1,
        nome:r[I.NOME_SOCIO], cognome:r[I.COGNOME_SOCIO],
        emailPersonale:r[I.EMAIL_SOCIO], emailIstituzionale:r[I.EMAIL_ISTITUZIONALE],
        statoDomanda:r[I.STATO_DOMANDA], statoPagamento:r[I.STATO_PAGAMENTO] };
  }
  return { trovato:false };
}

/**
 * Un genitore è "in regola" solo se ammesso E con la quota Socio Ordinario
 * pagata — con il flusso a due fasi (approvazione poi pagamento) essere
 * "Ammesso" non basta più: potrebbe non aver ancora completato la Fase 2.
 */
function genitoreInRegola_(genitore) {
  return !!genitore.trovato && genitore.statoDomanda === 'Ammesso' && genitore.statoPagamento === 'Regolare';
}

function sbloccaVolontariInSospeso(sheet, cfGenitore, idPraticaGenitore, datiGenitoreRow) {
  const all = sheet.getDataRange().getValues();
  const I   = CONFIG.IDX;
  const gen = {
    nome: datiGenitoreRow[I.NOME_SOCIO], cognome: datiGenitoreRow[I.COGNOME_SOCIO],
    emailPersonale: datiGenitoreRow[I.EMAIL_SOCIO],
    emailIstituzionale: datiGenitoreRow[I.EMAIL_ISTITUZIONALE],
  };
  for (let i=1;i<all.length;i++) {
    const r = all[i];
    if (r[I.TIPO_ASSOCIATO]!=='Volontario') continue;
    if (r[I.STATO_DOMANDA]!=='Errore') continue;
    if (String(r[I.CF_GENITORE]||'').trim().toUpperCase()!==cfGenitore) continue;
    if (String(r[I.ID_PRATICA_GENITORE]||'').trim().toUpperCase()!==idPraticaGenitore) continue;
    sheet.getRange(i+1, I.STATO_DOMANDA+1).setValue('In Corso');
    inviaMailConfermaRicezione_('Volontario', r);
    sheet.getRange(i+1, I.MAIL_1_SOCIO+1).setValue('OK');
    inviaNotificaNuovaPratica('Volontario',
      (r[I.NOME_VOLONTARIO]||'')+' '+(r[I.COGNOME_VOLONTARIO]||''),
      (gen.nome||'')+' '+(gen.cognome||''), r[I.ID_PRATICA]);
    traceLog_('[Sblocco] Volontario '+r[I.NOME_VOLONTARIO]+' sbloccato');
  }
}

/** Test: simula un INSERT_ROW sull'ultima riga — esegui dall'editor */
function testRouterModuliManuale() {
  traceLog_('=== TEST ROUTER MANUALE ===');
  RouterModuli({ changeType: 'INSERT_ROW' });
}
