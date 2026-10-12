/**
 * MODULO: 2_TriggerAmmissione.gs
 * ══════════════════════════════════════════════════════════════════════
 * Trigger onEdit — intercetta colonna AK (Stato domanda).
 *
 * Flusso "Ammesso":
 *   → salva job nelle ScriptProperties
 *   → crea trigger TimeBased a +5 minuti (l'admin compila AL/AM/AO — AP viene impostata dallo script)
 *   → dopo 5 min: eseguiOnboardingDifferito() rilegge stato attuale ed esegue
 *
 * Flusso "Rifiutato":
 *   → salva job nelle ScriptProperties
 *   → crea trigger TimeBased a +5 minuti (l'admin compila AN — obbligatorio)
 *   → dopo 5 min: eseguiRifiutoDifferito() verifica AN non vuota, poi esegue
 *
 * TriggerStorico:
 *   → onEdit separato che monitora le colonne gestionali e logga nel foglio Storico
 */

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER PRINCIPALE — Ammissione / Rifiuto
// ─────────────────────────────────────────────────────────────────────────────

function logWorkflow_(msg) {
  try { console.log(msg); } catch(e) {}
  traceLog_(msg);
}

function TriggerAmmissione(e) {
  if (!e || !e.range) {
    logWorkflow_('[Ammissione] SKIP: evento senza range.');
    return;
  }

  const sheet = e.range.getSheet();
  const col = e.range.getColumn();
  const rawVal = (e.value !== undefined && e.value !== null) ? e.value : e.range.getValue();
  const val = String(rawVal || '').trim();
  const row = e.range.getRow();

  if (sheet.getName() !== CONFIG.SHEET_NAME) {
    logWorkflow_('[Ammissione] SKIP: foglio non gestito "'+sheet.getName()+'".');
    return;
  }
  if (row <= 1) {
    logWorkflow_('[Ammissione] SKIP: intestazione o riga non valida ('+row+').');
    return;
  }
  if (col !== CONFIG.IDX.STATO_DOMANDA + 1) {
    logWorkflow_('[Ammissione] SKIP: colonna '+col+' modificata, attesa AK/'+(CONFIG.IDX.STATO_DOMANDA + 1)+'.');
    return;
  }
  if (val !== 'Ammesso' && val !== 'Rifiutato') {
    logWorkflow_('[Ammissione] SKIP: valore AK non gestito "'+val+'".');
    return;
  }

  logWorkflow_('[Ammissione] START riga '+row+' — valore AK: "'+val+'".');

  const numCols = sheet.getLastColumn();
  const rowData = sheet.getRange(row, 1, 1, numCols).getValues()[0];

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);

    if (val === 'Ammesso') {
      const tipo = rowData[CONFIG.IDX.TIPO_ASSOCIATO];
      const colRispIdx = tipo === 'Socio Ordinario'
        ? CONFIG.IDX.MAIL_RISPOSTA_SOCIO
        : CONFIG.IDX.MAIL_RISPOSTA_VOLONTARIO;
      if (rowData[CONFIG.IDX.MEMBRO_UFFICIALE] === 'SI') {
        logWorkflow_('[Ammissione] Riga '+row+' già membro ufficiale. Onboarding non ripetuto.');
        return;
      }
      if (String(rowData[colRispIdx] || '').trim().toUpperCase() === 'OK') {
        logWorkflow_('[Ammissione] Riga '+row+' già notificata. Onboarding non ripetuto.');
        return;
      }
      // Delay di 5 min: l'admin ha tempo di compilare AL/AM/AO prima che parta l'onboarding.
      // La verifica delle precondizioni avviene in eseguiOnboardingDifferito con i dati aggiornati.
      pianificaOnboarding_(row);

    } else {
      const tipo = rowData[CONFIG.IDX.TIPO_ASSOCIATO];
      const colRispIdx = tipo === 'Socio Ordinario'
        ? CONFIG.IDX.MAIL_RISPOSTA_SOCIO
        : CONFIG.IDX.MAIL_RISPOSTA_VOLONTARIO;
      if (String(rowData[colRispIdx] || '').trim().toUpperCase() === 'OK') {
        logWorkflow_('[Rifiuto] Riga '+row+' già notificata. Rifiuto non ripetuto.');
        return;
      }
      // Delay di 5 min: l'admin ha tempo di compilare AN (motivo — obbligatorio) prima che parta la email.
      pianificaRifiuto_(row);
    }

  } catch (err) {
    logWorkflow_('ERRORE TriggerAmmissione: '+err.toString());
    inviaEmailErroreAmministratore(err);
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER STORICO — logga modifiche alle colonne gestionali
// ─────────────────────────────────────────────────────────────────────────────

function TriggerStorico(e) {
  if (!e || !e.range) return;
  const col = e.range.getColumn();
  if (!COLS_STORICO_1BASED.includes(col)) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;
  const row = e.range.getRow();
  if (row <= 1) return;

  // Leggi ID Pratica e nome membro dalla riga
  const rowData = sheet.getRange(row, 1, 1, Math.min(sheet.getLastColumn(), CONFIG.IDX.RUOLO_ASSOCIATIVO + 1)).getValues()[0];
  const I = CONFIG.IDX;
  const idP   = rowData[I.ID_PRATICA] || 'N/D';
  const tipo  = rowData[I.TIPO_ASSOCIATO] || '';
  const nome  = tipo === 'Socio Ordinario'
    ? (rowData[I.NOME_SOCIO]||'') + ' ' + (rowData[I.COGNOME_SOCIO]||'')
    : (rowData[I.NOME_VOLONTARIO]||'') + ' ' + (rowData[I.COGNOME_VOLONTARIO]||'');

  // Nome colonna leggibile
  const nomeColonne = {
    36:'Email istituzionale (AJ)', 37:'Stato domanda (AK)', 38:'Data ammissione (AL)', 39:'Gruppo (AM)',
    40:'Rifiutato perché (AN)', 41:'Stato pagamento (AO)', 42:'Membro ufficiale (AP)',
    43:'Espulso (AQ)', 44:'Espulso perché (AR)', 50:'Ruolo associativo (AX)',
    64:'Liberatoria sito web (BL)', 65:'Liberatoria social (BM)',
    66:'Liberatoria materiale stampato (BN)', 67:'Liberatoria video (BO)',
    70:'Delibera / ratifica (BR)', 71:'Causa cessazione (BS)',
    72:'Data cessazione (BT)', 73:'Espulsione proposta il (BU)',
    74:'Riferimento cessazione (BV)',
    75:'Liberatoria audio (BW)', 76:'Liberatoria streaming (BX)',
    77:'Liberatoria esecuzione musicale (BY)', 78:'Liberatoria stato (BZ)',
  };
  const nomeCol = nomeColonne[col] || 'Colonna '+col;

  try {
    logModifica_(row, nomeCol, e.oldValue, e.value, idP, nome.trim());
  } catch(err) {
    traceLog_('[Storico] WARN: '+err.message);
  }
}

function jobDifferitoMaturo_(job, defaultDelayMs) {
  const dueMs = Number(job && job.eseguiDopoMs);
  if (dueMs) return Date.now() >= dueMs;

  const pianificatoIl = Number(job && job.pianificatoIl);
  if (!pianificatoIl) return true;
  return Date.now() >= pianificatoIl + defaultDelayMs;
}

function eliminaTriggerSeNessunJob_(handlerFunction, prefissi) {
  const props = PropertiesService.getScriptProperties().getProperties();
  const pendenti = Object.keys(props).filter(function(k) {
    return prefissi.some(function(p) { return k.startsWith(p); });
  }).length;

  if (pendenti > 0) {
    traceLog_('[Delay] ' + handlerFunction + ': ' + pendenti + ' job ancora pendenti. Trigger mantenuti.');
    return;
  }

  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === handlerFunction; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });
}

