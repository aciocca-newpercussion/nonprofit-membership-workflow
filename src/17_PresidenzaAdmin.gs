/**
 * MODULO: 17_PresidenzaAdmin.gs
 * ══════════════════════════════════════════════════════════════════════
 * Pannello web per la Presidenza: ammissione, rigetto e chiusura del rapporto
 * associativo, con vista completa di tutti i dati collegati.
 *
 * Il pannello esegue le decisioni degli organi, non le prende al posto loro.
 * Lo Statuto assegna l'ammissione e il rigetto alla Presidenza, che può
 * delegarli a un componente (Art. 8.3, con ratifica entro 10 giorni), ma
 * riserva l'espulsione all'Assemblea dei Soci, su proposta della Presidenza e
 * dopo contraddittorio (Art. 9.3). Per questo l'espulsione qui è in due tempi
 * e non esiste un bottone che espella da solo.
 *
 * Vive nello STESSO progetto GAS bound al foglio (non nel Portale Membri
 * standalone, 9_MembroPortal.gs) perché riusa direttamente la pipeline di
 * onboarding/rifiuto già presente in 2_TriggerAmmissione.gs: verificaPrecondizioni_,
 * eseguiOnboarding_, eseguiRifiuto_, CONFIG.IDX, traceLog_, LockService.
 *
 * Servito dal router unico doGet() in 15_ModuloIscrizioneWebApp.gs
 * quando l'URL contiene ?pagina=presidenza.
 *
 * IMPORTANTE — perché niente onEdit:
 * TriggerAmmissione/TriggerCancellazioneAbbonamento sono trigger onEdit,
 * che scattano SOLO per modifiche fatte a mano nell'interfaccia Sheets, mai
 * per scritture da script/API. Le azioni di questo pannello scrivono le
 * celle e poi richiamano DIRETTAMENTE la logica di dominio (stesso pattern
 * di recoveryOnboardingManuale_ in 2_TriggerAmmissione.gs), senza aspettare
 * un trigger che non scatterebbe mai.
 *
 * Funzioni esposte al client (google.script.run):
 *  presidenzaListaRichieste()              → dati per la dashboard
 *  presidenzaAmmetti(idPratica,...)        → ammette e avvia l'onboarding
 *  presidenzaRifiuta(idPratica, motivo)    → rifiuta (+ rimborso se dovuto)
 *  presidenzaProponiEspulsione(id, motivo, senzaAvviso)
 *                                          → proposta della Presidenza + invito
 *                                             al contraddittorio (Art. 9.3);
 *                                             nessun effetto sulla posizione
 *  presidenzaEspelli(id, motivo, delibera) → esegue l'espulsione deliberata
 *                                             dall'Assemblea (estremi del
 *                                             verbale obbligatori)
 *  presidenzaAnnullaPropostaEspulsione(id, esito)
 *                                          → ritira la proposta
 *  presidenzaRegistraCessazione(id, causa, dettaglio, data)
 *                                          → decadenza, recesso, incapacità,
 *                                             decesso (Art. 9.1)
 *  presidenzaRegistraRatifica(id, riferimento)
 *                                          → ratifica della Presidenza sulla
 *                                             decisione del delegato (Art. 8.3)
 *  presidenzaAggiornaAnagrafica(id, campi) → corregge nome/cognome/CF/data di
 *                                             nascita/sesso/email/telefono
 *  presidenzaSalvaNota(id, nota)           → nota interna Presidenza (foglio
 *                                             a parte, vedi più sotto)
 *  presidenzaCronologia(id)                → modifiche registrate nello
 *                                             Storico per questa domanda
 *
 * Tutte accettano ora un `idToken` finale opzionale — vedi
 * `18_PresidenzaAdminAPI.gs`, che le riusa per esporre la stessa
 * dashboard/azioni come JSON su HTTP puro all'app iOS (Menù → Gestione →
 * "Richieste di ammissione"), senza duplicare la logica qui sopra. Il
 * pannello web non passa mai quel parametro: comportamento identico a prima.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT WEB APP
// ─────────────────────────────────────────────────────────────────────────────

function doGetPresidenzaAdmin(e) {
  const userEmail = Session.getActiveUser().getEmail();
  if (!userEmail) {
    return _erroreAccessoPresidenza_('Sessione non disponibile',
      'Accedi con il tuo account Google Workspace {{NOME_GRUPPO}} per continuare.');
  }
  if (!presidenzaUtenteAutorizzato_(userEmail)) {
    return _erroreAccessoPresidenza_('Accesso riservato alla Presidenza',
      `Questa sezione è visibile solo ai membri del gruppo <strong>${CONFIG.WORKSPACE_GROUPS['Presidenza']}</strong>.<br>
       Sei collegato come <strong>${userEmail}</strong>.`);
  }

  const template = HtmlService.createTemplateFromFile('PresidenzaAdminHTML');
  template.userInitial = (userEmail.charAt(0) || '?').toUpperCase();
  template.logoUrl = CONFIG.LOGO_URL;
  // Deep-link da una notifica Chat (?idPratica=PR-00001): apre il pannello
  // già sullo sheet dettaglio della pratica — vedi bootstrap in PresidenzaAdminHTML.
  template.idPraticaDeepLink = String((e && e.parameter && e.parameter.idPratica) || '').trim().toUpperCase();
  return template.evaluate()
    .setTitle('Presidenza — ' + CONFIG.NOME_GRUPPO)
    .setFaviconUrl(CONFIG.LOGO_URL)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function _erroreAccessoPresidenza_(titolo, msgHtml) {
  const html = `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${titolo}</title>
<style>
:root{--blu:{{COLORE_BLU}};--arancio:{{COLORE_ARANCIO}};--beige:{{COLORE_BEIGE}};}
*{box-sizing:border-box;}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif;
  background:var(--beige);display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;}
.card{background:#fff;border-radius:20px;padding:40px 32px;max-width:420px;text-align:center;
  box-shadow:0 8px 32px rgba(44,51,133,0.12);}
img{width:56px;border-radius:14px;margin-bottom:20px;}
h2{color:var(--blu);margin:0 0 12px;font-size:20px;letter-spacing:-0.3px;}
p{color:#424245;line-height:1.6;font-size:14.5px;margin:0;}
a{color:var(--blu);font-weight:600;}
</style></head>
<body><div class="card">
  <img src="${CONFIG.LOGO_URL}" alt="Logo {{NOME_GRUPPO}}">
  <h2>${titolo}</h2>
  <p>${msgHtml}</p>
  <p style="margin-top:20px;font-size:12.5px;color:#86868B;">
    <a href="mailto:${CONFIG.EMAIL_MITTENTE}">Contatta ${CONFIG.EMAIL_MITTENTE}</a>
  </p>
</div></body></html>`;
  return HtmlService.createHtmlOutput(html).setTitle(titolo);
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTORIZZAZIONE — membro del gruppo Google "Presidenza"
// ─────────────────────────────────────────────────────────────────────────────

function presidenzaUtenteAutorizzato_(email) {
  if (!email) return false;
  const emailNorm = String(email).toLowerCase().trim();
  const groupEmail = CONFIG.WORKSPACE_GROUPS['Presidenza'];

  try {
    const res = AdminDirectory.Members.hasMember(groupEmail, emailNorm);
    if (res && res.isMember) return true;
    // hasMember ha risposto ma la persona non è nel gruppo: niente fallback silenzioso,
    // se non è in allowlist resta non autorizzata.
  } catch (err) {
    traceLog_('[PresidenzaAdmin] WARN verifica gruppo fallita, uso fallback: ' + err.message);
  }

  // Rete di sicurezza se AdminDirectory non risponde (scope non ancora propagato, ecc.):
  // gli stessi indirizzi già trattati come admin altrove nel sistema.
  return emailNorm === CONFIG.EMAIL_MITTENTE.toLowerCase()
      || emailNorm === CONFIG.EMAIL_ADMIN_ERRORI.toLowerCase();
}

/**
 * Richiamata a inizio di ogni azione server-side: non fidarsi mai del client.
 *
 * `idToken` è il ponte verso l'app iOS (vedi `18_PresidenzaAdminAPI.gs`): il
 * pannello web arriva con una sessione Google vera (`Session.getActiveUser()`
 * non è mai vuoto lì), l'app no — chiama questa stessa funzione via HTTP
 * puro, senza cookie di sessione. Quando la sessione è vuota e un idToken è
 * stato passato, lo si verifica e si usa quell'email al suo posto. Per il
 * pannello web (che non passa mai `idToken`) il comportamento non cambia di
 * una riga: `idToken` resta `undefined` e il ramo nuovo non si attiva mai.
 */
