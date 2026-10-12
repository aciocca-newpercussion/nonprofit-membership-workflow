/**
 * MODULO: 14_IntegrazioneFinanza.gs
 * ══════════════════════════════════════════════════════════════════════
 * Collega il sistema Associati al sistema Finanza.
 *
 * Ogni volta che un Socio Ordinario effettua un pagamento Stripe
 * (prima quota o rinnovo), genera automaticamente:
 *  1. Ricevuta Associativa Non Fiscale in PDF (da template Google Doc)
 *  2. Email al socio con ricevuta allegata
 *  3. Riga nel Registro Movimenti del sistema Finanza
 *
 * Chiamato da: 3_StripeAdmin.gs → gestisciPagamentoRiuscito_()
 * Non dipende da nessun file del progetto Finanza — funziona in autonomia.
 */

// ── Configurazione risorse del sistema Finanza ────────────────────────────────

const FINANZA_BRIDGE = {
  SPREADSHEET_ID:            '{{SPREADSHEET_ID}}',
  FOGLIO_REGISTRO:           'Registro Movimenti',
  DRIVE_FOLDER_ENTRATE_ID:   '{{DRIVE_FOLDER_ENTRATE_ID}}',
  TEMPLATE_RICEVUTA_ID:      '{{TEMPLATE_RICEVUTA_ID}}',
  CAUSALE:                   'Quota Associativa Annuale',
  MODALITA_PAGAMENTO:        'Stripe',
  ASSOCIAZIONE_NOME:         '{{NOME_LEGALE}}',
  ASSOCIAZIONE_LUOGO:        "{{SEDE_LEGALE}}",
  ADMIN_EMAIL:               '{{EMAIL_ADMIN_ERRORI}}',

  // ── Classificazione fiscale (09/09/2026) ───────────────────────────────────
  //
  // ⚠️ Questi tre valori sono **copie** di quelli che vivono nel progetto
  // Finanza (`NATURA_ENTRATA` in 1_Config_Finanza.gs) e nel contratto
  // `<progetto contabilita'>/contratti`. Sono progetti Apps
  // Script separati: non si vedono le funzioni a vicenda, e l'alternativa
  // sarebbe una libreria condivisa, cioe' un deploy in piu' da tenere
  // allineato per tre costanti. Chi cambia il contratto cambia anche qui.
  NATURA:                    'quota',   // una quota associativa e' sempre questo
  SEZIONE:                   'A',       // attivita' di interesse generale
  // La commissione Stripe: un onere dell'ente, mai uno sconto sull'entrata.
  CATEGORIA_COMMISSIONI:     'Commissioni su incassi',
  SEZIONE_COMMISSIONI:       'D',
};

// ── Entry point ───────────────────────────────────────────────────────────────

/**
 * Genera la ricevuta finanziaria per un pagamento Stripe riuscito.
 * @param {Array}  rowData          - riga completa dal foglio Associati
 * @param {number} importoCentesimi - importo pagato in centesimi (es. 5500)
 * @param {string} chargeId         - ID transazione Stripe (es. ch_xxx o pi_xxx)
 */