// ─────────────────────────────────────────────────────────────────────────────
// DELAY 5 MINUTI — pianifica l'onboarding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Salva un job pendente e crea un trigger TimeBased a +5 minuti.
 * Se un job pendente per questa riga esiste già (es. l'admin ha impostato
 * "Ammesso" e poi modificato subito il gruppo), non crea un secondo trigger:
 * il trigger già esistente leggerà lo stato aggiornato quando scatta.
 */
function pianificaOnboarding_(row) {
  const chiave = 'PENDING_AMM_' + row;
  const props  = PropertiesService.getScriptProperties();

  if (props.getProperty(chiave)) {
    traceLog_('[Delay] Job già pianificato per riga '+row+'. Nessun duplicato.');
    return;
  }

  const eseguiAl = new Date(Date.now() + 5 * 60 * 1000); // +5 minuti
  props.setProperty(chiave, JSON.stringify({
    row: row,
    pianificatoIl: Date.now(),
    eseguiDopoMs: eseguiAl.getTime(),
  }));
  ScriptApp.newTrigger('eseguiOnboardingDifferito').timeBased().at(eseguiAl).create();
  traceLog_('[Delay] Onboarding pianificato tra 5 min per riga '+row+' (alle '+eseguiAl.toLocaleTimeString('it-IT')+')');
}

/**
 * Eseguito dal trigger TimeBased dopo 5 minuti.
 * Processa TUTTI i job pendenti trovati (evita trigger orfani).
 */
