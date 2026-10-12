/**
 * MODULO: 15_ModuloIscrizioneWebApp.gs
 * ══════════════════════════════════════════════════════════════════════
 * Fase 1 del workflow di iscrizione: richiesta di ammissione (domanda
 * completa, SENZA alcun pagamento) per l'{{NOME_GRUPPO}}
 * APS ETS ({{DOMINIO}}). Il pagamento della quota (solo Soci Ordinari)
 * avviene in Fase 2, dopo l'approvazione della Presidenza — vedi
 * 16_ModuloPagamentoWebApp.gs.
 *
 * Funzioni offerte:
 *  - Servizio Web App via `doGetIscrizione()` / `doGet()` (router unico — vedi sotto)
 *  - Interfaccia grafica fluida identica a Jotform (Colori #EF9100 / #2C2D80)
 *  - Supporto Multilingua reale (Italiano, English US, English UK, Español, Français, 简体中文)
 *  - Gestione flussi condizionali (Socio Ordinario vs Volontario Minorenne)
 *  - Canvas Firma Digitale Touch/Mouse
 *  - Upload file direttamente su Google Drive nella cartella associativa
 *  - Inserimento idoneo nel foglio "Risposte" per attivare istantaneamente `RouterModuli.gs`
 */

/**
 * Router unico del progetto: un progetto Apps Script ha UN SOLO `doGet`,
 * quindi tutte le web app del sistema (Fase 1, Fase 2 pagamento, pagina
 * "copia firma" Gmail, pannello Presidenza) passano da qui e si smistano
 * in base a `e.parameter`.
 *  - ?pagina=paga                        → Fase 2 (16_ModuloPagamentoWebApp.gs)
 *  - ?pagina=presidenza                  → Pannello Presidenza, HTML per browser (17_PresidenzaAdmin.gs)
 *  - ?pagina=presidenza&formato=json     → stessa dashboard/azioni, JSON per l'app iOS (18_PresidenzaAdminAPI.gs)
 *  - ?nome&cognome&email                 → pagina "copia firma" (10_GmailFirma.gs)
 *  - default                             → Fase 1, questo modulo
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.pagina === 'paga') return doGetPagamento(e);
  if (p.pagina === 'presidenza' && p.formato === 'json') return doGetPresidenzaApi_(e);
  if (p.pagina === 'presidenza') return doGetPresidenzaAdmin(e);
  if (p.pagina === 'liberatoria') return doGetLiberatoria(e);
  if (p.nome && p.cognome && p.email) return doGetFirmaGmail(e);
  return doGetIscrizione(e);
}

function doGetIscrizione(e) {
  const template = HtmlService.createTemplateFromFile('ModuloIscrizioneHTML');
  return template.evaluate()
    .setTitle('Modulo digitale 2026: Unisciti all\'Associazione — {{NOME_GRUPPO}}')
    .setFaviconUrl('{{LOGO_URL}}')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/**
 * Funzione backend chiamata dal form client-side per processare l'iscrizione.
 * @param {Object} data Oggetto inviato dal form client-side
 */