function generaRicevutaQuotaSocio_(rowData, importoCentesimi, chargeId) {
  const I = CONFIG.IDX;

  const dati = {
    nome:              (String(rowData[I.NOME_SOCIO]    || '') + ' ' +
                        String(rowData[I.COGNOME_SOCIO] || '')).trim(),
    cf:                String(rowData[I.CF_SOCIO]       || '').trim().toUpperCase(),
    indirizzo:         String(rowData[I.PAYER_ADDRESS]  || '').trim(),
    email:             String(rowData[I.EMAIL_SOCIO]    || '').trim().toLowerCase(),
    importo:           (importoCentesimi / 100).toFixed(2),
    causale:           FINANZA_BRIDGE.CAUSALE,
    modalitaPagamento: FINANZA_BRIDGE.MODALITA_PAGAMENTO,
  };

  if (!dati.email) {
    traceLog_('[Finanza] WARN: email socio vuota — ricevuta non generata.');
    return;
  }

  const oggi    = new Date();
  const dataStr = _fnFormatData_(oggi);

  // ⚠️ Numero e scrittura dentro **lo stesso lock**: prenderlo prima e
  // scrivere dopo lascia aperta la finestra in cui due pagamenti simultanei
  // leggono lo stesso massimo e producono due ricevute con lo stesso numero.
  // Vedi il commento in testa a `_fnNumeroProgressivo_`.
  const numero = _fnConNumeroProgressivo_(function(numeroAssegnato) {

    const pdfResult = _fnGeneraPDF_(numeroAssegnato, dataStr, dati);

    _fnInviaEmail_(dati, numeroAssegnato, dataStr, pdfResult.pdfBlob);

    _fnAppendRegistro_({
      data:           dataStr,
      numero_doc:     numeroAssegnato,
      tipo:           'Entrata',
      importo:        parseFloat(dati.importo),
      causale:        dati.causale,
      controparte:    dati.nome,
      cf_controparte: dati.cf,
      categoria:      '',
      note:           chargeId ? 'Stripe: ' + chargeId : 'Pagamento: Stripe',
      file_drive_id:  pdfResult.fileId,
      email_inviata:  'SI',
      natura:         FINANZA_BRIDGE.NATURA,
      sezione:        FINANZA_BRIDGE.SEZIONE,
    });

    return numeroAssegnato;
  });

  // La commissione trattenuta da Stripe, come **riga di uscita a sé**.
  // Mai bloccante: se Stripe non risponde, la ricevuta e' comunque emessa e la
  // commissione si recupera dopo con `recuperaCommissioniStripeMancanti`.
  try { _fnRegistraCommissioneStripe_(chargeId, dati.nome, dataStr); }
  catch (err) { traceLog_('[Finanza] WARN commissione non registrata: ' + err.message); }

  // Ponte Supabase (19_SupabaseSync.gs) — stessa ricevuta, riflessa sulla
  // Banca reale dell'app mobile dell'ente e sulla quota del socio. Mai bloccante:
  // ognuna delle due chiamate ha il proprio try/catch interno. `I` è già
  // in scope da cima funzione, non ridichiarato.
  const emailIst = String(rowData[I.EMAIL_ISTITUZIONALE] || '').trim();
  if (emailIst) {
    syncMemberPayment_(rowData, oggi, rowData[I.STRIPE_CUSTOMER_ID] || '');
  }
  syncFinanceMovement_({
    movementDateISO: Utilities.formatDate(oggi, 'Europe/Rome', 'yyyy-MM-dd'),
    amountCents:     importoCentesimi,
    description:     dati.causale,
    counterpart:     dati.nome,
    category:        'Quote associative',
    notes:           chargeId ? 'Stripe: ' + chargeId : 'Pagamento: Stripe',
    createdByEmail:  FINANZA_BRIDGE.ADMIN_EMAIL,
    externalRef:     chargeId || ('ricevuta-' + numero),
  });

  traceLog_('[Finanza] Ricevuta ' + numero + ' generata per ' + dati.nome);
}

// ── Numero progressivo ────────────────────────────────────────────────────────