function eseguiOnboardingDifferito() {
  traceLog_('=== eseguiOnboardingDifferito START ===');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
  const props    = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  const ss       = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet    = ss.getSheetByName(CONFIG.SHEET_NAME);

  let processati = 0;

  for (const [chiave, valoreJson] of Object.entries(allProps)) {
    if (!chiave.startsWith('PENDING_AMM_')) continue;

    let job;
    try { job = JSON.parse(valoreJson); } catch(e) { props.deleteProperty(chiave); continue; }

    traceLog_('[Delay] Processo job riga: '+job.row);
    if (!jobDifferitoMaturo_(job, 5 * 60 * 1000)) {
      traceLog_('[Delay] Riga '+job.row+' non ancora matura. Rimane in coda.');
      continue;
    }

    try {
      const numCols = sheet.getLastColumn();
      const rowData = sheet.getRange(job.row, 1, 1, numCols).getValues()[0];

      // Ri-verifica stato AI: se non è più "Ammesso" (es. tornato "In Corso"), annulla
      const statoAttuale = String(rowData[CONFIG.IDX.STATO_DOMANDA]||'').trim();
      if (statoAttuale !== 'Ammesso') {
        traceLog_('[Delay] Riga '+job.row+' non più in stato Ammesso (attuale: "'+statoAttuale+'") — processo annullato.');
        props.deleteProperty(chiave);
        continue;
      }

      if (rowData[CONFIG.IDX.MEMBRO_UFFICIALE] === 'SI') {
        traceLog_('[Delay] Riga '+job.row+' già membro ufficiale. Onboarding skip.');
        props.deleteProperty(chiave);
        continue;
      }

      const tipo = rowData[CONFIG.IDX.TIPO_ASSOCIATO];
      const colRispIdx = tipo === 'Socio Ordinario'
        ? CONFIG.IDX.MAIL_RISPOSTA_SOCIO
        : CONFIG.IDX.MAIL_RISPOSTA_VOLONTARIO;
      if (String(rowData[colRispIdx] || '').trim().toUpperCase() === 'OK') {
        traceLog_('[Delay] Riga '+job.row+' già notificata. Onboarding skip.');
        props.deleteProperty(chiave);
        continue;
      }

      // Ri-verifica precondizioni con i dati attuali (l'admin potrebbe aver corretto)
      const check = verificaPrecondizioni_(rowData, sheet);
      if (!check.ok) {
        if (check.inAttesaLiberatoria) {
          // Atteso, non un errore: la richiesta è appena stata ammessa e la
          // liberatoria non è ancora stata firmata. Si chiede, con i guard che
          // evitano di ripetere l'email a ogni passaggio del job.
          libRichiediLiberatoria_(sheet, job.row, rowData, 'ammissione');
          traceLog_('[Delay] Riga '+job.row+' in attesa della liberatoria: '+check.motivo);
        } else if (check.inAttesaPagamento) {
          // Atteso col flusso a due fasi: la Presidenza approva PRIMA del pagamento.
          // Non è un errore — si invita l'interessato a completare la Fase 2, una sola volta.
          const giaInvitato = String(rowData[CONFIG.IDX.MAIL_INVITO_PAGAMENTO]||'').trim().toUpperCase() === 'OK';
          if (!giaInvitato) {
            try {
              inviaEmailInvitoPagamento_(rowData, rowData[CONFIG.IDX.ID_PRATICA]||'N/D');
              sheet.getRange(job.row, CONFIG.IDX.MAIL_INVITO_PAGAMENTO+1).setValue('OK');
              traceLog_('[Delay] Riga '+job.row+': invito al pagamento inviato.');
            } catch(err) {
              sheet.getRange(job.row, CONFIG.IDX.MAIL_INVITO_PAGAMENTO+1).setValue('Errore');
              traceLog_('[Delay] ERRORE invio invito pagamento riga '+job.row+': '+err.toString());
              inviaEmailErroreAmministratore(err);
            }
          } else {
            traceLog_('[Delay] Riga '+job.row+': invito al pagamento già inviato in precedenza.');
          }
        } else if (check.inAttesaGenitore) {
          // Atteso: il genitore non ha ancora completato l'iscrizione (approvazione + pagamento).
          // Verrà sbloccato automaticamente quando il genitore paga — vedi eseguiOnboarding_.
          traceLog_('[Delay] Riga '+job.row+' (Volontario) in attesa che il genitore completi l\'iscrizione: '+check.motivo);
        } else {
          traceLog_('[Delay] Precondizioni ancora KO per riga '+job.row+': '+check.motivo);
          inviaEmailErroreAmministratore(new Error('Onboarding differito fallito riga '+job.row+': '+check.motivo));
        }
        props.deleteProperty(chiave);
        continue;
      }

      eseguiOnboarding_(sheet, job.row, rowData);
      processati++;
    } catch(err) {
      traceLog_('[Delay] ERRORE job '+job.row+': '+err.toString());
      inviaEmailErroreAmministratore(err);
    } finally {
      props.deleteProperty(chiave);
    }
  }

  // Autoelimina i trigger solo quando non ci sono altri job futuri.
  eliminaTriggerSeNessunJob_('eseguiOnboardingDifferito', ['PENDING_AMM_']);

  traceLog_('=== eseguiOnboardingDifferito END — processati: '+processati+' ===');
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELAY 5 MINUTI — pianifica il rifiuto
// ─────────────────────────────────────────────────────────────────────────────

function pianificaRifiuto_(row) {
  const chiave = 'PENDING_RIF_' + row;
  const props  = PropertiesService.getScriptProperties();

  if (props.getProperty(chiave)) {
    traceLog_('[Delay] Rifiuto già pianificato per riga '+row+'. Nessun duplicato.');
    return;
  }

  const eseguiAl = new Date(Date.now() + 5 * 60 * 1000); // +5 minuti
  props.setProperty(chiave, JSON.stringify({
    row: row,
    pianificatoIl: Date.now(),
    eseguiDopoMs: eseguiAl.getTime(),
  }));
  ScriptApp.newTrigger('eseguiRifiutoDifferito').timeBased().at(eseguiAl).create();
  traceLog_('[Delay] Rifiuto pianificato tra 5 min per riga '+row+' (alle '+eseguiAl.toLocaleTimeString('it-IT')+')');
}

/**
 * Eseguito dal trigger TimeBased dopo 5 minuti.
 * Processa TUTTI i job di rifiuto pendenti trovati.
 */
function eseguiRifiutoDifferito() {
  traceLog_('=== eseguiRifiutoDifferito START ===');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
  const props    = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  const ss       = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet    = ss.getSheetByName(CONFIG.SHEET_NAME);

  let processati = 0;

  for (const [chiave, valoreJson] of Object.entries(allProps)) {
    if (!chiave.startsWith('PENDING_RIF_')) continue;

    let job;
    try { job = JSON.parse(valoreJson); } catch(e) { props.deleteProperty(chiave); continue; }

    traceLog_('[Delay] Processo rifiuto riga: '+job.row);
    if (!jobDifferitoMaturo_(job, 5 * 60 * 1000)) {
      traceLog_('[Delay] Rifiuto riga '+job.row+' non ancora maturo. Rimane in coda.');
      continue;
    }

    try {
      const numCols = sheet.getLastColumn();
      const rowData = sheet.getRange(job.row, 1, 1, numCols).getValues()[0];

      // Verifica che la riga sia ancora in stato "Rifiutato" (l'admin potrebbe aver cambiato idea)
      if (String(rowData[CONFIG.IDX.STATO_DOMANDA]||'').trim() !== 'Rifiutato') {
        traceLog_('[Delay] Riga '+job.row+' non più in stato Rifiutato — skip.');
        props.deleteProperty(chiave);
        continue;
      }

      // AN (RIFIUTATO_PERCHE) è obbligatoria per il rifiuto
      const motivoRifiuto = String(rowData[CONFIG.IDX.RIFIUTATO_PERCHE]||'').trim();
      if (!motivoRifiuto) {
        traceLog_('[Delay] Riga '+job.row+' — AN (motivo rifiuto) vuota. Invio errore all\'admin.');
        inviaEmailErroreAmministratore(new Error(
          'Rifiuto differito fallito (riga '+job.row+'): la colonna AN "Rifiutato perché" è vuota.\n' +
          'Compilare AN e reimpostare AK su "Rifiutato" per inviare la notifica.'
        ));
        props.deleteProperty(chiave);
        continue;
      }

      const tipo = rowData[CONFIG.IDX.TIPO_ASSOCIATO];
      const colRispIdx = tipo === 'Socio Ordinario'
        ? CONFIG.IDX.MAIL_RISPOSTA_SOCIO
        : CONFIG.IDX.MAIL_RISPOSTA_VOLONTARIO;
      if (String(rowData[colRispIdx] || '').trim().toUpperCase() === 'OK') {
        traceLog_('[Delay] Riga '+job.row+' già notificata per rifiuto. Skip.');
        props.deleteProperty(chiave);
        continue;
      }

      eseguiRifiuto_(sheet, job.row, rowData);
      processati++;
    } catch(err) {
      traceLog_('[Delay] ERRORE rifiuto riga '+job.row+': '+err.toString());
      inviaEmailErroreAmministratore(err);
    } finally {
      props.deleteProperty(chiave);
    }
  }

  // Autoelimina i trigger solo quando non ci sono altri job futuri.
  eliminaTriggerSeNessunJob_('eseguiRifiutoDifferito', ['PENDING_RIF_']);

  traceLog_('=== eseguiRifiutoDifferito END — processati: '+processati+' ===');
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING COMPLETO
// ─────────────────────────────────────────────────────────────────────────────

function eseguiOnboarding_(sheet, row, rowData) {
  const I    = CONFIG.IDX;
  const tipo = rowData[I.TIPO_ASSOCIATO];
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[I.ID_PRATICA] || 'N/D';
  const gruppo   = rowData[I.GRUPPO];
  const dataAmm  = rowData[I.DATA_AMMISSIONE];
  const dataAmmObj = (dataAmm instanceof Date) ? dataAmm : new Date(dataAmm);

  traceLog_('=== ONBOARDING: '+dati.nome+' '+dati.cognome+' ('+tipo+', '+gruppo+') ===');

  if (rowData[I.MEMBRO_UFFICIALE] === 'SI') {
    traceLog_('[Onboarding] Riga '+row+' già completata. Nessuna azione ripetuta.');
    // Sanity-check: se le colonne di tracciamento creazione utenti sono ancora '-' o vuote,
    // le aggiorniamo a 'OK' per mantenere coerenza dello stato nel foglio.
    const gsVal  = String(rowData[I.CREAZIONE_UTENTE_GOOGLE] || '').trim();
    const m365Val = String(rowData[I.CREAZIONE_UTENTE_M365] || '').trim();
    if (!gsVal || gsVal === '-')   sheet.getRange(row, I.CREAZIONE_UTENTE_GOOGLE+1).setValue('OK (già esistente)');
    if (!m365Val || m365Val === '-') sheet.getRange(row, I.CREAZIONE_UTENTE_M365+1).setValue('OK (già esistente)');
    SpreadsheetApp.flush();
    return;
  }
  const colRisp = tipo === 'Socio Ordinario' ? I.MAIL_RISPOSTA_SOCIO : I.MAIL_RISPOSTA_VOLONTARIO;
  if (String(rowData[colRisp] || '').trim().toUpperCase() === 'OK') {
    traceLog_('[Onboarding] Riga '+row+' già notificata. Nessuna azione ripetuta.');
    return;
  }

  // 1. Email istituzionale
  let emailIst = String(rowData[I.EMAIL_ISTITUZIONALE]||'').trim();
  if (!emailIst) {
    emailIst = generaEmailIstituzionale_(rowData, tipo, gruppo);
    emailIst = rendiEmailUnica_(sheet, emailIst, row);
    sheet.getRange(row, I.EMAIL_ISTITUZIONALE+1).setValue(emailIst);
    SpreadsheetApp.flush();
    traceLog_('[Onboarding] Email istituzionale generata: '+emailIst);
  }

  // 2. Data scadenza quota
  const dataScadenza = aggiungi365Giorni_(dataAmmObj);
  sheet.getRange(row, I.DATA_SCADENZA_QUOTA+1).setValue(dataScadenza);
  SpreadsheetApp.flush();

  // 3. Password temporanea
  const pwd = generaPasswordCasuale_();

  // 4. Google Workspace
  let wsOk = false;
  let wsPasswordDisponibile = false;
  let wsEsito = null;
  try {
    const ws = creaUtenteWorkspace_(emailIst, dati.nome, dati.cognome, pwd, gruppo, dati.tel, tipo);
    wsEsito = ws;
    wsOk = !!(ws && ws.ok);
    wsPasswordDisponibile = !!(ws && ws.passwordTemporanea);
  }
  catch(err) {
    wsEsito = { ok:false, warning:err.message };
    traceLog_('WARN Workspace: '+err.message);
  }
  try { inviaEmailResocontoWorkspace_(rowData, row, emailIst, gruppo, wsEsito); }
  catch(err) { traceLog_('WARN resoconto Workspace: '+err.message); }

  // 5. Microsoft 365
  let m365Ok = false;
  let m365Esito = null;
  try {
    m365Esito = creaUtenteM365Dettaglio_(dati.nome, dati.cognome, emailIst, pwd);
    m365Ok = !!(m365Esito && m365Esito.ok);
  }
  catch(err) {
    m365Esito = { ok:false, fase:'EXCEPTION', codice:'EXCEPTION', dettaglio:err.message };
    traceLog_('WARN M365: '+err.message);
  }

  sheet.getRange(row, I.CREAZIONE_UTENTE_GOOGLE+1).setValue(wsOk ? 'OK' : 'Errore');
  sheet.getRange(row, I.CREAZIONE_UTENTE_M365+1).setValue(formatEsitoM365Foglio_(m365Esito));
  SpreadsheetApp.flush();

  // 6. Tessera PDF — viene rigenerata in eseguiEmailBenvenutoRitardata (+30 min)
  //    quando l'account GWS è già propagato; questa è solo una verifica anticipata.
  try { generaTesseraPDF_(rowData, tipo, dataAmmObj); }
  catch(err) { traceLog_('WARN Tessera precheck: '+err.message); }

  // 7. Membro ufficiale = SI
  sheet.getRange(row, I.MEMBRO_UFFICIALE+1).setValue('SI');
  SpreadsheetApp.flush();

  // 8. Email benvenuto + firma → pianificate a +15 min dalla verifica
  pianificaEmailBenvenuto_(row, tipo, emailIst, pwd, dataAmmObj, dataScadenza, wsOk, m365Ok, wsPasswordDisponibile);

  // 9. Email genitore (Volontario) — pianificata a +15 min
  if (tipo === 'Volontario') {
    pianificaEmailGenitore_(row, emailIst, pwd, dataAmmObj, dataScadenza, wsOk, m365Ok, wsPasswordDisponibile);
  }

  // 11. Sblocca volontari in sospeso
  if (tipo === 'Socio Ordinario') {
    const cfS = String(rowData[I.CF_SOCIO]||'').trim().toUpperCase();
    if (cfS && idP !== 'N/D') {
      const idPU = String(idP).trim().toUpperCase();
      // (a) Volontari respinti in Mail1 perché il genitore non era ancora "in regola"
      sbloccaVolontariInSospeso(sheet, cfS, idPU, rowData);
      // (b) Volontari già "Ammesso" dalla Presidenza ma la cui onboarding era in attesa
      //     proprio di questo pagamento del genitore (flusso a due fasi)
      attivaVolontariAmmessiInAttesaGenitore_(sheet, cfS, idPU);
    }
  }

  // 12. Notifica Chat
  try { inviaNotificaAmmissione_(rowData, tipo, emailIst, wsOk, m365Ok); }
  catch(err) { traceLog_('WARN Chat: '+err.message); }

  // 12b. Ponte Supabase (19_SupabaseSync.gs) — mai bloccante, vedi il file.
  //      Copre sia Socio Ordinario (qui dopo il pagamento) sia Volontario
  //      (qui subito, non paga).
  syncMemberIdentity_(rowData, tipo, emailIst);

  // 13. Storico
  try { logModifica_(row, 'Stato domanda (AK)', 'In Corso', 'Ammesso',
    rowData[I.ID_PRATICA]||'N/D', dati.nome+' '+dati.cognome); } catch(e){}

  traceLog_('=== ONBOARDING COMPLETATO: '+emailIst+' ===');
}

/**
 * Chiamata quando un Socio Ordinario completa l'onboarding (cioè ha pagato).
 * Cerca Volontari già "Ammesso" dalla Presidenza ma non ancora ufficiali,
 * collegati a questo genitore (stesso CF + ID Pratica), la cui onboarding era
 * in attesa proprio di questo pagamento — e la avvia per ciascuno di loro.
 * Complementare a sbloccaVolontariInSospeso (che gestisce i Volontari respinti
 * in Mail1, prima ancora della valutazione della Presidenza).
 */
function attivaVolontariAmmessiInAttesaGenitore_(sheet, cfGenitore, idPraticaGenitore) {
  const I = CONFIG.IDX;
  const allData = sheet.getDataRange().getValues();
  let attivati = 0;

  for (let i = 1; i < allData.length; i++) {
    const r = allData[i];
    if (r[I.TIPO_ASSOCIATO] !== 'Volontario') continue;
    if (r[I.STATO_DOMANDA] !== 'Ammesso') continue;
    if (r[I.MEMBRO_UFFICIALE] === 'SI') continue;
    if (String(r[I.CF_GENITORE]||'').trim().toUpperCase() !== cfGenitore) continue;
    if (String(r[I.ID_PRATICA_GENITORE]||'').trim().toUpperCase() !== idPraticaGenitore) continue;

    const row = i + 1;
    try {
      const check = verificaPrecondizioni_(r, sheet);
      if (!check.ok) {
        traceLog_('[Sblocco Volontario] Riga '+row+' ancora non pronta: '+check.motivo);
        continue;
      }
      eseguiOnboarding_(sheet, row, r);
      attivati++;
    } catch(err) {
      traceLog_('[Sblocco Volontario] ERRORE riga '+row+': '+err.toString());
      inviaEmailErroreAmministratore(err);
    }
  }
  if (attivati > 0) traceLog_('[Sblocco Volontario] Avviati '+attivati+' onboarding in attesa del genitore '+cfGenitore);
}

function formatEsitoM365Foglio_(esito) {
  if (!esito) return 'Errore M365: esito assente';
  if (esito.ok && esito.warning) return 'OK (' + esito.warning.substring(0, 80) + ')';
  if (esito.ok) return 'OK';
  if (esito.esistente) return 'Già esistente: reset manuale password';
  const codice = esito.codice || esito.fase || 'ERRORE';
  const dettaglio = String(esito.dettaglio || '').replace(/\s+/g, ' ').trim();
  return ('Errore M365 ' + codice + (dettaglio ? ': ' + dettaglio : '')).substring(0, 250);
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL BENVENUTO + FIRMA RITARDATE — +15 MINUTI DALLA VERIFICA
// ─────────────────────────────────────────────────────────────────────────────

function pianificaEmailBenvenuto_(row, tipo, emailIst, pwd, dataAmmObj, dataScadenza, wsOk, m365Ok, wsPasswordDisponibile) {
  const chiave = 'EMAIL_BV_' + row;
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(chiave)) {
    traceLog_('[BV+15min] Job già pianificato per riga '+row+'. Nessun duplicato.');
    return;
  }
  const t = new Date(Date.now() + 15*60*1000);
  props.setProperty(chiave, JSON.stringify({
    chiave, row, tipo, emailIst, pwd,
    dataAmmMs:  dataAmmObj  instanceof Date ? dataAmmObj.getTime()   : new Date(dataAmmObj).getTime(),
    dataScadMs: dataScadenza instanceof Date ? dataScadenza.getTime() : new Date(dataScadenza).getTime(),
    wsOk, m365Ok, wsPasswordDisponibile, tipoJob:'BENVENUTO',
    pianificatoIl: Date.now(),
    eseguiDopoMs: t.getTime(),
  }));
  ScriptApp.newTrigger('eseguiEmailBenvenutoRitardata').timeBased().at(t).create();
  traceLog_('[BV+15min] Pianificata alle '+t.toLocaleTimeString('it-IT')+' per riga '+row);
}

function pianificaEmailGenitore_(row, emailIst, pwd, dataAmmObj, dataScadenza, wsOk, m365Ok, wsPasswordDisponibile) {
  const chiave = 'EMAIL_GEN_' + row;
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(chiave)) {
    traceLog_('[GEN+15min] Job già pianificato per riga '+row+'. Nessun duplicato.');
    return;
  }
  const t = new Date(Date.now() + 15*60*1000);
  props.setProperty(chiave, JSON.stringify({
    chiave, row, emailIst, pwd,
    dataAmmMs:  dataAmmObj  instanceof Date ? dataAmmObj.getTime()   : new Date(dataAmmObj).getTime(),
    dataScadMs: dataScadenza instanceof Date ? dataScadenza.getTime() : new Date(dataScadenza).getTime(),
    wsOk, m365Ok, wsPasswordDisponibile, tipoJob:'GENITORE',
    pianificatoIl: Date.now(),
    eseguiDopoMs: t.getTime(),
  }));
  ScriptApp.newTrigger('eseguiEmailBenvenutoRitardata').timeBased().at(t).create();
  traceLog_('[GEN+15min] Pianificata alle '+t.toLocaleTimeString('it-IT')+' per riga '+row);
}

function eseguiEmailBenvenutoRitardata() {
  traceLog_('=== eseguiEmailBenvenutoRitardata START ===');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  const props    = PropertiesService.getScriptProperties();
  try {
    const allProps = props.getProperties();
    const sheet    = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
    let ok = 0;

    // Raccoglie risultati per riga → un solo riepilogo workflow per membro
    const risultatiPerRiga = {};

    for (const [chiave, json] of Object.entries(allProps)) {
      if (!chiave.startsWith('EMAIL_BV_') && !chiave.startsWith('EMAIL_GEN_')) continue;
      let job;
      try { job = JSON.parse(json); } catch(e) { props.deleteProperty(chiave); continue; }
      if (!jobDifferitoMaturo_(job, 15 * 60 * 1000)) {
        traceLog_('[BV+15] Job '+chiave+' non ancora maturo. Rimane in coda.');
        continue;
      }

      try {
        const rowData  = sheet.getRange(job.row, 1, 1, sheet.getLastColumn()).getValues()[0];
        const dataAmm  = new Date(job.dataAmmMs);
        const dataScad = new Date(job.dataScadMs);
        const I = CONFIG.IDX;

      // Inizializza struttura risultati per questa riga (se non ancora presente)
      if (!risultatiPerRiga[job.row]) {
        risultatiPerRiga[job.row] = {
          rowData,
          emailIst: job.emailIst, pwd: job.pwd,
          wsOk: job.wsOk, m365Ok: job.m365Ok,
          tesseraOk: false, tesseraUrl: '',
          firmaPersonale: '-', firmaIstituzionale: '-',
          benvenutoOk: null, genitoreOk: null,
          firmaGenitoreOk: '-', emailGenitore: null,
          errori: [],
        };
      }
      const rig = risultatiPerRiga[job.row];

      if (job.tipoJob === 'BENVENUTO') {
        const tipoMembro = rowData[I.TIPO_ASSOCIATO];
        const colRisp = tipoMembro === 'Socio Ordinario' ? I.MAIL_RISPOSTA_SOCIO : I.MAIL_RISPOSTA_VOLONTARIO;
        if (String(rowData[colRisp] || '').trim().toUpperCase() === 'OK') {
          traceLog_('[BV+15] Riga '+job.row+' già inviata. Skip benvenuto.');
          rig.benvenutoOk = true;
          ok++;
          continue;
        }
      } else if (String(rowData[I.MAIL_RISPOSTA_GENITORE] || '').trim().toUpperCase() === 'OK') {
        traceLog_('[BV+15] Riga '+job.row+' già inviata al genitore. Skip.');
        rig.genitoreOk = true;
        ok++;
        continue;
      }

      // Rigenera tessera (account GWS ora propagato)
      let tesseraBlob = null;
      let tesseraUrl  = '';
      try {
        const t = generaTesseraPDF_(rowData, rowData[CONFIG.IDX.TIPO_ASSOCIATO], dataAmm);
        tesseraBlob = t.blob;
        tesseraUrl  = t.driveUrl;
      } catch(e) { traceLog_('[BV+15] WARN tessera: '+e.message); }
      rig.tesseraOk  = tesseraBlob !== null;
      rig.tesseraUrl = tesseraUrl;

        if (job.tipoJob === 'BENVENUTO') {
        const tipoMembro = rowData[I.TIPO_ASSOCIATO];
        const datiMembro = getDatiAnagrafici_(rowData, tipoMembro);
        const ruolo = determinaRuoloFirma_(rowData);
        const colRisp = tipoMembro === 'Socio Ordinario' ? I.MAIL_RISPOSTA_SOCIO+1 : I.MAIL_RISPOSTA_VOLONTARIO+1;

        // Firma Gmail al membro (ritardata di 15 min per propagazione account GWS)
        let firmaMembro = { personale: 'Errore', istituzionale: '-' };
        try { firmaMembro = inviaEmailFirmaGmail_(datiMembro.email, job.emailIst, datiMembro.nome, datiMembro.cognome, datiMembro.tel, ruolo); }
        catch(err) { traceLog_('[BV+15] WARN Firma: '+err.message); }

        if (tipoMembro === 'Socio Ordinario') {
          sheet.getRange(job.row, I.MAIL_FIRMA_SOCIO_PERSONALE+1).setValue(firmaMembro.personale);
          sheet.getRange(job.row, I.MAIL_FIRMA_SOCIO_IST+1).setValue(firmaMembro.istituzionale);
        } else {
          sheet.getRange(job.row, I.MAIL_FIRMA_VOL_PERSONALE+1).setValue(firmaMembro.personale);
          sheet.getRange(job.row, I.MAIL_FIRMA_VOL_IST+1).setValue(firmaMembro.istituzionale);
        }
        rig.firmaPersonale     = firmaMembro.personale;
        rig.firmaIstituzionale = firmaMembro.istituzionale;

        // Imposta la firma automaticamente via Gmail API (10_GmailFirma.gs) — a 15 min
        // dalla creazione l'account GWS è ormai propagato. Se il service account non è
        // configurato, impostaFirmaGmail_ non fa nulla: restano comunque le istruzioni
        // manuali sopra e nell'email di benvenuto.
        if (job.wsOk) {
          try { impostaFirmaGmail_(job.emailIst, datiMembro.nome, datiMembro.cognome, datiMembro.tel, ruolo); }
          catch(err) { traceLog_('[BV+15] WARN impostaFirmaGmail_: '+err.message); }
        }

        // Firma Gmail al genitore (solo Volontario)
        let firmaGenStatus = '-';
        if (tipoMembro === 'Volontario') {
          const emailGenFirma = trovaEmailGenitore_(rowData);
          rig.emailGenitore = emailGenFirma;
          if (emailGenFirma) {
            try {
              const genRis = inviaEmailFirmaGmail_(emailGenFirma, null, datiMembro.nome, datiMembro.cognome, datiMembro.tel, ruolo);
              firmaGenStatus = genRis.personale;
            } catch(err) {
              firmaGenStatus = 'Errore';
              traceLog_('[BV+15] WARN Firma Genitore: '+err.message);
            }
          }
        }
        sheet.getRange(job.row, I.MAIL_FIRMA_GEN_IST+1).setValue(firmaGenStatus);
        rig.firmaGenitoreOk = firmaGenStatus;
        SpreadsheetApp.flush();

        try {
          inviaEmailBenvenuto_(rowData, tipoMembro,
            job.emailIst, job.pwd, tesseraBlob, dataAmm, dataScad, job.wsOk, job.m365Ok, tesseraUrl, job.wsPasswordDisponibile !== false);
          sheet.getRange(job.row, colRisp).setValue('OK');
          rig.benvenutoOk = true;
        } catch(err) {
          sheet.getRange(job.row, colRisp).setValue('Errore');
          rig.benvenutoOk = false;
          throw err;
        }
        traceLog_('[BV+15] ✅ Email firma + benvenuto riga '+job.row);
      } else {
        // Job GENITORE: recupera email genitore se non già impostata dal job BENVENUTO
        if (!rig.emailGenitore) rig.emailGenitore = trovaEmailGenitore_(rowData);

        try {
          inviaEmailGenitoreAmmissione_(rowData, job.emailIst, job.pwd, tesseraBlob,
            dataAmm, dataScad, job.wsOk, job.m365Ok, tesseraUrl, job.wsPasswordDisponibile !== false);
          sheet.getRange(job.row, I.MAIL_RISPOSTA_GENITORE+1).setValue('OK');
          rig.genitoreOk = true;
        } catch(err) {
          sheet.getRange(job.row, I.MAIL_RISPOSTA_GENITORE+1).setValue('Errore');
          rig.genitoreOk = false;
          throw err;
        }
        traceLog_('[BV+15] ✅ Email genitore riga '+job.row);
      }
      ok++;
      } catch(err) {
        traceLog_('[BV+15] ❌ ERRORE riga '+job.row+': '+err.toString());
        if (risultatiPerRiga[job.row]) risultatiPerRiga[job.row].errori.push(err.toString());
        inviaEmailErroreAmministratore(err);
      } finally {
        props.deleteProperty(chiave);
      }
    }

    // Invia un'email di riepilogo workflow completo per ogni riga processata
    for (const [rigaNum, info] of Object.entries(risultatiPerRiga)) {
      try { inviaEmailRiepilogoWorkflow_(info.rowData, rigaNum, info); }
      catch(e) { traceLog_('[Workflow] WARN riepilogo riga '+rigaNum+': '+e.message); }
    }

    // Autoelimina trigger solo quando non ci sono altri job futuri.
    eliminaTriggerSeNessunJob_('eseguiEmailBenvenutoRitardata', ['EMAIL_BV_', 'EMAIL_GEN_']);

    traceLog_('=== eseguiEmailBenvenutoRitardata END — ok: '+ok+' ===');
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRECONDIZIONI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifica se una riga "Ammesso" può procedere con l'onboarding completo.
 * `sheet` serve solo per il controllo del genitore (Volontario) — passare
 * sempre il foglio "Risposte" già aperto dal chiamante.
 *
 * Tre esiti possibili quando ok=false:
 *  - inAttesaPagamento: Socio Ordinario approvato ma non ancora pagante (Fase 2
 *    non completata). Atteso col flusso a due fasi — NON è un errore admin.
 *  - inAttesaGenitore: Volontario il cui genitore collegato non è ancora un
 *    Socio Ordinario "in regola" (ammesso + quota pagata). Atteso — si sblocca
 *    da solo quando il genitore completa l'iscrizione.
 *  - altrimenti: problema reale di configurazione (Gruppo/Data mancanti,
 *    membro espulso...) che richiede intervento admin.
 */
function verificaPrecondizioni_(rowData, sheet) {
  const I = CONFIG.IDX;
  const tipo    = rowData[I.TIPO_ASSOCIATO];
  const dataAmm = rowData[I.DATA_AMMISSIONE];
  const gruppo  = rowData[I.GRUPPO];
  const espulso = rowData[I.ESPULSO];
  const statoPag= rowData[I.STATO_PAGAMENTO];

  if (!dataAmm) return {ok:false, motivo:'"Ammesso/Rifiutato il" (AL) vuoto.'};
  const dObj = (dataAmm instanceof Date) ? dataAmm : new Date(dataAmm);
  if (isNaN(dObj.getTime())) return {ok:false, motivo:'Data ammissione non valida: "'+dataAmm+'"'};
  if (!gruppo || !String(gruppo).trim()) return {ok:false, motivo:'"Gruppo" (AM) vuoto.'};
  if (!Object.keys(CONFIG.WORKSPACE_GROUPS).includes(gruppo))
    return {ok:false, motivo:'Gruppo "'+gruppo+'" non valido. Valori ammessi: '+Object.keys(CONFIG.WORKSPACE_GROUPS).join(', ')};
  if (espulso && String(espulso).trim()) return {ok:false, motivo:'Membro risulta espulso.'};
  // Una cessazione registrata (Statuto Art. 9.1) chiude il rapporto associativo
  // a prescindere dalla causa: un receduto o un decaduto non deve rientrare
  // dalla finestra di un job differito rimasto in coda.
  const causaCess = cessazioneRegistrata_(rowData);
  if (causaCess) return {ok:false, motivo:'Rapporto associativo cessato ('+etichettaCausaCessazione_(causaCess)+').'};

  // Liberatoria immagini, video, audio ed esecuzione: serve una RISPOSTA, non
  // un consenso. 'Registrata' e 'Negata' passano entrambe — un NO è una
  // risposta valida, e pretendere il consenso per iscriversi lo renderebbe non
  // libero (art. 7 par. 4 GDPR), oltre a violare gli Artt. 6.2 e 8.1 dello
  // Statuto. Blocca solo il silenzio, e l'attesa del secondo genitore, perché
  // per un minore il consenso di uno solo non è ancora formato (Art. 8.7).
  // Il flag si spegne con CONFIG.LIBERATORIA_GATE_ATTIVO, senza deployment.
  const lib = statoLiberatoria_(rowData);
  if (!lib.rispostaRegistrata) {
    return {ok:false, inAttesaLiberatoria:true, dataObj:dObj,
            motivo:'In attesa della liberatoria immagini/video/audio (stato: "'+lib.stato+'").'};
  }

  if (tipo === 'Socio Ordinario' && statoPag !== 'Regolare')
    return {ok:false, motivo:'In attesa del pagamento della quota (Stato pagamento: "'+statoPag+'").', inAttesaPagamento:true, dataObj:dObj};

  if (tipo === 'Volontario') {
    const cfG  = String(rowData[I.CF_GENITORE]||'').trim().toUpperCase();
    const idPG = String(rowData[I.ID_PRATICA_GENITORE]||'').trim().toUpperCase();
    const genitore = sheet ? cercaGenitore_(sheet, cfG, idPG) : { trovato:false };
    if (!genitoreInRegola_(genitore))
      return {ok:false, motivo:'Il genitore collegato (CF/ID Pratica) non è ancora un Socio Ordinario ammesso e in regola con il pagamento.', inAttesaGenitore:true, dataObj:dObj};
  }

  return {ok:true, dataObj:dObj};
}

// ─────────────────────────────────────────────────────────────────────────────
// RIFIUTO
// ─────────────────────────────────────────────────────────────────────────────

function eseguiRifiuto_(sheet, row, rowData) {
  const I    = CONFIG.IDX;
  const tipo = rowData[I.TIPO_ASSOCIATO];
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[I.ID_PRATICA] || 'N/D';
  const motivo    = String(rowData[I.RIFIUTATO_PERCHE]||'').trim();
  const dataRif   = rowData[I.DATA_AMMISSIONE];
  const dataRifStr= dataRif ? formatData_(dataRif instanceof Date ? dataRif : new Date(dataRif)) : formatData_(new Date());

  traceLog_('=== RIFIUTO: '+dati.nome+' '+dati.cognome+' ===');

  const colRisp = tipo === 'Socio Ordinario' ? I.MAIL_RISPOSTA_SOCIO+1 : I.MAIL_RISPOSTA_VOLONTARIO+1;
  if (String(rowData[colRisp - 1] || '').trim().toUpperCase() === 'OK') {
    traceLog_('[Rifiuto] Riga '+row+' già notificata. Nessuna azione ripetuta.');
    return;
  }

  // 1. Rimborso Stripe — eseguito PRIMA dell'email così il messaggio riflette l'esito reale.
  //    Il guard preventivo viene impostato prima della chiamata API per evitare doppi rimborsi
  //    in caso di crash tra la risposta Stripe e la scrittura del flag.
  let rimborsoInfo = null;
  if (tipo === 'Socio Ordinario') {
    const idTrans = String(rowData[I.ID_TRANSAZIONE]||'').trim();
    const props = PropertiesService.getScriptProperties();
    const chiaveRimborso = 'RIMBORSO_RIF_' + idP;
    if (props.getProperty(chiaveRimborso)) {
      traceLog_('[Rifiuto] Rimborso già gestito per '+idP+'. Skip.');
      rimborsoInfo = { ok: true };
    } else {
      props.setProperty(chiaveRimborso, JSON.stringify({ idP, idTrans, stato: 'in_corso', avviatoIl: new Date().toISOString() }));
      try {
        const ris = idTrans ? eseguiRimborsoStripe_(idTrans, idP, dati) : { ok: false, errore: 'ID transazione assente.' };
        rimborsoInfo = { ok: ris.ok };
        if (!ris.ok) inviaEmailRimborsoManuale_(dati, idP, idTrans, ris.errore);
        props.setProperty(chiaveRimborso, JSON.stringify({ idP, idTrans, gestitoIl: new Date().toISOString(), ok: ris.ok }));
      } catch(err) {
        rimborsoInfo = { ok: false };
        inviaEmailRimborsoManuale_(dati, idP, '', err.message);
        props.setProperty(chiaveRimborso, JSON.stringify({ idP, idTrans: '', gestitoIl: new Date().toISOString(), ok: false, errore: err.message }));
      }
    }
  }

  // 2. Email di rifiuto — riceve rimborsoInfo con l'esito già noto
  try {
    inviaEmailRifiuto_(rowData, tipo, motivo, dataRifStr, rimborsoInfo);
    sheet.getRange(row, colRisp).setValue('OK');
  } catch(err) {
    sheet.getRange(row, colRisp).setValue('Errore');
    traceLog_('ERRORE email rifiuto: '+err.message);
    inviaEmailErroreAmministratore(err);
  }

  try { inviaNotificaRifiuto_(rowData, tipo, motivo); } catch(err) {}

  try { logModifica_(row, 'Stato domanda (AK)', 'In Corso', 'Rifiutato', idP, dati.nome+' '+dati.cognome); } catch(e){}

  traceLog_('=== RIFIUTO COMPLETATO ===');
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICHE CHAT
// ─────────────────────────────────────────────────────────────────────────────

function inviaNotificaAmmissione_(rowData, tipo, emailIst, wsOk, m365Ok) {
  if (!webhookChatValido_(CONFIG.CHAT_WEBHOOK_URL_CONFERME)) return;
  const dati  = getDatiAnagrafici_(rowData, tipo);
  const scad  = formatData_(calcolaDataScadenza_(rowData));
  const idP   = rowData[CONFIG.IDX.ID_PRATICA]||'N/D';
  inviaChatCard_({
    webhookUrl: CONFIG.CHAT_WEBHOOK_URL_CONFERME,
    id:'ammissione', titolo:'✅ Nuovo membro ammesso', sottotitolo:tipo,
    idPratica: idP,
    testo:'<b>'+dati.nome+' '+dati.cognome+'</b> ammesso come <b>'+tipo+'</b> — '+rowData[CONFIG.IDX.GRUPPO],
    campi:[
      {label:'Email',valore:emailIst},
      {label:'ID Pratica',valore:idP},
      {label:'Quota fino al',valore:scad},
      {label:'Workspace',valore:wsOk?'✅':'⚠️ manuale'},
      {label:'M365',valore:m365Ok?'✅':'⚠️ manuale'},
    ],
  });
}

function inviaNotificaRifiuto_(rowData, tipo, motivo) {
  if (!webhookChatValido_(CONFIG.CHAT_WEBHOOK_URL_CONFERME)) return;
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[CONFIG.IDX.ID_PRATICA]||'N/D';
  inviaChatCard_({
    webhookUrl: CONFIG.CHAT_WEBHOOK_URL_CONFERME,
    id:'rifiuto', titolo:'❌ Pratica rifiutata', sottotitolo:tipo,
    headerColor:'#C00000',
    idPratica: idP,
    testo:'La pratica di <b>'+dati.nome+' '+dati.cognome+'</b> è stata rifiutata.',
    campi:[{label:'ID Pratica',valore:idP},{label:'Motivo',valore:motivo||'Non specificato'}],
  });
}

function inviaChatCard_(opts) {
  const widgets = [];
  if (opts.testo) widgets.push({textParagraph:{text:opts.testo}});
  // cardsV2 usa "decoratedText" (non "keyValue" che è il vecchio formato v1)
  (opts.campi||[]).forEach(c => widgets.push({decoratedText:{topLabel:c.label,text:String(c.valore||'N/D')}}));
  widgets.push({buttonList:{buttons:[{text:'Apri in Presidenza',onClick:{openLink:{url:getLinkPresidenza_(opts.idPratica)}}}]}});

  const card = {cardsV2:[{cardId:opts.id,card:{
    header:{title:opts.titolo,subtitle:opts.sottotitolo,imageUrl:CONFIG.LOGO_URL,imageType:'CIRCLE'},
    sections:[{widgets}],
  }}]};

  const webhookUrl = opts.webhookUrl || CONFIG.CHAT_WEBHOOK_URL;
  const esito = inviaPayloadChat_(webhookUrl, card, 'Chat Conferme');
  if (esito.ok) traceLog_('[Chat] inviaChatCard_ → HTTP 200');
  else if (!esito.skipped) traceLog_('[Chat] inviaChatCard_ fallita: ' + (esito.code ? ('HTTP '+esito.code) : (esito.error || 'errore sconosciuto')));
}

// ─────────────────────────────────────────────────────────────────────────────
// RECOVERY MANUALE — riesegue l'onboarding per ID Pratica specifico
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Esegui questa funzione dall'editor GAS per forzare il ri-onboarding
 * di un membro il cui workflow non è partito (es. colonne BH/BI ancora '-').
 *
 * ISTRUZIONE:
 *  1. Imposta ID_PRATICA_TARGET con il valore della colonna AB del membro da recuperare.
 *  2. Esegui dal menu "Esegui" nell'editor.
 *
 * ATTENZIONE: la funzione verifica le precondizioni (Data ammissione, Gruppo,
 * Stato pagamento) prima di procedere. Se qualcosa manca, logga il motivo.
 */
function recoveryOnboardingManuale() {
  const ID_PRATICA_TARGET = 'PR-00062'; // ← cambia con l'ID pratica da recuperare

  traceLog_('=== RECOVERY ONBOARDING MANUALE: '+ID_PRATICA_TARGET+' ===');

  const ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) { traceLog_('ERRORE: foglio non trovato.'); return; }

  const data    = sheet.getDataRange().getValues();
  const numCols = sheet.getLastColumn();

  let found = false;
  for (let i = 1; i < data.length; i++) {
    const rowData = data[i];
    const idP     = String(rowData[CONFIG.IDX.ID_PRATICA] || '').trim().toUpperCase();
    if (idP !== ID_PRATICA_TARGET.trim().toUpperCase()) continue;

    found = true;
    const row = i + 1;
    traceLog_('[Recovery] Trovata riga '+row+' per '+ID_PRATICA_TARGET);

    // Ri-legge con tutti i valori aggiornati
    const rowDataFresh = sheet.getRange(row, 1, 1, numCols).getValues()[0];
    const stato        = String(rowDataFresh[CONFIG.IDX.STATO_DOMANDA] || '').trim();

    if (stato !== 'Ammesso') {
      traceLog_('[Recovery] STOP: stato attuale "'+stato+'" != "Ammesso". Imposta AK = "Ammesso" prima di procedere.');
      return;
    }

    const check = verificaPrecondizioni_(rowDataFresh, sheet);
    if (!check.ok) {
      traceLog_('[Recovery] STOP: precondizioni KO — '+check.motivo);
      return;
    }

    // Pulisce il guard MEMBRO_UFFICIALE se era rimasto 'SI' senza aver completato tutto
    const gsVal  = String(rowDataFresh[CONFIG.IDX.CREAZIONE_UTENTE_GOOGLE] || '').trim();
    const m365Val = String(rowDataFresh[CONFIG.IDX.CREAZIONE_UTENTE_M365] || '').trim();
    const mailBV  = String(rowDataFresh[CONFIG.IDX.MAIL_RISPOSTA_SOCIO] || '').trim().toUpperCase();
    if (rowDataFresh[CONFIG.IDX.MEMBRO_UFFICIALE] === 'SI' && (gsVal === '-' || gsVal === '') && mailBV !== 'OK') {
      traceLog_('[Recovery] MEMBRO_UFFICIALE è SI ma onboarding incompleto — pulisco il flag per ri-esecuzione.');
      sheet.getRange(row, CONFIG.IDX.MEMBRO_UFFICIALE + 1).setValue('');
      rowDataFresh[CONFIG.IDX.MEMBRO_UFFICIALE] = '';
      SpreadsheetApp.flush();
    }

    traceLog_('[Recovery] Avvio eseguiOnboarding_ per riga '+row);
    eseguiOnboarding_(sheet, row, rowDataFresh);
    traceLog_('[Recovery] === COMPLETATO ===');
    return;
  }

  if (!found) traceLog_('[Recovery] ERRORE: ID pratica "'+ID_PRATICA_TARGET+'" non trovato nel foglio.');
}