function salvaModuloIscrizione(data) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);

    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) throw new Error('Foglio "' + CONFIG.SHEET_NAME + '" non trovato.');

    // 1. Cartella Google Drive per i file caricati
    let folder = DriveApp.getFolderById(CONFIG.TESSERE_FOLDER_ID);
    const ora = new Date();
    const submissionId = 'WEB_' + ora.getTime();

    // Helper per salvare un singolo file base64 su Drive.
    // NB: niente setSharing(ANYONE_WITH_LINK) qui — questi file includono copie di
    // documenti d'identità (anche di minorenni per i Volontari). Il file eredita i
    // permessi della cartella associativa (CONFIG.TESSERE_FOLDER_ID): solo chi ha
    // già accesso a quella cartella (la Presidenza) può aprirne il link dal foglio.
    function salvaFileBase64(fileObj, nomePrefisso, indice) {
      if (!fileObj || !fileObj.base64) return '';
      const content = fileObj.base64.split(',')[1] || fileObj.base64;
      const bytes = Utilities.base64Decode(content);
      const mime = fileObj.mimeType || 'application/octet-stream';
      const suffisso = indice ? ('_' + indice) : '';
      const fileName = nomePrefisso + suffisso + '_' + (fileObj.fileName || 'file');
      const blob = Utilities.newBlob(bytes, mime, fileName);
      const createdFile = folder.createFile(blob);
      return createdFile.getUrl();
    }

    // Converte "YYYY-MM-DD" (formato nativo di <input type="date">) in un vero
    // oggetto Date: così la cella eredita il formato data del foglio (DD/MM/YYYY,
    // locale italiano) invece di restare una stringa ISO illeggibile. Costruito
    // per componenti (non new Date(iso)) per evitare qualunque scostamento di
    // fuso orario sulla mezzanotte.
    function parseDataNascita(iso) {
      if (!iso) return '';
      const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return iso; // formato inatteso: meglio salvarlo com'è che perderlo
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }

    // Forza la cella a testo con un apostrofo iniziale: senza, Google Sheets
    // interpreta un valore che comincia con "+" (es. "+39 333 1234567") come
    // l'inizio di una formula — e quella non è una formula valida, quindi la
    // cella finisce in #ERROR!.
    function formattaTelefono(prefisso, numero) {
      const val = (String(prefisso || '').trim() + ' ' + String(numero || '').trim()).trim();
      return val ? "'" + val : '';
    }

    // Il modulo consente fino a 2 file per documento (fronte e retro): il client
    // invia sempre un array. Si accetta anche il singolo oggetto per retro-
    // compatibilità con eventuali invii partiti dalla versione precedente.
    function salvaAllegati(input, nomePrefisso) {
      if (!input) return [];
      const lista = Array.isArray(input) ? input : [input];
      const urls = [];
      for (let i = 0; i < lista.length; i++) {
        const url = salvaFileBase64(lista[i], nomePrefisso, lista.length > 1 ? (i + 1) : 0);
        if (url) urls.push(url);
      }
      return urls;
    }

    // Salvataggio Allegati
    const urlDocIdentitaParent = salvaAllegati(data.docIdentitaParent, 'ID_Genitore');
    const urlDocIdentitaVol = salvaAllegati(data.docIdentitaVol, 'ID_Volontario');
    const urlDocIdentitaSocio = salvaAllegati(data.docIdentitaSocio, 'ID_Socio');
    const urlFirma = salvaFileBase64(data.firmaBase64 ? { base64: data.firmaBase64, fileName: 'firma.png', mimeType: 'image/png' } : null, 'Firma', 0);

    // Combinazione dei link ai documenti d'identità (anche più file per persona)
    const docIdentitaUrl = []
      .concat(urlDocIdentitaParent, urlDocIdentitaVol, urlDocIdentitaSocio)
      .filter(Boolean).join(' | ');

    // 2. Costruzione della riga secondo `CONFIG.IDX`
    // La riga nasce larga quanto tutte le colonne gestionali definite in
    // CONFIG.IDX: appendRow con meno colonne lascerebbe la griglia corta, e le
    // funzioni che scrivono in fondo (cessazione, delibere, liberatoria)
    // dovrebbero allargarla al volo. L'ultima colonna è CE — vedi 1_CONFIG_V8.gs.
    const lastCol = Math.max(sheet.getLastColumn(), CONFIG.IDX.MAIL_LIBERATORIA_PRESIDENZA + 1);
    const row = new Array(lastCol).fill('');

    const dataInvioStr = Utilities.formatDate(ora, 'Europe/Rome', 'dd/MM/yyyy');
    const oraInvioStr = Utilities.formatDate(ora, 'Europe/Rome', 'HH:mm:ss');
    const timestampCompleto = Utilities.formatDate(ora, 'Europe/Rome', 'dd/MM/yyyy HH:mm:ss');

    const I = CONFIG.IDX;

    row[I.DATA_SUBMISSION] = timestampCompleto;
    row[I.TIPO_ASSOCIATO] = data.tipoAssociato; // 'Socio Ordinario' o 'Volontario'

    // ID Pratica: nel flusso Jotform veniva generato dal form stesso; qui va
    // assegnato a mano perché è la chiave usata per il collegamento genitore↔volontario
    // (vedi 7_RouterModuli.gs) e per tutte le comunicazioni successive.
    const idPratica = generaProssimoIdPratica_(sheet);
    row[I.ID_PRATICA] = idPratica;

    if (data.tipoAssociato === 'Socio Ordinario') {
      row[I.NOME_SOCIO] = data.nomeSocio || '';
      row[I.COGNOME_SOCIO] = data.cognomeSocio || '';
      row[I.SESSO_SOCIO] = (data.sessoSocio || '').toUpperCase();
      row[I.CF_SOCIO] = (data.cfSocio || '').toUpperCase();
      row[I.DATA_NASCITA_SOCIO] = parseDataNascita(data.dataNascitaSocio);
      row[I.EMAIL_SOCIO] = data.emailSocio || '';
      row[I.TEL_SOCIO] = formattaTelefono(data.prefissoTelSocio, data.telSocio);
      row[I.FIRMA_SOCIO] = urlFirma;
    } else if (data.tipoAssociato === 'Volontario') {
      // Genitore
      row[I.NOME_SOCIO] = data.nomeGenitore || '';
      row[I.COGNOME_SOCIO] = data.cognomeGenitore || '';
      row[I.EMAIL_SOCIO] = data.emailGenitore || '';
      row[I.TEL_SOCIO] = formattaTelefono(data.prefissoTelGenitore, data.telGenitore);
      row[I.CF_GENITORE] = (data.cfGenitore || '').toUpperCase();
      row[I.ID_PRATICA_GENITORE] = (data.idPraticaGenitore || '').toUpperCase();
      row[I.FIRMA_GENITORE] = urlFirma;

      // Volontario minorenne
      row[I.NOME_VOLONTARIO] = data.nomeVolontario || '';
      row[I.COGNOME_VOLONTARIO] = data.cognomeVolontario || '';
      row[I.SESSO_VOLONTARIO] = (data.sessoVolontario || '').toUpperCase();
      row[I.CF_VOLONTARIO] = (data.cfVolontario || '').toUpperCase();
      row[I.DATA_NASCITA_VOLONTARIO] = parseDataNascita(data.dataNascitaVolontario);
      row[I.EMAIL_VOLONTARIO] = data.emailVolontario || '';
      row[I.TEL_VOLONTARIO] = formattaTelefono(data.prefissoTelVol, data.telVolontario);
      row[I.NOTE_ABILITA_MUSICALI] = data.musicSkills || '';
    }

    row[I.FILE_DOC_IDENTITA] = docIdentitaUrl;

    row[I.TC_POLITICHE] = 'Accetto';
    row[I.TC_PRIVACY] = 'Accetto';
    row[I.TC_STATUTO] = 'Accetto';

    // Liberatoria immagini/video: facoltativa e granulare per canale, distinta
    // dal consenso Statuto/Privacy/T&C sopra — vedi CLAUDE.md per il perché.
    row[I.LIBERATORIA_SITO] = data.libSito ? 'SI' : 'NO';
    row[I.LIBERATORIA_SOCIAL] = data.libSocial ? 'SI' : 'NO';
    row[I.LIBERATORIA_STAMPA] = data.libStampa ? 'SI' : 'NO';
    row[I.LIBERATORIA_VIDEO] = data.libVideo ? 'SI' : 'NO';

    row[I.DATA_INVIO] = dataInvioStr;
    row[I.ORA_INVIO] = oraInvioStr;
    row[I.SUBMISSION_IP] = 'Web App';
    row[I.SUBMISSION_URL] = CONFIG.PORTAL_BASE_URL || 'https://{{DOMINIO}}';
    row[I.SUBMISSION_ID] = submissionId;

    // 3. Scrittura sul foglio
    sheet.appendRow(row);
    SpreadsheetApp.flush();

    traceLog_('[ModuloIscrizioneWebApp] Nuova iscrizione registrata via WebApp: ' + submissionId + ' (' + data.tipoAssociato + ')');

    // 4. Trigger del Router per inviare Mail 1 e avviare automazione
    try {
      RouterModuli({ changeType: 'INSERT_ROW' });
    } catch (errRouter) {
      traceLog_('[ModuloIscrizioneWebApp] Avviso RouterModuli: ' + errRouter.toString());
    }

    // Il pagamento (solo Soci Ordinari) non avviene qui: la Presidenza valuta
    // prima la domanda, poi la mail di ammissione invita a completare
    // l'iscrizione e pagare tramite il modulo di Fase 2 (16_ModuloPagamentoWebApp.gs).

    return {
      success: true,
      submissionId: submissionId,
      idPratica: idPratica,
      message: 'Iscrizione completata con successo!'
    };

  } catch (err) {
    traceLog_('[ModuloIscrizioneWebApp] Errore salvataggio: ' + err.toString());
    return {
      success: false,
      error: err.toString()
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Genera il prossimo ID Pratica nel formato "PR-XXXXX" (zero-padded a 5 cifre),
 * scandendo i valori già presenti in colonna AB. Va chiamata sempre dentro al
 * lock di `salvaModuloIscrizione` per evitare collisioni tra invii concorrenti.
 */
function generaProssimoIdPratica_(sheet) {
  const I = CONFIG.IDX;
  const lastRow = sheet.getLastRow();
  let max = 0;
  if (lastRow >= 2) {
    const valori = sheet.getRange(2, I.ID_PRATICA + 1, lastRow - 1, 1).getValues();
    valori.forEach(function(r) {
      const m = String(r[0] || '').trim().toUpperCase().match(/^PR-(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
  }
  const prossimo = max + 1;
  return 'PR-' + String(prossimo).padStart(5, '0');
}