/// Il prossimo numero di ricevuta dell'anno, nella forma `042/2026`.
///
/// ## ⚠️ Cosa c'era prima, e perche' era rotto (corretto il 09/09/2026)
///
/// Contava le righe (`contatore + 1`). Tre modi di sbagliare, tutti silenziosi:
///
///  1. **Righe cancellate**: tolta la 003, la successiva rinasceva 003 e in
///     archivio finivano due ricevute con lo stesso numero.
///  2. **Due incassi insieme**: questo ponte e il modulo Jotform scrivono
///     sullo stesso foglio; contavano lo stesso totale e sceglievano lo stesso
///     numero. Nessun errore, due PDF gemelli.
///  3. **`indexOf(anno)`** cercava l'anno **ovunque** nel numero documento, e
///     le uscite ci mettono il nome del file (`2026_06_25_Enel`): bastava una
///     fattura registrata come Entrata per spostare la numerazione.
///
/// Ora: **massimo + 1** sulla forma esatta `NNN/AAAA`, cosi' una riga
/// cancellata lascia un buco invece di un duplicato.
///
/// ⚠️ Gemello di `getNumeroProgressivo_` nel progetto Finanza. Sono progetti
/// Apps Script separati e non si vedono: la correzione va fatta in entrambi, e
/// il 09/09/2026 e' stata fatta in entrambi.
function _fnNumeroProgressivo_() {
  const ss    = SpreadsheetApp.openById(FINANZA_BRIDGE.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(FINANZA_BRIDGE.FOGLIO_REGISTRO);
  const anno  = new Date().getFullYear();
  if (!sheet || sheet.getLastRow() < 2) return '001/' + anno;

  const righe = sheet.getDataRange().getValues();
  const suffisso = '/' + anno;
  let massimo = 0;
  for (let i = 1; i < righe.length; i++) {
    // colonna 2 = Tipo, colonna 1 = Numero Doc
    if (righe[i][2] !== 'Entrata') continue;
    const numDoc = String(righe[i][1] || '').trim();
    if (numDoc.length < suffisso.length) continue;
    if (numDoc.slice(-suffisso.length) !== suffisso) continue;
    const progressivo = parseInt(numDoc.slice(0, numDoc.length - suffisso.length), 10);
    if (!isNaN(progressivo) && progressivo > massimo) massimo = progressivo;
  }
  return String(massimo + 1).padStart(3, '0') + suffisso;
}

/// Esegue `azione(numero)` tenendo il lock dal calcolo del numero fino alla
/// scrittura della riga.
///
/// Trenta secondi: dentro l'azione ci sono una copia di documento, un export
/// PDF e un invio email, e sotto i venti secondi la seconda esecuzione
/// rinuncerebbe proprio mentre la prima sta finendo.
function _fnConNumeroProgressivo_(azione) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    throw new Error('Numerazione ricevute occupata: riprovare fra un minuto.');
  }
  try {
    return azione(_fnNumeroProgressivo_());
  } finally {
    lock.releaseLock();
  }
}

// ── Commissione Stripe come uscita ────────────────────────────────────────────

/// Registra in Prima Nota la commissione trattenuta da Stripe su un incasso.
///
/// ## Perche' e' una riga a parte e non uno sconto sull'entrata
///
/// L'entrata dell'ente e' quello che il socio ha pagato: l'importo della quota. Sul conto ne
/// arrivano meno, e la differenza e' un **costo** che l'ente sostiene per
/// incassare. Registrare il solo netto farebbe sparire due fatti — l'importo
/// vero della quota e il costo del canale — e i modelli del DM 5 marzo 2020
/// non ammettono di compensare partite. Senza questa riga, inoltre, il saldo
/// del registro non puo' quadrare con l'estratto conto: e' la ragione pratica.
///
/// Due chiamate a Stripe, perche' il charge non porta la commissione ma solo
/// l'id della propria balance transaction.
function _fnRegistraCommissioneStripe_(chargeId, nomeSocio, dataStr) {
  if (!chargeId) return;

  // Un PaymentIntent non e' un charge: si risale al charge piu' recente.
  let idCharge = chargeId;
  if (String(chargeId).indexOf('pi_') === 0) {
    const pi = stripeGet_('/v1/payment_intents/' + chargeId);
    if (!pi.ok || !pi.data.latest_charge) return;
    idCharge = pi.data.latest_charge;
  }

  const charge = stripeGet_('/v1/charges/' + idCharge);
  if (!charge.ok || !charge.data.balance_transaction) return;

  const bt = stripeGet_('/v1/balance_transactions/' + charge.data.balance_transaction);
  if (!bt.ok) return;

  const commissione = Number(bt.data.fee || 0);
  if (!commissione) return;

  // ⚠️ Idempotenza: il webhook Stripe puo' arrivare due volte per lo stesso
  // pagamento (e' successo: vedi HANDOFF_STRIPE_WEBHOOK.md). Una riga di
  // commissione doppia falserebbe il rendiconto in silenzio, quindi si
  // controlla prima se c'e' gia'.
  if (_fnCommissioneGiaRegistrata_(idCharge)) {
    traceLog_('[Finanza] Commissione di ' + idCharge + ' gia\' in registro: non riscritta.');
    return;
  }

  _fnAppendRegistro_({
    data:           dataStr,
    numero_doc:     'Commissione ' + idCharge,
    tipo:           'Uscita',
    importo:        -(commissione / 100),
    causale:        'Commissione Stripe su incasso quota',
    controparte:    'Stripe',
    cf_controparte: '',
    categoria:      FINANZA_BRIDGE.CATEGORIA_COMMISSIONI,
    note:           'Incasso: ' + idCharge + (nomeSocio ? ' — ' + nomeSocio : ''),
    file_drive_id:  '',
    email_inviata:  'N/A',
    natura:         '',
    sezione:        FINANZA_BRIDGE.SEZIONE_COMMISSIONI,
  });

  traceLog_('[Finanza] Commissione ' + (commissione / 100).toFixed(2) + ' € registrata per ' + idCharge);
}