function _presidenzaRichiedeAutorizzazione_(idToken) {
  let email = Session.getActiveUser().getEmail();
  if (!email && idToken) {
    email = _presidenzaVerificaIdToken_(idToken);
  }
  if (!presidenzaUtenteAutorizzato_(email)) {
    throw new Error('Accesso negato: "' + (email || 'utente sconosciuto') + '" non risulta membro della Presidenza.');
  }
  return email;
}

// ─────────────────────────────────────────────────────────────────────────────
// LETTURA DATI — dashboard
// ─────────────────────────────────────────────────────────────────────────────

function presidenzaListaRichieste(idToken) {
  const utente = _presidenzaRichiedeAutorizzazione_(idToken);

  const ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  const data  = sheet.getDataRange().getValues();
  const I     = CONFIG.IDX;
  const notePresidenza = _leggiNotePresidenza_(ss);

  const righe = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const tipo = r[I.TIPO_ASSOCIATO];
    if (!tipo) continue; // riga vuota

    const dati = getDatiAnagrafici_(r, tipo);
    if (!dati.nome && !dati.cognome && !r[I.ID_PRATICA]) continue;

    let genitore = null;
    if (tipo === 'Volontario') {
      const cfG  = String(r[I.CF_GENITORE]||'').trim().toUpperCase();
      const idPG = String(r[I.ID_PRATICA_GENITORE]||'').trim().toUpperCase();
      if (cfG && idPG) {
        const g = cercaGenitore_(sheet, cfG, idPG);
        if (g.trovato) {
          genitore = {
            nome: g.nome, cognome: g.cognome,
            statoDomanda: g.statoDomanda, statoPagamento: g.statoPagamento,
            inRegola: genitoreInRegola_(g),
          };
        } else {
          genitore = { trovato: false };
        }
      }
    }

    // Solo per i Volontari: contatto di chi ha firmato/compilato il modulo
    // come genitore al momento dell'invio — diverso dal "genitore collegato"
    // sopra, che è invece lo stato della *sua* eventuale iscrizione come
    // Socio. Le stesse colonne NOME_SOCIO/COGNOME_SOCIO/EMAIL_SOCIO/TEL_SOCIO
    // portano il firmatario quando TIPO_ASSOCIATO è "Volontario" — vedi
    // `salvaModuloIscrizione` in 15_ModuloIscrizioneWebApp.gs.
    let firmatario = null;
    if (tipo === 'Volontario') {
      const fNome = r[I.NOME_SOCIO] || '', fCognome = r[I.COGNOME_SOCIO] || '';
      if (fNome || fCognome || r[I.EMAIL_SOCIO] || r[I.TEL_SOCIO]) {
        firmatario = { nome: fNome, cognome: fCognome, email: r[I.EMAIL_SOCIO] || '', telefono: r[I.TEL_SOCIO] || '' };
      }
    }

    const sesso = tipo === 'Socio Ordinario' ? (r[I.SESSO_SOCIO] || '') : (r[I.SESSO_VOLONTARIO] || '');
    const causaCess = cessazioneRegistrata_(r);

    righe.push({
      riga: i + 1,
      idPratica: r[I.ID_PRATICA] || '',
      tipo: tipo,
      nome: dati.nome, cognome: dati.cognome, cf: dati.cf, sesso: sesso,
      dataNascita: _fmtDataPresidenza_(dati.dataNascita),
      email: dati.email, telefono: dati.tel,
      dataSubmission: _fmtDataOraPresidenza_(r[I.DATA_SUBMISSION]) || _fmtDataPresidenza_(r[I.DATA_INVIO]),
      // ISO, per i filtri per intervallo di date lato client — le stringhe
      // sopra sono già in italiano e non vanno riparse.
      dataSubmissionISO: _isoPresidenza_(r[I.DATA_SUBMISSION]) || _isoPresidenza_(r[I.DATA_INVIO]),
      emailIstituzionale: r[I.EMAIL_ISTITUZIONALE] || '',
      stato: r[I.STATO_DOMANDA] || 'In Corso',
      dataAmmissione: _fmtDataPresidenza_(r[I.DATA_AMMISSIONE]),
      gruppo: r[I.GRUPPO] || '',
      motivoRifiuto: r[I.RIFIUTATO_PERCHE] || '',
      statoPagamento: r[I.STATO_PAGAMENTO] || '',
      membroUfficiale: r[I.MEMBRO_UFFICIALE] === 'SI',
      espulso: !!String(r[I.ESPULSO]||'').trim(),
      espulsoPerche: r[I.ESPULSO_PERCHE] || '',
      // Ciclo di vita associativo (Statuto Artt. 8–9). `causaCessazione` è la
      // chiave canonica, `causaCessazioneLabel` la parola da mostrare:
      // 'Incapacita' è un identificatore, non una cosa da scrivere in una card.
      deliberaRif: _valorePresidenza_(r[I.DELIBERA_RIF]),
      causaCessazione: causaCess,
      causaCessazioneLabel: causaCess ? etichettaCausaCessazione_(causaCess) : '',
      causaCessazioneArticolo: causaCess && CONFIG.CAUSE_CESSAZIONE[causaCess]
        ? CONFIG.CAUSE_CESSAZIONE[causaCess].articolo : '',
      dataCessazione: _fmtDataPresidenza_(r[I.DATA_CESSAZIONE]),
      cessato: !!causaCess,
      espulsioneProposta: _fmtDataPresidenza_(r[I.ESPULSIONE_PROPOSTA_IL]),
      riferimentoCessazione: _valorePresidenza_(r[I.RIFERIMENTO_CESSAZIONE]),
      dataScadenzaQuota: _fmtDataPresidenza_(r[I.DATA_SCADENZA_QUOTA]),
      dataUltimoRinnovo: _fmtDataPresidenza_(r[I.DATA_ULTIMO_RINNOVO]),
      ruoloAssociativo: r[I.RUOLO_ASSOCIATIVO] || '',
      noteAbilita: r[I.NOTE_ABILITA_MUSICALI] || '',
      cfGenitore: r[I.CF_GENITORE] || '',
      idPraticaGenitore: r[I.ID_PRATICA_GENITORE] || '',
      genitore: genitore,
      firmatario: firmatario,
      indirizzoPagante: r[I.PAYER_ADDRESS] || '',
      fileDocIdentita: r[I.FILE_DOC_IDENTITA] || '',
      firmaPresente: !!(r[I.FIRMA_SOCIO] || r[I.FIRMA_GENITORE]),
      consensi: {
        politiche: r[I.TC_POLITICHE] === 'Accetto',
        privacy:   r[I.TC_PRIVACY]   === 'Accetto',
        statuto:   r[I.TC_STATUTO]   === 'Accetto',
      },
      // Liberatoria immagini/video: facoltativa, granulare per canale — vedi
      // 15_ModuloIscrizioneWebApp.gs. Sulle domande raccolte prima di questa
      // funzionalità le colonne valgono '-' (non richiesta), che qui risulta
      // comunque "non autorizzato": corretto, perché in entrambi i casi la
      // Presidenza non ha un'autorizzazione da usare.
      liberatoria: {
        sito:   r[I.LIBERATORIA_SITO]   === 'SI',
        social: r[I.LIBERATORIA_SOCIAL] === 'SI',
        stampa: r[I.LIBERATORIA_STAMPA] === 'SI',
        video:  r[I.LIBERATORIA_VIDEO]  === 'SI',
        // Valorizzate solo se qualcuno ha revocato o concesso dopo l'intake:
        // sull'invio originale la data è quella della domanda.
        aggiornataIl: _fmtDataOraPresidenza_(r[I.LIBERATORIA_AGGIORNATA_IL]),
        aggiornataDa: String(r[I.LIBERATORIA_AGGIORNATA_DA] || '').replace(/^-$/, '').trim(),
      },
      workspaceEsito: r[I.CREAZIONE_UTENTE_GOOGLE] || '',
      m365Esito: r[I.CREAZIONE_UTENTE_M365] || '',
      hasStripeSub: String(r[I.STRIPE_SUB_ID]||'').trim().startsWith('sub_'),
      ultimaModifica: _fmtDataOraPresidenza_(r[I.LAST_UPDATE]),
      notaPresidenza: notePresidenza[String(r[I.ID_PRATICA]||'').trim().toUpperCase()] || null,
    });
  }

  // Più recenti prima.
  righe.sort((a, b) => b.riga - a.riga);

  return {
    utente: utente,
    gruppi: Object.keys(CONFIG.WORKSPACE_GROUPS),
    righe: righe,
    linkFoglio: getLinkFoglioGoogle_(),
  };
}

