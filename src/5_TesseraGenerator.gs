/**
 * MODULO: 5_TesseraGenerator.gs
 * ══════════════════════════════════════════════════════════════════════
 * Genera la tessera associativa in PDF.
 * QR code → https://contacts.google.com/person/[google-account-id]
 */

function generaTesseraPDF_(rowData, tipo, dataAmmObj) {
  const I    = CONFIG.IDX;
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = String(rowData[I.ID_PRATICA]||'N/D');

  traceLog_('[Tessera] Generazione per '+idP+' ('+dati.nome+' '+dati.cognome+')');

  const template = DriveApp.getFileById(CONFIG.SLIDES_TEMPLATE_ID);
  const nomeTemp = '_TEMP_Tessera_'+idP+'_'+Date.now();
  const folder   = CONFIG.TESSERE_FOLDER_ID ? DriveApp.getFolderById(CONFIG.TESSERE_FOLDER_ID) : null;
  const copia    = folder ? template.makeCopy(nomeTemp, folder) : template.makeCopy(nomeTemp);
  const copiaId  = copia.getId();

  try {
    const pres = SlidesApp.openById(copiaId);

    const dataAmmStr  = formatData_(dataAmmObj);
    const dataScadenza= aggiungi365Giorni_(dataAmmObj);
    const dataScadStr = formatData_(dataScadenza);
    const dataNascStr = formatData_(dati.dataNascita);

    // Sostituisce tutti i placeholder (gestisce anche run spezzati)
    const sostituzioni = {
      '{{NOME}}':           dati.nome,
      '{{COGNOME}}':        dati.cognome,
      '{{DATA_NASCITA}}':   dataNascStr,
      '{{CODICE_FISCALE}}': dati.cf,
      '{{TIPO}}':           tipo,
      '{{ID_PRATICA}}':     idP,
      '{{DATA_AMMISSIONE}}':dataAmmStr,
      '{{DATA_SCADENZA}}':  dataScadStr,
    };
    for (const [k,v] of Object.entries(sostituzioni)) pres.replaceAllText(k, v||'');

    // ── QR code → Google Contacts ─────────────────────────────────────────
    const emailIst   = String(rowData[I.EMAIL_ISTITUZIONALE] || '').trim();
    const contactUrl = getContactUrl_(emailIst);
    const qrTarget   = contactUrl
                       || 'https://contacts.google.com/search/' + encodeURIComponent(dati.nome + ' ' + dati.cognome);
    const qrUrl      = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&ecc=M&data='
                       + encodeURIComponent(qrTarget);

    try {
      const slide = pres.getSlides()[0];
      // Posizione: centrato, sotto i campi testo (A4: larghezza 595pt, altezza 842pt)
      // Campi testo finiscono intorno a 440pt. QR: 80x80pt centrato a 500pt
      slide.insertImage(qrUrl, 376, 359, 133, 133);
      traceLog_('[Tessera] QR inserito → '+qrTarget);
    } catch(qrErr) {
      traceLog_('[Tessera] WARN QR non inserito: '+qrErr.message);
    }

    pres.saveAndClose();

    // Export PDF
    const pdfResp = UrlFetchApp.fetch(
      'https://docs.google.com/presentation/d/'+copiaId+'/export/pdf',
      { headers:{'Authorization':'Bearer '+ScriptApp.getOAuthToken()}, muteHttpExceptions:true }
    );
    if (pdfResp.getResponseCode() !== 200)
      throw new Error('Export PDF HTTP '+pdfResp.getResponseCode());

    const pdf = pdfResp.getBlob()
      .setName('Tessera_'+idP+'_'+dati.cognome+'_'+dati.nome+'.pdf')
      .setContentType('application/pdf');

    // Salva PDF su Drive nella cartella tessere e condividi con l'utente istituzionale
    let driveUrl = '';
    try {
      const dest     = folder || DriveApp.getRootFolder();
      const pdfFile  = dest.createFile(pdf);
      pdfFile.setName('Tessera_'+idP+'_'+dati.cognome+'_'+dati.nome+'.pdf');
      const emailIst = String(rowData[I.EMAIL_ISTITUZIONALE]||'').trim();
      if (emailIst) pdfFile.addViewer(emailIst);
      driveUrl = pdfFile.getUrl();
      traceLog_('[Tessera] Salvata su Drive: '+driveUrl);
    } catch(saveErr) {
      traceLog_('[Tessera] WARN: non salvata su Drive: '+saveErr.message);
    }

    traceLog_('[Tessera] ✅ PDF: '+pdf.getName()+' ('+pdf.getBytes().length+' bytes)');
    return { blob: pdf, driveUrl: driveUrl };

  } finally {
    try { DriveApp.getFileById(copiaId).setTrashed(true); } catch(e){}
  }
}

/**
 * Risolve l'URL Google Contacts di un membro cercandolo nella directory
 * Workspace tramite email istituzionale (People API advanced service).
 * Richiede: Services → People API abilitato nel progetto Apps Script.
 */
function getContactUrl_(email) {
  if (!email) return null;
  try {
    const res = People.People.searchDirectoryPeople({
      query:    email,
      readMask: 'names',
      sources:  ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'],
      pageSize: 1,
    });
    if (res && res.people && res.people.length > 0) {
      const personId = res.people[0].resourceName.replace('people/', '');
      traceLog_('[Tessera] Google Contact: ' + email + ' → ' + personId);
      return 'https://contacts.google.com/person/' + personId;
    }
    traceLog_('[Tessera] WARN getContactUrl_: nessun contatto trovato per ' + email);
  } catch (e) {
    traceLog_('[Tessera] WARN getContactUrl_: ' + e.message);
  }
  return null;
}

/** Test: invia tessera di prova all'admin per l'ultima riga Ammessa */
function testGeneraTessera() {
  const sheet   = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  const allData = sheet.getDataRange().getValues();
  const I       = CONFIG.IDX;
  for (let i=1;i<allData.length;i++) {
    const row = allData[i];
    if (row[I.STATO_DOMANDA]==='Ammesso') {
      const tipo = row[I.TIPO_ASSOCIATO];
      const dAmm = row[I.DATA_AMMISSIONE];
      const dObj = (dAmm instanceof Date) ? dAmm : new Date(dAmm);
      const tessera = generaTesseraPDF_(row, tipo, dObj);
      const dati = getDatiAnagrafici_(row, tipo);
      inviaEmail_(CONFIG.EMAIL_ADMIN_ERRORI,
        '[TEST Tessera] '+dati.nome+' '+dati.cognome,
        _htmlWrapper('Test Tessera','<div class="text">Tessera di test allegata per '+dati.nome+' '+dati.cognome+'.</div>'),
        {attachments:[tessera.blob]});
      traceLog_('[Test Tessera] Inviata per riga '+(i+1));
      return;
    }
  }
  traceLog_('[Test Tessera] Nessuna riga Ammessa trovata.');
}