function _fnCommissioneGiaRegistrata_(idCharge) {
  const ss    = SpreadsheetApp.openById(FINANZA_BRIDGE.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(FINANZA_BRIDGE.FOGLIO_REGISTRO);
  if (!sheet || sheet.getLastRow() < 2) return false;
  const righe = sheet.getDataRange().getValues();
  const atteso = 'Commissione ' + idCharge;
  for (let i = 1; i < righe.length; i++) {
    if (String(righe[i][1] || '').trim() === atteso) return true;
  }
  return false;
}

/// Recupera le commissioni degli incassi gia' registrati che non ce l'hanno.
///
/// **Da eseguire a mano dall'editor** (per questo non ha l'underscore finale).
/// Serve due volte: la prima, per le quote incassate prima del 09/09/2026,
/// quando la commissione non veniva registrata affatto; poi, ogni volta che
/// Stripe non ha risposto durante un webhook.
///
/// ⚠️ Non inventa nulla: legge le righe di Entrata che portano «Stripe: ch_…»
/// nelle note, chiede a Stripe la commissione vera e scrive solo quelle che
/// mancano. Le righe gia' presenti non si toccano.
function recuperaCommissioniStripeMancanti() {
  const ss    = SpreadsheetApp.openById(FINANZA_BRIDGE.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(FINANZA_BRIDGE.FOGLIO_REGISTRO);
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log('Registro vuoto.');
    return;
  }
  const righe = sheet.getDataRange().getValues();
  let scritte = 0, saltate = 0;

  for (let i = 1; i < righe.length; i++) {
    if (righe[i][2] !== 'Entrata') continue;
    const note = String(righe[i][8] || '');
    const match = note.match(/Stripe:\s*((?:ch|pi)_[A-Za-z0-9]+)/);
    if (!match) continue;
    const idCharge = match[1];
    if (_fnCommissioneGiaRegistrata_(idCharge)) { saltate++; continue; }
    try {
      _fnRegistraCommissioneStripe_(idCharge, String(righe[i][5] || ''), String(righe[i][0] || ''));
      scritte++;
    } catch (err) {
      Logger.log('Commissione non recuperata per ' + idCharge + ': ' + err.message);
    }
  }
  Logger.log('Commissioni recuperate: ' + scritte + ' scritte, ' + saltate + ' gia\' presenti.');
}

// ── Generazione PDF da template Google Doc ────────────────────────────────────

function _fnGeneraPDF_(numero, dataStr, dati) {
  const folder    = DriveApp.getFolderById(FINANZA_BRIDGE.DRIVE_FOLDER_ENTRATE_ID);
  const nomeTemp  = 'TEMP_Ricevuta_' + numero.replace('/', '-') + '_' + Date.now();
  const copyFile  = DriveApp.getFileById(FINANZA_BRIDGE.TEMPLATE_RICEVUTA_ID).makeCopy(nomeTemp);
  const tempDocId = copyFile.getId();

  try {
    const doc  = DocumentApp.openById(tempDocId);
    const body = doc.getBody();

    body.replaceText('\\{\\{Numero\\}\\}',            numero);
    body.replaceText('\\{\\{Luogo\\}\\}',             FINANZA_BRIDGE.ASSOCIAZIONE_LUOGO);
    body.replaceText('\\{\\{Data\\}\\}',              dataStr);
    body.replaceText('\\{\\{Nome\\}\\}',              dati.nome);
    body.replaceText('\\{\\{CF\\}\\}',                dati.cf);
    body.replaceText('\\{\\{Indirizzo\\}\\}',         dati.indirizzo || '');
    body.replaceText('\\{\\{Importo\\}\\}',           (parseFloat(dati.importo) || 0).toFixed(2).replace('.', ','));
    body.replaceText('\\{\\{Causale\\}\\}',           dati.causale);
    body.replaceText('\\{\\{ModalitaPagamento\\}\\}', dati.modalitaPagamento);
    doc.saveAndClose();

    const token   = ScriptApp.getOAuthToken();
    const pdfResp = UrlFetchApp.fetch(
      'https://docs.google.com/feeds/download/documents/export/Export?id=' + tempDocId + '&exportFormat=pdf',
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
    );

    if (pdfResp.getResponseCode() !== 200) {
      throw new Error('Export PDF fallito (HTTP ' + pdfResp.getResponseCode() + ')');
    }

    const nomeSocio = dati.nome.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 50);
    const nomePdf   = 'Ricevuta_' + numero.replace('/', '-') + '_' + nomeSocio + '.pdf';
    const pdfBlob   = pdfResp.getBlob().setName(nomePdf);
    const savedFile = folder.createFile(pdfBlob);

    return { pdfBlob: pdfBlob, fileId: savedFile.getId() };

  } finally {
    DriveApp.getFileById(tempDocId).setTrashed(true);
  }
}