function _isoPresidenza_(d) {
  if (!d) return '';
  try {
    const o = (d instanceof Date) ? d : new Date(d);
    return isNaN(o.getTime()) ? '' : o.toISOString();
  } catch(e) { return ''; }
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTE INTERNE DELLA PRESIDENZA — foglio a parte, non una colonna nuova su
// "Risposte". Il foglio principale è già usato da una pipeline complessa con
// job differiti e colonne monitorate per lo storico (COLS_STORICO_1BASED):
// aggiungerne una in mezzo o in coda per un'annotazione libera avrebbe
// rischiato di disallineare quell'elenco o di scrivere su una colonna che
// un'altra sessione aveva già riservato ad altro. Un foglio proprio, creato
// al bisogno come "Storico" (vedi `logModifica_`), non tocca nulla di
// esistente.
// ─────────────────────────────────────────────────────────────────────────────

const NOME_FOGLIO_NOTE_PRESIDENZA = 'Note Presidenza';

function _foglioNotePresidenza_(ss) {
  let foglio = ss.getSheetByName(NOME_FOGLIO_NOTE_PRESIDENZA);
  if (!foglio) {
    foglio = ss.insertSheet(NOME_FOGLIO_NOTE_PRESIDENZA);
    foglio.appendRow(['ID Pratica', 'Nota', 'Aggiornata da', 'Aggiornata il']);
    foglio.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('{{COLORE_BLU}}').setFontColor('#FFFFFF');
    traceLog_('[PresidenzaAdmin] Foglio "' + NOME_FOGLIO_NOTE_PRESIDENZA + '" creato.');
  }
  return foglio;
}

/** Mappa idPratica (maiuscolo) → {testo, autore, data} per una lettura sola. */
function _leggiNotePresidenza_(ss) {
  const foglio = ss.getSheetByName(NOME_FOGLIO_NOTE_PRESIDENZA);
  const mappa = {};
  if (!foglio || foglio.getLastRow() < 2) return mappa;
  const valori = foglio.getRange(2, 1, foglio.getLastRow() - 1, 4).getValues();
  valori.forEach(function(r) {
    const id = String(r[0] || '').trim().toUpperCase();
    const testo = String(r[1] || '').trim();
    if (!id || !testo) return;
    mappa[id] = { testo: testo, autore: r[2] || '', data: _fmtDataOraPresidenza_(r[3]) };
  });
  return mappa;
}

/**
 * Crea o aggiorna la nota interna di una domanda. Una nota vuota elimina la
 * riga (non ha senso tenere una riga "nota: vuota" nel foglio).
 */
function presidenzaSalvaNota(idPratica, nota, idToken) {
  const autore = _presidenzaRichiedeAutorizzazione_(idToken);

  const idTarget = String(idPratica || '').trim().toUpperCase();
  if (!idTarget) throw new Error('ID Pratica mancante.');
  const testo = String(nota || '').trim();

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const foglio = _foglioNotePresidenza_(ss);
    const lastRow = foglio.getLastRow();
    let rigaEsistente = -1;
    if (lastRow >= 2) {
      const idColonna = foglio.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < idColonna.length; i++) {
        if (String(idColonna[i][0] || '').trim().toUpperCase() === idTarget) { rigaEsistente = i + 2; break; }
      }
    }

    if (!testo) {
      if (rigaEsistente > 0) foglio.deleteRow(rigaEsistente);
      return { ok: true, testo: '' };
    }

    if (rigaEsistente > 0) {
      foglio.getRange(rigaEsistente, 2, 1, 3).setValues([[testo, autore, new Date()]]);
    } else {
      foglio.appendRow([idTarget, testo, autore, new Date()]);
    }
    return { ok: true, testo: testo, autore: autore };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODIFICA ANAGRAFICA — corregge i dati che il richiedente ha scritto,
// prima di Ammettere (es. un errore di battitura nel codice fiscale).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggiorna nome/cognome/CF/data di nascita/sesso/email/telefono della persona
 * sotto esame — esattamente gli stessi sei-sette campi che
 * `getDatiAnagrafici_` legge per costruire email istituzionale, tessera ed
 * email transazionali, quindi scrive sulle stesse colonne da cui legge
 * (NOME_SOCIO/... per un Socio Ordinario, NOME_VOLONTARIO/... per un
 * Volontario). Non tocca il contatto del firmatario/genitore (altre
 * colonne, non esposte in modifica qui) né alcuna colonna gestionale
 * (stato, gruppo, pagamento). Ogni campo cambiato è registrato nello
 * Storico, uno per uno.
 *
 * ⚠️ Non rinomina un account già creato: se la domanda è già Ammessa,
 * l'email istituzionale e l'account restano quelli generati al momento
 * dell'ammissione. Il chiamante (client) lo segnala all'utente.
 */
function presidenzaAggiornaAnagrafica(idPratica, campi, idToken) {
  const autore = _presidenzaRichiedeAutorizzazione_(idToken);
  campi = campi || {};

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
    const { row, rowData } = _presidenzaTrovaRiga_(sheet, idPratica);
    const I = CONFIG.IDX;
    const tipo = rowData[I.TIPO_ASSOCIATO];
    const datiPrima = getDatiAnagrafici_(rowData, tipo);
    const idP = rowData[I.ID_PRATICA] || idPratica;

    const colonne = tipo === 'Socio Ordinario'
      ? { nome: I.NOME_SOCIO, cognome: I.COGNOME_SOCIO, cf: I.CF_SOCIO, dataNascita: I.DATA_NASCITA_SOCIO, sesso: I.SESSO_SOCIO, email: I.EMAIL_SOCIO, telefono: I.TEL_SOCIO }
      : { nome: I.NOME_VOLONTARIO, cognome: I.COGNOME_VOLONTARIO, cf: I.CF_VOLONTARIO, dataNascita: I.DATA_NASCITA_VOLONTARIO, sesso: I.SESSO_VOLONTARIO, email: I.EMAIL_VOLONTARIO, telefono: I.TEL_VOLONTARIO };

    const valoriPrima = {
      nome: datiPrima.nome, cognome: datiPrima.cognome, cf: datiPrima.cf,
      dataNascita: _fmtDataPresidenza_(datiPrima.dataNascita), email: datiPrima.email, telefono: datiPrima.tel,
      sesso: tipo === 'Socio Ordinario' ? (rowData[I.SESSO_SOCIO]||'') : (rowData[I.SESSO_VOLONTARIO]||''),
    };

    const nomeCampo = { nome: 'Nome', cognome: 'Cognome', cf: 'Codice fiscale', dataNascita: 'Data di nascita', sesso: 'Sesso', email: 'Email', telefono: 'Telefono' };
    let modificati = 0;

    Object.keys(colonne).forEach(function(campo) {
      if (!(campo in campi)) return; // il client manda solo i campi cambiati
      const colIdx = colonne[campo];
      let nuovoValore = campi[campo];

      if (campo === 'dataNascita') {
        // Accetta "YYYY-MM-DD" (input nativo di un date picker), come
        // salvaModuloIscrizione: costruito per componenti per evitare uno
        // scostamento di fuso orario sulla mezzanotte.
        const m = String(nuovoValore || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) nuovoValore = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      } else if (campo === 'telefono') {
        // Stesso guard dell'intake: un valore che comincia con "+" verrebbe
        // altrimenti interpretato come formula da Sheets.
        const val = String(nuovoValore || '').trim();
        nuovoValore = val ? "'" + val : '';
      } else if (campo === 'cf' || campo === 'sesso') {
        nuovoValore = String(nuovoValore || '').toUpperCase().trim();
      } else {
        nuovoValore = String(nuovoValore || '').trim();
      }

      const vecchioValoreConfronto = campo === 'dataNascita' ? valoriPrima.dataNascita : valoriPrima[campo];
      const nuovoValoreConfronto = campo === 'dataNascita' ? _fmtDataPresidenza_(nuovoValore) : nuovoValore;
      if (String(vecchioValoreConfronto || '') === String(nuovoValoreConfronto || '')) return; // invariato

      sheet.getRange(row, colIdx + 1).setValue(nuovoValore);
      try {
        logModifica_(row, nomeCampo[campo], vecchioValoreConfronto, nuovoValoreConfronto, idP, datiPrima.nome + ' ' + datiPrima.cognome);
      } catch(e) {}
      modificati++;
    });

    if (modificati > 0) {
      sheet.getRange(row, I.LAST_UPDATE + 1).setValue(new Date());
      SpreadsheetApp.flush();
    }

    const rowDataFresh = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    const datiDopo = getDatiAnagrafici_(rowDataFresh, tipo);
    return {
      ok: true,
      modificati: modificati,
      messaggio: modificati > 0 ? ('Aggiornati ' + modificati + ' campi.') : 'Nessun campo era cambiato.',
      nome: datiDopo.nome, cognome: datiDopo.cognome, cf: datiDopo.cf,
      dataNascita: _fmtDataPresidenza_(datiDopo.dataNascita), email: datiDopo.email, telefono: datiDopo.tel,
      sesso: tipo === 'Socio Ordinario' ? (rowDataFresh[I.SESSO_SOCIO]||'') : (rowDataFresh[I.SESSO_VOLONTARIO]||''),
    };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AZIONE — LIBERATORIA IMMAGINI E VIDEO
// Il modulo di iscrizione promette che il consenso si può revocare in qualsiasi
// momento scrivendo a direzione@: senza questa azione l'unico modo sarebbe
// editare BL–BO a mano sul foglio, senza traccia di chi l'ha fatto e quando —
// cioè senza la prova che serve proprio sulla revoca.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggiorna i quattro canali della liberatoria (sito, social, stampa, video).
 * `canali` contiene **solo** i canali da cambiare, con valore booleano: un
 * canale assente non viene toccato — stesso contratto di
 * `presidenzaAggiornaAnagrafica`, così il client manda solo il delta.
 *
 * Ogni canale cambiato finisce nello Storico uno per uno (`TriggerStorico` non
 * scatta per le scritture da script), e BP/BQ registrano quando e da chi:
 * per una revoca la data conta quanto il consenso iniziale.
 */
function presidenzaAggiornaLiberatoria(idPratica, canali, idToken) {
  const autore = _presidenzaRichiedeAutorizzazione_(idToken);
  canali = canali || {};

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
    const { row, rowData } = _presidenzaTrovaRiga_(sheet, idPratica);
    const I = CONFIG.IDX;
    const tipo = rowData[I.TIPO_ASSOCIATO];
    const dati = getDatiAnagrafici_(rowData, tipo);
    const idP  = rowData[I.ID_PRATICA] || idPratica;

    _assicuraColonne_(sheet, I.LIBERATORIA_AGGIORNATA_DA + 1);

    const colonne = {
      sito:   I.LIBERATORIA_SITO,
      social: I.LIBERATORIA_SOCIAL,
      stampa: I.LIBERATORIA_STAMPA,
      video:  I.LIBERATORIA_VIDEO,
    };
    const nomeCanale = {
      sito:   'Liberatoria sito web (BL)',
      social: 'Liberatoria social (BM)',
      stampa: 'Liberatoria materiale stampato (BN)',
      video:  'Liberatoria video (BO)',
    };

    let modificati = 0;

    Object.keys(colonne).forEach(function(canale) {
      if (!(canale in canali)) return; // il client manda solo i canali cambiati
      const colIdx = colonne[canale];
      // Le domande antecedenti alla liberatoria valgono '-' (mai chiesta): nello
      // Storico va registrato com'era davvero, non normalizzato a 'NO'.
      const vecchio = String(rowData[colIdx] || '').trim() || '-';
      const nuovo   = canali[canale] ? 'SI' : 'NO';
      if (vecchio === nuovo) return; // invariato

      sheet.getRange(row, colIdx + 1).setValue(nuovo);
      try {
        logModifica_(row, nomeCanale[canale], vecchio, nuovo, idP, (dati.nome + ' ' + dati.cognome).trim());
      } catch(e) {}
      modificati++;
    });

    if (modificati > 0) {
      const adesso = new Date();
      sheet.getRange(row, I.LIBERATORIA_AGGIORNATA_IL + 1).setValue(adesso);
      sheet.getRange(row, I.LIBERATORIA_AGGIORNATA_DA + 1).setValue(autore);
      sheet.getRange(row, I.LAST_UPDATE + 1).setValue(adesso);
      SpreadsheetApp.flush();
      traceLog_('[Presidenza] Liberatoria aggiornata su ' + idP + ': ' + modificati + ' canali, da ' + autore);
    }

    const rowDataFresh = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    return {
      ok: true,
      modificati: modificati,
      messaggio: modificati > 0
        ? ('Liberatoria aggiornata: ' + modificati + (modificati === 1 ? ' canale.' : ' canali.'))
        : 'Nessun canale era cambiato.',
      liberatoria: {
        sito:   rowDataFresh[I.LIBERATORIA_SITO]   === 'SI',
        social: rowDataFresh[I.LIBERATORIA_SOCIAL] === 'SI',
        stampa: rowDataFresh[I.LIBERATORIA_STAMPA] === 'SI',
        video:  rowDataFresh[I.LIBERATORIA_VIDEO]  === 'SI',
      },
      aggiornataIl: _fmtDataOraPresidenza_(rowDataFresh[I.LIBERATORIA_AGGIORNATA_IL]),
      aggiornataDa: String(rowDataFresh[I.LIBERATORIA_AGGIORNATA_DA] || '').replace(/^-$/, '').trim(),
    };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRONOLOGIA — riusa il foglio "Storico" già scritto da `logModifica_`
// (chiamato sia dai trigger onEdit sia dalle azioni di questo pannello):
// una sola fonte per ogni modifica mai fatta a una riga, non un registro a
// parte per le sole modifiche del pannello.
// ─────────────────────────────────────────────────────────────────────────────

function presidenzaCronologia(idPratica, idToken) {
  _presidenzaRichiedeAutorizzazione_(idToken);

  const idTarget = String(idPratica || '').trim().toUpperCase();
  if (!idTarget) throw new Error('ID Pratica mancante.');

  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const storico = ss.getSheetByName(CONFIG.SHEET_STORICO);
  // Stessa forma dell'uscita normale sotto ({voci, troncato}), mai un array
  // grezzo: il client decodifica un solo tipo, non due a seconda del caso.
  if (!storico || storico.getLastRow() < 2) return { voci: [], troncato: false };

  const valori = storico.getRange(2, 1, storico.getLastRow() - 1, 7).getValues();
  const voci = [];
  for (let i = 0; i < valori.length; i++) {
    const r = valori[i];
    if (String(r[1] || '').trim().toUpperCase() !== idTarget) continue;
    voci.push({
      quando: _fmtDataOraPresidenza_(r[0]),
      colonna: r[3] || '',
      vecchioValore: r[4] || '',
      nuovoValore: r[5] || '',
    });
  }
  // Più recenti prima; tetto esplicito, non silenzioso — una singola
  // domanda non dovrebbe avvicinarsi a questo numero di modifiche.
  voci.reverse();
  const troncato = voci.length > 200;
  return { voci: troncato ? voci.slice(0, 200) : voci, troncato: troncato };
}

function _fmtDataPresidenza_(d) {
  if (!d) return '';
  try {
    const o = (d instanceof Date) ? d : new Date(d);
    return isNaN(o.getTime()) ? '' : Utilities.formatDate(o, 'Europe/Rome', 'dd/MM/yyyy');
  } catch(e) { return ''; }
}

function _fmtDataOraPresidenza_(d) {
  if (!d) return '';
  try {
    const o = (d instanceof Date) ? d : new Date(d);
    return isNaN(o.getTime()) ? '' : Utilities.formatDate(o, 'Europe/Rome', 'dd/MM/yyyy HH:mm');
  } catch(e) { return ''; }
}

function _presidenzaTrovaRiga_(sheet, idPratica) {
  const idTarget = String(idPratica || '').trim().toUpperCase();
  if (!idTarget) throw new Error('ID Pratica mancante.');

  const data = sheet.getDataRange().getValues();
  const I = CONFIG.IDX;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][I.ID_PRATICA] || '').trim().toUpperCase() === idTarget) {
      return { row: i + 1, rowData: data[i] };
    }
  }
  throw new Error('ID Pratica "' + idPratica + '" non trovata nel foglio.');
}

// ─────────────────────────────────────────────────────────────────────────────
// AZIONE — AMMETTI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ammette una domanda e avvia subito l'onboarding (niente attesa di 5 minuti:
 * qui la Presidenza fornisce Gruppo/Ruolo in un solo passaggio dal pannello).
 */
// ─────────────────────────────────────────────────────────────────────────────
// DELIBERE SU AMMISSIONE E RIGETTO (Statuto Art. 8.3)
// ─────────────────────────────────────────────────────────────────────────────
//
// L'Art. 8.3 assegna la decisione alla Presidenza come organo e le consente di
// delegarla al legale rappresentante o a un componente. Chi agisce dal pannello
// è quel delegato: la sua decisione «è soggetta a ratifica della Presidenza
// entro 10 giorni trascorsi i quali si intende comunque consolidata, con
// effetti ex tunc». Il consolidamento tacito la rende valida in ogni caso, ma
// non esonera dall'annotarla — l'art. 15 c.1 lett. a) del D.Lgs. 117/2017 vuole
// la deliberazione annotata nel libro degli associati, e il libro degli
// associati è questo foglio.

/**
 * Scrive in BR chi ha deciso, quando, e entro quando la Presidenza deve
 * ratificare. Non blocca nulla: se l'annotazione fallisce, la decisione resta
 * valida e il fatto resta comunque nello Storico.
 */