// ── Email con ricevuta allegata ───────────────────────────────────────────────

function _fnInviaEmail_(dati, numero, dataStr, pdfBlob) {
  GmailApp.sendEmail(
    dati.email,
    'Ricevuta N. ' + numero + ' — ' + dati.causale,
    'Gentile ' + dati.nome + ',\n\n' +
    'in allegato trova la ricevuta relativa al contributo versato:\n\n' +
    '  Numero ricevuta : ' + numero + '\n' +
    '  Data            : ' + dataStr + '\n' +
    '  Importo         : € ' + (parseFloat(dati.importo) || 0).toFixed(2).replace('.', ',') + '\n' +
    '  Causale         : ' + dati.causale + '\n\n' +
    'Per qualsiasi informazione, può contattarci all\'indirizzo ' + FINANZA_BRIDGE.ADMIN_EMAIL + '.\n\n' +
    'Cordiali saluti,\n' +
    FINANZA_BRIDGE.ASSOCIAZIONE_NOME,
    {
      attachments: [pdfBlob],
      name:        FINANZA_BRIDGE.ASSOCIAZIONE_NOME,
      replyTo:     FINANZA_BRIDGE.ADMIN_EMAIL,
    }
  );
}

// ── Scrittura Registro Movimenti ──────────────────────────────────────────────

function _fnAppendRegistro_(r) {
  const ss = SpreadsheetApp.openById(FINANZA_BRIDGE.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(FINANZA_BRIDGE.FOGLIO_REGISTRO);
  if (!sheet) sheet = ss.insertSheet(FINANZA_BRIDGE.FOGLIO_REGISTRO);

  // ⚠️ Quattordici colonne dal 09/09/2026, non piu' undici: natura fiscale,
  // sezione del rendiconto e raccolta fondi. Le tre nuove stanno **in coda** e
  // mai in mezzo, altrimenti ogni riga gia' scritta si sposterebbe di posto.
  // L'elenco e' un gemello di INTESTAZIONI_PRIMA_NOTA nel progetto Finanza:
  // sono progetti separati e non si vedono, quindi chi tocca uno tocca l'altro.
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Data', 'Numero Doc', 'Tipo', 'Importo (€)',
      'Causale / Descrizione', 'Controparte', 'CF / P.IVA',
      'Categoria', 'Note', 'ID File Drive', 'Email Inviata',
      'Natura fiscale', 'Sezione', 'Raccolta / Evento']);
    const h = sheet.getRange(1, 1, 1, 14);
    h.setFontWeight('bold');
    h.setBackground('{{COLORE_BLU}}');
    h.setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  }

  sheet.appendRow([
    r.data, r.numero_doc, r.tipo, r.importo, r.causale,
    r.controparte, r.cf_controparte, r.categoria, r.note,
    r.file_drive_id, r.email_inviata,
    r.natura || '', r.sezione || '', r.raccolta || '',
  ]);
}

// ── Helper data ───────────────────────────────────────────────────────────────

function _fnFormatData_(date) {
  return String(date.getDate()).padStart(2, '0') + '/' +
         String(date.getMonth() + 1).padStart(2, '0') + '/' +
         date.getFullYear();
}