function _registraDeliberaDelegato_(sheet, row, tipoDecisione, delegato, quando) {
  try {
    const I = CONFIG.IDX;
    _assicuraColonne_(sheet, I.RIFERIMENTO_CESSAZIONE + 1);
    const scadenza = new Date(quando.getTime() + 10 * 24 * 60 * 60 * 1000);
    sheet.getRange(row, I.DELIBERA_RIF+1).setValue(
      tipoDecisione + ' — decisione del delegato ' + delegato + ' del ' + formatData_(quando) +
      ' (Art. 8.3 Statuto) · ratifica della Presidenza entro il ' + formatData_(scadenza));
  } catch (err) {
    traceLog_('[PresidenzaAdmin] WARN annotazione delibera: ' + err.message);
  }
}

/**
 * Registra la ratifica della Presidenza sulla decisione del delegato, con gli
 * estremi del verbale. Si aggiunge a quanto già annotato invece di sostituirlo:
 * la decisione del delegato e la sua ratifica sono due fatti, e il libro deve
 * conservarli entrambi.
 */
function presidenzaRegistraRatifica(idPratica, riferimento, idToken) {
  const eseguitoDa = _presidenzaRichiedeAutorizzazione_(idToken);

  const rifTrim = String(riferimento || '').trim();
  if (!rifTrim) throw new Error('Servono gli estremi della ratifica (data della riunione di Presidenza e verbale).');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
    const { row, rowData } = _presidenzaTrovaRiga_(sheet, idPratica);
    const I = CONFIG.IDX;

    const precedente = _valorePresidenza_(rowData[I.DELIBERA_RIF]);
    if (!precedente) {
      throw new Error('Su questa pratica non risulta annotata nessuna decisione da ratificare.');
    }
    if (precedente.indexOf('Ratificata') !== -1) {
      return { ok: true, messaggio: 'Questa decisione risultava già ratificata.' };
    }

    _assicuraColonne_(sheet, I.RIFERIMENTO_CESSAZIONE + 1);
    const ora   = new Date();
    const nuovo = precedente + ' · Ratificata il ' + formatData_(ora) + ' — ' + rifTrim + ' (' + eseguitoDa + ')';
    sheet.getRange(row, I.DELIBERA_RIF+1).setValue(nuovo);
    SpreadsheetApp.flush();

    const tipo = rowData[I.TIPO_ASSOCIATO];
    const dati = getDatiAnagrafici_(rowData, tipo);
    try {
      logModifica_(row, 'Delibera / ratifica (BR)', precedente, nuovo,
        rowData[I.ID_PRATICA]||idPratica, dati.nome+' '+dati.cognome);
    } catch(e) {}

    return { ok: true, messaggio: 'Ratifica registrata (Art. 8.3 Statuto).' };
  } finally {
    lock.releaseLock();
  }
}

function presidenzaAmmetti(idPratica, gruppo, ruoloAssociativo, idToken) {
  const eseguitoDa = _presidenzaRichiedeAutorizzazione_(idToken);

  if (!gruppo || !Object.keys(CONFIG.WORKSPACE_GROUPS).includes(gruppo)) {
    throw new Error('Gruppo non valido. Valori ammessi: ' + Object.keys(CONFIG.WORKSPACE_GROUPS).join(', '));
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
    const { row, rowData } = _presidenzaTrovaRiga_(sheet, idPratica);
    const I = CONFIG.IDX;

    if (String(rowData[I.ESPULSO]||'').trim()) {
      throw new Error('Questa persona risulta espulsa. Rimuovi manualmente il flag "Espulso" (AQ) sul foglio prima di riammetterla.');
    }
    const causaCess = cessazioneRegistrata_(rowData);
    if (causaCess) {
      throw new Error('Il rapporto associativo risulta cessato per ' + etichettaCausaCessazione_(causaCess) +
        '. Una nuova adesione è una domanda nuova: svuota "Causa cessazione" (BS) e "Data cessazione" (BT) ' +
        'solo se la cessazione era stata registrata per errore.');
    }
    if (rowData[I.MEMBRO_UFFICIALE] === 'SI') {
      return { ok: true, messaggio: 'Questa persona è già Membro ufficiale — nessuna azione necessaria.' };
    }

    const statoPrima = rowData[I.STATO_DOMANDA] || 'In Corso';
    const tipo = rowData[I.TIPO_ASSOCIATO];
    const dati = getDatiAnagrafici_(rowData, tipo);

    const oraDecisione = new Date();
    sheet.getRange(row, I.STATO_DOMANDA+1).setValue('Ammesso');
    sheet.getRange(row, I.DATA_AMMISSIONE+1).setValue(oraDecisione);
    sheet.getRange(row, I.GRUPPO+1).setValue(gruppo);
    _registraDeliberaDelegato_(sheet, row, 'Ammissione', eseguitoDa, oraDecisione);
    if (ruoloAssociativo && String(ruoloAssociativo).trim()) {
      sheet.getRange(row, I.RUOLO_ASSOCIATIVO+1).setValue(String(ruoloAssociativo).trim());
    }

    // Riammissione dopo un rifiuto precedente: MAIL_RISPOSTA_SOCIO/VOLONTARIO è la
    // stessa colonna che eseguiRifiuto_ imposta a 'OK' dopo l'email di rifiuto, ed è
    // il guard che eseguiOnboarding_ usa per non notificare due volte. Senza reset,
    // eseguiOnboarding_ la troverebbe già 'OK' e uscirebbe subito senza creare nulla.
    const colRispIdx = tipo === 'Socio Ordinario' ? I.MAIL_RISPOSTA_SOCIO : I.MAIL_RISPOSTA_VOLONTARIO;
    if (String(rowData[colRispIdx]||'').trim().toUpperCase() === 'OK') {
      sheet.getRange(row, colRispIdx+1).setValue('');
      sheet.getRange(row, I.RIFIUTATO_PERCHE+1).setValue('');
      traceLog_('[PresidenzaAdmin] Riga '+row+': riammessa dopo un rifiuto — reset flag di notifica.');
    }
    SpreadsheetApp.flush();

    try {
      logModifica_(row, 'Stato domanda (AK)', statoPrima, 'Ammesso',
        rowData[I.ID_PRATICA]||idPratica, dati.nome+' '+dati.cognome);
    } catch(e) {}

    const rowDataFresh = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    const check = verificaPrecondizioni_(rowDataFresh, sheet);

    if (!check.ok) {
      if (check.inAttesaLiberatoria) {
        // Non è un errore: è il passaggio nuovo fra ammissione e pagamento.
        // Il pannello non deve mostrare rosso per un'attesa fisiologica.
        libRichiediLiberatoria_(sheet, row, rowDataFresh, 'ammissione dal pannello');
        return { ok: true, messaggio: 'Ammesso. In attesa della liberatoria immagini, video e audio: ' +
                 'l\'invito alla firma è stato inviato. Una risposta negativa va benissimo e sblocca il pagamento.' };
      }
      if (check.inAttesaPagamento) {
        const giaInvitato = String(rowDataFresh[I.MAIL_INVITO_PAGAMENTO]||'').trim().toUpperCase() === 'OK';
        if (!giaInvitato) {
          try {
            inviaEmailInvitoPagamento_(rowDataFresh, rowDataFresh[I.ID_PRATICA]||'N/D');
            sheet.getRange(row, I.MAIL_INVITO_PAGAMENTO+1).setValue('OK');
          } catch(err) {
            sheet.getRange(row, I.MAIL_INVITO_PAGAMENTO+1).setValue('Errore');
            traceLog_('[PresidenzaAdmin] WARN invito pagamento: ' + err.message);
          }
        }
        return { ok: true, messaggio: 'Ammesso. In attesa che il Socio completi il pagamento della quota (invito inviato via email).' };
      }
      if (check.inAttesaGenitore) {
        return { ok: true, messaggio: 'Ammesso. L\'onboarding partirà automaticamente quando il genitore collegato sarà in regola.' };
      }
      return { ok: false, messaggio: 'Ammesso, ma l\'onboarding non è potuto partire: ' + check.motivo };
    }

    eseguiOnboarding_(sheet, row, rowDataFresh);
    return { ok: true, messaggio: 'Ammesso: account Workspace/M365 creati, tessera ed email di benvenuto in arrivo a breve.' };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AZIONE — RIFIUTA
// ─────────────────────────────────────────────────────────────────────────────

function presidenzaRifiuta(idPratica, motivo, idToken) {
  const eseguitoDa = _presidenzaRichiedeAutorizzazione_(idToken);

  const motivoTrim = String(motivo || '').trim();
  if (!motivoTrim) throw new Error('Il motivo del rifiuto è obbligatorio.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
    const { row, rowData } = _presidenzaTrovaRiga_(sheet, idPratica);
    const I = CONFIG.IDX;

    if (rowData[I.MEMBRO_UFFICIALE] === 'SI') {
      throw new Error('Questa persona è già Membro ufficiale. Usa "Espelli" per revocarne la posizione.');
    }

    const tipo = rowData[I.TIPO_ASSOCIATO];
    const colRisp = tipo === 'Socio Ordinario' ? I.MAIL_RISPOSTA_SOCIO : I.MAIL_RISPOSTA_VOLONTARIO;
    if (String(rowData[colRisp]||'').trim().toUpperCase() === 'OK') {
      return { ok: true, messaggio: 'Questa domanda era già stata notificata come rifiutata.' };
    }

    const statoPrima = rowData[I.STATO_DOMANDA] || 'In Corso';
    const dati = getDatiAnagrafici_(rowData, tipo);

    const oraDecisione = new Date();
    sheet.getRange(row, I.STATO_DOMANDA+1).setValue('Rifiutato');
    sheet.getRange(row, I.DATA_AMMISSIONE+1).setValue(oraDecisione);
    sheet.getRange(row, I.RIFIUTATO_PERCHE+1).setValue(motivoTrim);
    _registraDeliberaDelegato_(sheet, row, 'Rigetto', eseguitoDa, oraDecisione);
    SpreadsheetApp.flush();

    try {
      logModifica_(row, 'Stato domanda (AK)', statoPrima, 'Rifiutato',
        rowData[I.ID_PRATICA]||idPratica, dati.nome+' '+dati.cognome);
    } catch(e) {}

    const rowDataFresh = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    eseguiRifiuto_(sheet, row, rowDataFresh);

    return { ok: true, messaggio: 'Domanda rifiutata. Email di notifica inviata al richiedente' +
      (tipo === 'Socio Ordinario' ? ' (con esito rimborso, se dovuto).' : '.') };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AZIONI — CESSAZIONE DEL RAPPORTO ASSOCIATIVO (Statuto Art. 9)
// ─────────────────────────────────────────────────────────────────────────────
//
// L'Art. 9.1 elenca cinque cause di perdita della qualifica di Socio, e non
// sono intercambiabili: cambia l'organo competente, cambia la procedura, cambia
// ciò che il libro degli associati deve poter dimostrare fra dieci anni.
//
//   Espulsione (9.3)  la delibera è dell'ASSEMBLEA, su proposta della
//                     Presidenza, «dopo aver ascoltato l'interessato in
//                     contraddittorio» e di norma preceduta da richiamo
//                     scritto. Sono due momenti distinti, e qui sono due
//                     funzioni distinte: `presidenzaProponiEspulsione` non
//                     tocca né accessi né abbonamento e apre il
//                     contraddittorio; `presidenzaEspelli` esegue soltanto
//                     esibendo gli estremi della delibera assembleare.
//   Decadenza (9.1.b) mancato pagamento della quota: accertata dalla
//                     Presidenza (9.2). Nessuna Assemblea.
//   Recesso (9.5)     comunicazione scritta del Socio al Presidente.
//   Incapacità (9.1.a), Decesso (9.1.e)  accertamento della Presidenza.
//
// Le ultime quattro passano tutte da `presidenzaRegistraCessazione`.
// In nessun caso spetta il rimborso della quota versata (Art. 9.7): il flusso
// cancella l'abbonamento, non rimborsa. Il rimborso esiste solo sul rigetto
// della domanda (Art. 8.5), dove il rapporto non si è mai perfezionato.

/**
 * Converte una data 'YYYY-MM-DD' (input nativo del pannello) in Date costruita
 * per componenti — lo stesso guard dell'intake contro lo scostamento di fuso
 * sulla mezzanotte. Valore vuoto o non riconosciuto → adesso.
 */
function _dataPresidenzaDaInput_(valore) {
  const m = String(valore || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
}

/**
 * Valore "vero" di una cella che le migrazioni riempiono con '-'.
 * `inizializzaColonneAggiuntive` scrive '-' sulle righe già in archivio: vuol
 * dire "mai successo", non un contenuto.
 */
function _valorePresidenza_(v) {
  const s = String(v || '').trim();
  return (s && s !== '-') ? s : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// ESPULSIONE — passo 1: proposta della Presidenza e contraddittorio (Art. 9.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registra la proposta di espulsione e invita l'interessato al contraddittorio.
 * Non produce alcun effetto sulla posizione associativa: il Membro resta tale,
 * gli accessi restano attivi, l'abbonamento non viene toccato. È esattamente il
 * punto — l'unica cosa che l'Art. 9.3 consente alla Presidenza è proporre.
 *
 * `senzaAvviso` serve al caso in cui il contraddittorio si sia già svolto fuori
 * dal pannello: registra la proposta senza far partire un secondo invito.
 */
function presidenzaProponiEspulsione(idPratica, motivo, senzaAvviso, idToken) {
  const eseguitoDa = _presidenzaRichiedeAutorizzazione_(idToken);

  const motivoTrim = String(motivo || '').trim();
  if (!motivoTrim) throw new Error('Il motivo della proposta di espulsione è obbligatorio.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
    const { row, rowData } = _presidenzaTrovaRiga_(sheet, idPratica);
    const I = CONFIG.IDX;

    const causaGia = cessazioneRegistrata_(rowData);
    if (causaGia) {
      return { ok: true, messaggio: 'Il rapporto associativo risulta già cessato (' + etichettaCausaCessazione_(causaGia) + ').' };
    }
    if (rowData[I.MEMBRO_UFFICIALE] !== 'SI') {
      throw new Error('L\'espulsione riguarda solo un Membro ufficiale. Per una domanda ancora in corso si usa "Rifiuta".');
    }
    if (_valorePresidenza_(rowData[I.ESPULSIONE_PROPOSTA_IL])) {
      return { ok: true, messaggio: 'Per questa persona esiste già una proposta di espulsione aperta.' };
    }

    _assicuraColonne_(sheet, I.RIFERIMENTO_CESSAZIONE + 1);

    const tipo = rowData[I.TIPO_ASSOCIATO];
    const dati = getDatiAnagrafici_(rowData, tipo);
    const idP  = rowData[I.ID_PRATICA] || idPratica;
    const ora  = new Date();

    sheet.getRange(row, I.ESPULSIONE_PROPOSTA_IL+1).setValue(ora);
    sheet.getRange(row, I.ESPULSO_PERCHE+1).setValue(motivoTrim);
    SpreadsheetApp.flush();

    let esitoAvviso = '-';
    if (!senzaAvviso) {
      try {
        inviaEmailContraddittorio_(rowData, tipo, motivoTrim, formatData_(ora));
        esitoAvviso = 'OK';
      } catch (err) {
        esitoAvviso = 'Errore: ' + err.message;
        traceLog_('[Espulsione] WARN email contraddittorio: ' + err.message);
      }
    }

    try { inviaNotificaPropostaEspulsione_(rowData, tipo, motivoTrim, eseguitoDa); } catch (err) {}

    try {
      logModifica_(row, 'Espulsione proposta il (BU)', '', formatData_(ora) + ' — ' + motivoTrim,
        idP, dati.nome + ' ' + dati.cognome);
    } catch (e) {}

    traceLog_('=== PROPOSTA ESPULSIONE: ' + dati.nome + ' ' + dati.cognome + ' (' + idP + ') — proposta da ' + eseguitoDa + ' ===');

    return {
      ok: true,
      messaggio: senzaAvviso
        ? 'Proposta registrata. La posizione resta invariata: l\'espulsione la delibera l\'Assemblea (Art. 9.3).'
        : 'Proposta registrata e invito al contraddittorio inviato' + (esitoAvviso === 'OK' ? '' : ' (invio non riuscito: ' + esitoAvviso + ')') +
          '. La posizione resta invariata finché non delibera l\'Assemblea.',
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Ritira la proposta: l'Assemblea l'ha respinta, oppure la Presidenza ci
 * ripensa. Cancella la proposta e la motivazione, e lascia la traccia nello
 * Storico — un procedimento disciplinare aperto e poi chiuso senza esito è
 * parte della posizione del socio quanto una sanzione.
 */
function presidenzaAnnullaPropostaEspulsione(idPratica, esito, idToken) {
  const eseguitoDa = _presidenzaRichiedeAutorizzazione_(idToken);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
    const { row, rowData } = _presidenzaTrovaRiga_(sheet, idPratica);
    const I = CONFIG.IDX;

    const proposta = _valorePresidenza_(rowData[I.ESPULSIONE_PROPOSTA_IL]);
    if (!proposta) return { ok: true, messaggio: 'Non c\'è nessuna proposta di espulsione aperta.' };

    const tipo = rowData[I.TIPO_ASSOCIATO];
    const dati = getDatiAnagrafici_(rowData, tipo);
    const idP  = rowData[I.ID_PRATICA] || idPratica;
    const nota = String(esito || '').trim() || 'Proposta ritirata';

    sheet.getRange(row, I.ESPULSIONE_PROPOSTA_IL+1).setValue('');
    sheet.getRange(row, I.ESPULSO_PERCHE+1).setValue('');
    SpreadsheetApp.flush();

    try {
      logModifica_(row, 'Espulsione proposta il (BU)', _fmtDataPresidenza_(rowData[I.ESPULSIONE_PROPOSTA_IL]),
        nota + ' — ' + eseguitoDa, idP, dati.nome + ' ' + dati.cognome);
    } catch (e) {}

    traceLog_('[Espulsione] Proposta ritirata per ' + idP + ' da ' + eseguitoDa + ' — ' + nota);
    return { ok: true, messaggio: 'Proposta di espulsione ritirata. La posizione del Membro resta piena.' };
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ESPULSIONE — passo 2: delibera dell'Assemblea ed esecuzione (Art. 9.3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Esegue l'espulsione già deliberata dall'Assemblea. Non la decide: la
 * registra ed esegue. Servono due cose, entrambe obbligatorie — una proposta
 * aperta (che è anche la prova che il contraddittorio è stato aperto) e gli
 * estremi della delibera assembleare, che finiscono nel libro degli associati
 * e nell'email al Membro.
 */
function presidenzaEspelli(idPratica, motivo, deliberaAssemblea, idToken) {
  const eseguitoDa = _presidenzaRichiedeAutorizzazione_(idToken);

  const motivoTrim   = String(motivo || '').trim();
  const deliberaTrim = String(deliberaAssemblea || '').trim();
  if (!deliberaTrim) {
    throw new Error('Servono gli estremi della delibera dell\'Assemblea (data e verbale): ' +
      'l\'espulsione è deliberata dall\'Assemblea dei Soci su proposta della Presidenza (Art. 9.3 Statuto).');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
    const { row, rowData } = _presidenzaTrovaRiga_(sheet, idPratica);
    const I = CONFIG.IDX;

    const causaGia = cessazioneRegistrata_(rowData);
    if (causaGia) {
      return { ok: true, messaggio: 'Il rapporto associativo risulta già cessato (' + etichettaCausaCessazione_(causaGia) + ').' };
    }
    if (String(rowData[I.ESPULSO]||'').trim()) {
      return { ok: true, messaggio: 'Questa persona risultava già espulsa.' };
    }
    if (rowData[I.MEMBRO_UFFICIALE] !== 'SI') {
      throw new Error('Solo un Membro ufficiale può essere espulso. Usa "Rifiuta" per una domanda ancora in corso.');
    }
    if (!_valorePresidenza_(rowData[I.ESPULSIONE_PROPOSTA_IL])) {
      throw new Error('Manca la proposta della Presidenza: registrala prima con "Proponi espulsione", ' +
        'che apre anche il contraddittorio previsto dall\'Art. 9.3 dello Statuto.');
    }

    return eseguiCessazione_(sheet, row, rowData, {
      causa: 'Espulsione',
      motivo: motivoTrim || _valorePresidenza_(rowData[I.ESPULSO_PERCHE]),
      riferimento: deliberaTrim,
      dataEfficacia: new Date(),
      eseguitoDa: eseguitoDa,
    });
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LE ALTRE CAUSE — decadenza, recesso, incapacità, decesso
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registra la cessazione del rapporto per una causa diversa dall'espulsione.
 * `dataEfficacia` è quella che conta giuridicamente e non coincide con oggi: per
 * il recesso è la data della comunicazione scritta al Presidente (Art. 9.5), per
 * la decadenza quella dell'accertamento della Presidenza.
 */
function presidenzaRegistraCessazione(idPratica, causa, dettaglio, dataEfficacia, idToken) {
  const eseguitoDa = _presidenzaRichiedeAutorizzazione_(idToken);

  const c = risolviCausaCessazione_(causa);
  if (!c) {
    throw new Error('Causa di cessazione non valida. Valori ammessi: ' + Object.keys(CONFIG.CAUSE_CESSAZIONE).join(', ') + '.');
  }
  if (c.chiave === 'Espulsione') {
    throw new Error('L\'espulsione non passa da qui: va proposta dalla Presidenza e deliberata dall\'Assemblea (Art. 9.3).');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
    const { row, rowData } = _presidenzaTrovaRiga_(sheet, idPratica);
    const I = CONFIG.IDX;

    const causaGia = cessazioneRegistrata_(rowData);
    if (causaGia) {
      return { ok: true, messaggio: 'Il rapporto associativo risultava già cessato (' + etichettaCausaCessazione_(causaGia) + ').' };
    }
    if (rowData[I.MEMBRO_UFFICIALE] !== 'SI') {
      throw new Error('Questa persona non è un Membro ufficiale: non c\'è un rapporto associativo da chiudere. ' +
        'Per una domanda ancora in corso si usa "Rifiuta".');
    }

    return eseguiCessazione_(sheet, row, rowData, {
      causa: c.chiave,
      motivo: String(dettaglio || '').trim(),
      riferimento: '',
      dataEfficacia: _dataPresidenzaDaInput_(dataEfficacia),
      eseguitoDa: eseguitoDa,
    });
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ESECUZIONE COMUNE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chiude il rapporto associativo: scrive la posizione sul foglio, sospende gli
 * accessi (Workspace, M365), annulla l'eventuale abbonamento Stripe attivo,
 * informa l'interessato e la Presidenza.
 *
 * Ogni passo dopo la scrittura sul foglio è best-effort e loggato: un
 * fallimento parziale (M365 non configurato, webhook Chat assente) non deve
 * lasciare la riga a metà. Il flag ESPULSO (AQ) resta riservato all'espulsione
 * vera: è il guard storico che il resto del progetto legge, e accenderlo per un
 * recesso direbbe una cosa falsa.
 */
function eseguiCessazione_(sheet, row, rowData, opts) {
  const I    = CONFIG.IDX;
  const tipo = rowData[I.TIPO_ASSOCIATO];
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[I.ID_PRATICA] || 'N/D';
  const emailIst = String(rowData[I.EMAIL_ISTITUZIONALE]||'').trim();

  const c        = CONFIG.CAUSE_CESSAZIONE[opts.causa];
  const dataEff  = opts.dataEfficacia instanceof Date ? opts.dataEfficacia : new Date();
  const dataStr  = formatData_(dataEff);
  const etichetta= etichettaCausaCessazione_(opts.causa);

  traceLog_('=== CESSAZIONE (' + opts.causa + ', ' + c.articolo + '): ' + dati.nome + ' ' + dati.cognome +
            ' (' + idP + ') — registrata da ' + opts.eseguitoDa + ' ===');

  _assicuraColonne_(sheet, I.RIFERIMENTO_CESSAZIONE + 1);

  const statoPrima = rowData[I.STATO_DOMANDA] || '';
  sheet.getRange(row, I.STATO_DOMANDA+1).setValue(c.stato);
  sheet.getRange(row, I.CAUSA_CESSAZIONE+1).setValue(opts.causa);
  sheet.getRange(row, I.DATA_CESSAZIONE+1).setValue(dataEff);
  // Il flag ESPULSO (AQ) resta acceso solo per l'espulsione vera: è il guard
  // storico che il resto del progetto legge, e accenderlo per un recesso
  // direbbe una cosa falsa. In BV finisce comunque l'atto su cui la cessazione
  // si fonda, qualunque sia la causa.
  if (opts.causa === 'Espulsione') {
    sheet.getRange(row, I.ESPULSO+1).setValue('SI');
    sheet.getRange(row, I.ESPULSO_PERCHE+1).setValue(opts.motivo || '');
    sheet.getRange(row, I.RIFERIMENTO_CESSAZIONE+1).setValue(opts.riferimento || '');
  } else if (opts.motivo) {
    sheet.getRange(row, I.RIFERIMENTO_CESSAZIONE+1).setValue(opts.motivo);
  }
  SpreadsheetApp.flush();

  const esito = { workspace: '-', m365: '-', stripe: '-', email: '-' };

  if (emailIst) {
    try {
      sospendiUtenteWorkspace_(emailIst, rowData[I.GRUPPO]);
      esito.workspace = 'OK';
    } catch(err) {
      esito.workspace = 'Errore: ' + err.message;
      traceLog_('[Cessazione] WARN Workspace: ' + err.message);
    }

    try {
      const m365Res = sospendiUtenteM365_(emailIst);
      esito.m365 = m365Res.ok ? 'OK' : ('Errore: ' + (m365Res.dettaglio || m365Res.codice || 'sconosciuto'));
    } catch(err) {
      esito.m365 = 'Errore: ' + err.message;
      traceLog_('[Cessazione] WARN M365: ' + err.message);
    }
  }

  // Art. 9.7: nessun rimborso della quota già versata. Si chiude l'addebito
  // ricorrente, non si restituisce nulla.
  const subId = String(rowData[I.STRIPE_SUB_ID]||'').trim();
  if (subId && subId.startsWith('sub_')) {
    try {
      const ris = cancellaAbbonamentoStripeImmediato_(subId);
      esito.stripe = ris.ok ? 'OK' : ('Errore: ' + ris.errore);
    } catch(err) {
      esito.stripe = 'Errore: ' + err.message;
      traceLog_('[Cessazione] WARN Stripe: ' + err.message);
    }
    sheet.getRange(row, I.STATO_PAGAMENTO+1).setValue('Cancellato');
    SpreadsheetApp.flush();
  }

  // Nessuna email al defunto: la comunicazione alla famiglia non è una mail
  // automatica.
  if (opts.causa === 'Decesso') {
    esito.email = 'non prevista';
  } else {
    try {
      if (opts.causa === 'Espulsione') {
        inviaEmailEspulsione_(rowData, tipo, opts.motivo, dataStr, opts.riferimento);
      } else {
        inviaEmailCessazione_(rowData, tipo, opts.causa, opts.motivo, dataStr);
      }
      esito.email = 'OK';
    } catch(err) {
      esito.email = 'Errore: ' + err.message;
      traceLog_('[Cessazione] WARN email: ' + err.message);
      inviaEmailErroreAmministratore(err);
    }
  }

  try { inviaNotificaCessazione_(rowData, tipo, opts, dataStr); } catch(err) {}

  // Ponte Supabase (19_SupabaseSync.gs) — mai bloccante, vedi il file. L'action
  // si chiama mark_expelled ma vale per ogni cessazione: quello che deve
  // succedere di là è identico — la persona non è più un membro attivo.
  syncMemberExpelled_(emailIst);

  try {
    logModifica_(row, 'Stato domanda (AK)', statoPrima, c.stato, idP, dati.nome+' '+dati.cognome);
    logModifica_(row, 'Causa cessazione (BS)', '',
      etichetta + ' (' + c.articolo + ') — ' + dataStr +
      (opts.riferimento ? ' · ' + opts.riferimento : '') +
      (opts.motivo ? ' · ' + opts.motivo : '') +
      ' · registrata da ' + opts.eseguitoDa,
      idP, dati.nome+' '+dati.cognome);
  } catch(e) {}

  traceLog_('=== CESSAZIONE COMPLETATA: '+idP+' — Workspace:'+esito.workspace+' M365:'+esito.m365+' Stripe:'+esito.stripe+' ===');

  return {
    ok: true,
    messaggio: etichetta + ' registrata (' + c.articolo + ', efficacia ' + dataStr + '). ' +
      'Accessi revocati — Workspace: ' + esito.workspace + ', M365: ' + esito.m365 + '.',
    dettagli: esito,
  };
}

/**
 * Compatibilità: qualche script di recovery chiama ancora `eseguiEspulsione_`.
 * Passa dal percorso nuovo, che pretende gli estremi della delibera.
 */
function eseguiEspulsione_(sheet, row, rowData, motivo, eseguitoDa, deliberaAssemblea) {
  const delibera = String(deliberaAssemblea || '').trim();
  if (!delibera) {
    throw new Error('eseguiEspulsione_: servono gli estremi della delibera dell\'Assemblea (Art. 9.3 Statuto).');
  }
  return eseguiCessazione_(sheet, row, rowData, {
    causa: 'Espulsione', motivo: motivo, riferimento: delibera,
    dataEfficacia: new Date(), eseguitoDa: eseguitoDa,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICHE CHAT
// ─────────────────────────────────────────────────────────────────────────────

function inviaNotificaPropostaEspulsione_(rowData, tipo, motivo, propostaDa) {
  if (!webhookChatValido_(CONFIG.CHAT_WEBHOOK_URL_CONFERME)) return;
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[CONFIG.IDX.ID_PRATICA] || 'N/D';
  inviaChatCard_({
    webhookUrl: CONFIG.CHAT_WEBHOOK_URL_CONFERME,
    id: 'proposta-espulsione', titolo: '⚠️ Proposta di espulsione', sottotitolo: tipo,
    headerColor: '#B06500',
    idPratica: idP,
    testo: '<b>'+dati.nome+' '+dati.cognome+'</b> — proposta avanzata da <b>'+propostaDa+'</b>.\n\n' +
           'La posizione resta invariata. Va convocata l\'Assemblea dei Soci, che delibera ' +
           'dopo aver ascoltato l\'interessato in contraddittorio (Art. 9.3 Statuto).',
    campi: [
      {label:'ID Pratica', valore:idP},
      {label:'Motivo proposto', valore:motivo || 'Non specificato'},
      {label:'Prossimo passo', valore:'Delibera dell\'Assemblea'},
    ],
  });
}

function inviaNotificaCessazione_(rowData, tipo, opts, dataStr) {
  if (!webhookChatValido_(CONFIG.CHAT_WEBHOOK_URL_CONFERME)) return;
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[CONFIG.IDX.ID_PRATICA] || 'N/D';
  const c    = CONFIG.CAUSE_CESSAZIONE[opts.causa];
  const campi = [
    {label:'ID Pratica', valore:idP},
    {label:'Causa', valore: etichettaCausaCessazione_(opts.causa) + ' (' + c.articolo + ')'},
    {label:'Efficacia', valore: dataStr},
  ];
  if (opts.riferimento) campi.push({label:'Delibera', valore:opts.riferimento});
  if (opts.motivo)      campi.push({label:'Motivo', valore:opts.motivo});

  inviaChatCard_({
    webhookUrl: CONFIG.CHAT_WEBHOOK_URL_CONFERME,
    id: 'cessazione',
    titolo: opts.causa === 'Espulsione' ? '⛔ Membro espulso' : '⛔ Rapporto associativo cessato',
    sottotitolo: tipo,
    headerColor: '#C00000',
    idPratica: idP,
    testo: '<b>'+dati.nome+' '+dati.cognome+'</b> — registrata da <b>'+opts.eseguitoDa+'</b>.',
    campi: campi,
  });
}
