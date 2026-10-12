/**
 * MODULO: 21_RegistroEventi.gs
 * ══════════════════════════════════════════════════════════════════════
 * Registro degli Eventi certificato.
 *
 * Legge i calendari Google dell'Associazione (Concerti, Campus, Prove) e ne
 * conserva la storia in uno spreadsheet SEPARATO, in sola aggiunta, con una
 * catena di impronte SHA-256 riga per riga.
 *
 * A che serve, in concreto: fra due anni un socio può chiedere «a quali eventi
 * si riferiva il consenso che ho firmato», e l'assicurazione «quali attività
 * erano in programma il giorno dell'infortunio» (art. 18 D.Lgs. 117/2017).
 * Il calendario di oggi non risponde a nessuna delle due domande: dice com'è
 * il programma adesso, non com'era allora. Questo registro sì.
 *
 * Tre scelte da non rovesciare senza pensarci:
 *
 *  1. **Spreadsheet separato.** Scrivere sul foglio operativo farebbe scattare
 *     onChange/RouterModuli a ogni sincronizzazione. Stessa ragione di
 *     11_Tracer.gs.
 *  2. **Sola aggiunta, una riga per versione.** Un evento spostato non
 *     aggiorna la sua riga: ne appende una nuova. La riga vecchia è la prova
 *     di che cosa diceva il calendario prima.
 *  3. **Tutto scritto come testo.** Le colonne sono formattate '@' e i valori
 *     salvati come stringhe: se Sheets riconvertisse una data, la verifica
 *     ricalcolerebbe un'impronta diversa e segnalerebbe una manomissione che
 *     non c'è stata.
 *
 * ⚠️ Limite da conoscere: la catena prova la **coerenza interna** del registro,
 * non la sua autenticità. Chi può scrivere sul foglio può ricalcolare tutte le
 * impronte. Per questo ancoraRegistroEventi() pubblica ogni giorno l'impronta
 * della testa fuori dal registro (log live + email a no-reply@): una
 * riscrittura successiva contraddice un'email già datata.
 *
 * Funzioni da eseguire a mano dall'editor (senza underscore, di proposito):
 *   elencaCalendariRegistro()                → ID dei calendari da mettere in SECRETS
 *   inizializzaRegistroEventi()         → crea lo spreadsheet e le intestazioni
 *   sincronizzaRegistroEventiManuale()  → una sincronizzazione, con riepilogo
 *   verificaCatenaRegistroEventi()      → verifica l'integrità della catena
 *   generaEstrattoRegistroEventi(d, a)  → PDF del periodo, da consegnare
 *   ancoraRegistroEventi()              → ancora l'impronta della testa fuori
 */

/**
 * Separatore di campo del payload canonico: Unit Separator (0x1F), un
 * carattere che non compare nei dati di un calendario. Costruito a runtime e
 * non scritto come carattere letterale, così il sorgente resta leggibile e
 * copiabile nell'editor senza caratteri invisibili.
 */
const REGEV_SEP_ = String.fromCharCode(31);

const REGEV_CFG_ = {
  PROP_SPREADSHEET_ID: 'REGEV_SPREADSHEET_ID',
  PROP_SYNC_PREFIX:    'REGEV_SYNC_',       // + chiave calendario
  PROP_HEAD:           'REGEV_HEAD',        // {seq, hash} — specchio della testa
  PROP_ANCORA:         'REGEV_ANCORA',      // {giorno, seq, hash, quando}
  NOME_SPREADSHEET:    '{{NOME_GRUPPO}} Registro Eventi',
  SHEET_EVENTI:        'Eventi',
  SHEET_ANCORE:        'Ancore',
  VERSIONE_PAYLOAD:    'v1',
  GENESI:              '0000000000000000000000000000000000000000000000000000000000000000',
  PAGINA:              250,
  MAX_PAGINE:          40,
  MAX_MS_RUN:          4.5 * 60 * 1000,     // il limite Apps Script è 6 minuti
  STATO_RESYNC:        'RESYNC',
};

/** Colonne del tab Eventi, 1-based. L'ordine è anche quello del payload. */
const REGEV_COL_ = {
  SEQ: 1, RILEVATO: 2, CALENDARIO: 3, EVENT_ID: 4, ICAL_UID: 5, RECURRING_ID: 6,
  ORIGINAL_START: 7, STATO: 8, TITOLO: 9, INIZIO: 10, FINE: 11, LUOGO: 12,
  ETAG: 13, FINGERPRINT: 14, HASH_PREC: 15, HASH_RIGA: 16,
};
const REGEV_INTESTAZIONI_ = [
  'Seq', 'Rilevato il (UTC)', 'Calendario', 'Event ID', 'iCalUID', 'Recurring ID',
  'Original start', 'Stato', 'Titolo', 'Inizio', 'Fine', 'Luogo',
  'etag', 'Fingerprint', 'Hash precedente', 'Hash riga',
];
const REGEV_N_COL_ = REGEV_INTESTAZIONI_.length;

// ═════════════════════════════════════════════════════════════════════════════
// 1. CALENDARI
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Elenca i calendari visibili all'account che esegue lo script.
 * Da eseguire a mano: serve a recuperare gli ID da mettere in 0_Secrets.gs.
 * Sola lettura, non tocca nulla.
 */
function elencaCalendariRegistro() {
  const cercati = ['concerti', 'campus', 'prove'];
  const trovati = [];
  let pageToken = null;

  Logger.log('=== Calendari visibili ===');
  do {
    const risposta = Calendar.CalendarList.list({ maxResults: 250, pageToken: pageToken, showHidden: true });
    (risposta.items || []).forEach(function(c) {
      Logger.log((c.summary || '(senza nome)') + '  ->  ' + c.id + '   [accesso: ' + (c.accessRole || '?') + ']');
      if (cercati.indexOf(String(c.summary || '').trim().toLowerCase()) !== -1) {
        trovati.push({ nome: c.summary, id: c.id, accesso: c.accessRole });
      }
    });
    pageToken = risposta.nextPageToken;
  } while (pageToken);

  Logger.log('');
  Logger.log('=== Da copiare in 0_Secrets.gs ===');
  if (!trovati.length) {
    Logger.log('Nessun calendario chiamato Concerti, Campus o Prove risulta visibile a questo account.');
  } else {
    Logger.log('  CALENDARI_REGISTRO: {');
    trovati.forEach(function(c) {
      Logger.log("    '" + String(c.nome).trim() + "': '" + c.id + "',");
    });
    Logger.log('  },');
  }
  return trovati;
}

/**
 * I calendari da registrare, letti dalla configurazione.
 * Salta con un avviso quelli non ancora censiti: un ID mancante non deve
 * impedire la sincronizzazione degli altri.
 */
function calendariRegistro_() {
  const mappa = (CONFIG.CALENDARI_REGISTRO && typeof CONFIG.CALENDARI_REGISTRO === 'object')
    ? CONFIG.CALENDARI_REGISTRO : {};
  const out = [];
  Object.keys(mappa).forEach(function(nome) {
    const id = String(mappa[nome] || '').trim();
    if (!id || id.indexOf('INSERISCI') !== -1) {
      traceLog_('[RegistroEventi] WARN calendario "' + nome + '" senza ID configurato: saltato.');
      return;
    }
    out.push({ nome: nome, id: id, chiave: chiaveCalendario_(nome) });
  });
  return out;
}

function chiaveCalendario_(nome) {
  return String(nome || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. SPREADSHEET DEL REGISTRO
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Crea (la prima volta) o apre lo spreadsheet del registro, prepara i due tab
 * e stampa l'URL. Da eseguire a mano una volta.
 */
function inizializzaRegistroEventi() {
  const ss = getRegistroSpreadsheet_();
  ensureRegistroEventi_(ss);
  const nomi = calendariRegistro_().map(function(c) { return c.nome; }).join(', ');
  Logger.log('[RegistroEventi] Registro pronto: ' + ss.getUrl());
  Logger.log('[RegistroEventi] Calendari configurati: ' + (nomi || 'nessuno'));
  Logger.log('[RegistroEventi] Proteggi il foglio e NON condividerlo: la Presidenza legge l\'estratto PDF, non il registro.');
  return ss.getUrl();
}

function getRegistroSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(REGEV_CFG_.PROP_SPREADSHEET_ID);

  if (!id && CONFIG.REGISTRO_EVENTI_SHEET_ID) {
    id = String(CONFIG.REGISTRO_EVENTI_SHEET_ID).trim();
    if (id) props.setProperty(REGEV_CFG_.PROP_SPREADSHEET_ID, id);
  }

  if (!id) {
    const nuovo = SpreadsheetApp.create(REGEV_CFG_.NOME_SPREADSHEET);
    props.setProperty(REGEV_CFG_.PROP_SPREADSHEET_ID, nuovo.getId());
    traceLog_('[RegistroEventi] Creato lo spreadsheet del registro: ' + nuovo.getUrl());
    return nuovo;
  }
  return SpreadsheetApp.openById(id);
}

function ensureRegistroEventi_(ss) {
  let sh = ss.getSheetByName(REGEV_CFG_.SHEET_EVENTI);
  if (!sh) sh = ss.insertSheet(REGEV_CFG_.SHEET_EVENTI);

  if (sh.getLastRow() === 0) {
    sh.appendRow(REGEV_INTESTAZIONI_);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, REGEV_N_COL_)
      .setFontWeight('bold').setBackground('{{COLORE_BLU}}').setFontColor('#FFFFFF');
  }
  // Tutto testo: se Sheets riconvertisse una data, la verifica segnalerebbe
  // una manomissione inesistente.
  sh.getRange(1, 1, sh.getMaxRows(), REGEV_N_COL_).setNumberFormat('@');

  let anc = ss.getSheetByName(REGEV_CFG_.SHEET_ANCORE);
  if (!anc) anc = ss.insertSheet(REGEV_CFG_.SHEET_ANCORE);
  if (anc.getLastRow() === 0) {
    anc.appendRow(['Ancorata il (UTC)', 'Seq testa', 'Hash testa', 'Righe totali', 'Pubblicata su']);
    anc.setFrozenRows(1);
    anc.getRange(1, 1, 1, 5)
      .setFontWeight('bold').setBackground('{{COLORE_BLU}}').setFontColor('#FFFFFF');
  }
  anc.getRange(1, 1, anc.getMaxRows(), 5).setNumberFormat('@');

  ss.getSheets().forEach(function(s) {
    const n = s.getName();
    if (n !== REGEV_CFG_.SHEET_EVENTI && n !== REGEV_CFG_.SHEET_ANCORE && s.getLastRow() === 0) {
      try { ss.deleteSheet(s); } catch(e) {}
    }
  });
  return sh;
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. IMPRONTE E CATENA
// ═════════════════════════════════════════════════════════════════════════════

function sha256Hex_(str) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8);
  return bytes.map(function(b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); }).join('');
}

/**
 * Ripulisce un campo prima di metterlo nel payload: via il separatore e le
 * andate a capo, che altrimenti sposterebbero i confini fra i campi.
 */
function normalizzaCampoRegistro_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  return String(v).split(REGEV_SEP_).join(' ').replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Payload canonico, costruito campo per campo con un join esplicito.
 *
 * ⚠️ Mai JSON.stringify di un oggetto: un refactor che riordinasse le chiavi
 * invaliderebbe in silenzio l'intera storia del registro. L'ordine è quello
 * di REGEV_COL_, e non si cambia.
 */
function canonizzaRigaRegistro_(prevHash, seq, r) {
  return [
    REGEV_CFG_.VERSIONE_PAYLOAD,
    String(prevHash),
    String(seq),
    normalizzaCampoRegistro_(r.rilevato),
    normalizzaCampoRegistro_(r.calendario),
    normalizzaCampoRegistro_(r.eventId),
    normalizzaCampoRegistro_(r.icalUid),
    normalizzaCampoRegistro_(r.recurringId),
    normalizzaCampoRegistro_(r.originalStart),
    normalizzaCampoRegistro_(r.stato),
    normalizzaCampoRegistro_(r.titolo),
    normalizzaCampoRegistro_(r.inizio),
    normalizzaCampoRegistro_(r.fine),
    normalizzaCampoRegistro_(r.luogo),
    normalizzaCampoRegistro_(r.etag),
    normalizzaCampoRegistro_(r.fingerprint),
  ].join(REGEV_SEP_);
}

/** Ricostruisce il payload da una riga già scritta, per la verifica. */
function rigaRegistroDaValori_(v) {
  const C = REGEV_COL_;
  return {
    rilevato:      v[C.RILEVATO - 1],
    calendario:    v[C.CALENDARIO - 1],
    eventId:       v[C.EVENT_ID - 1],
    icalUid:       v[C.ICAL_UID - 1],
    recurringId:   v[C.RECURRING_ID - 1],
    originalStart: v[C.ORIGINAL_START - 1],
    stato:         v[C.STATO - 1],
    titolo:        v[C.TITOLO - 1],
    inizio:        v[C.INIZIO - 1],
    fine:          v[C.FINE - 1],
    luogo:         v[C.LUOGO - 1],
    etag:          v[C.ETAG - 1],
    fingerprint:   v[C.FINGERPRINT - 1],
  };
}

/**
 * Legge la testa della catena da una riga sola (non dall'intero foglio) e la
 * confronta con lo specchio in ScriptProperties. Se divergono non si prosegue
 * in silenzio: è il sintomo di una riga cancellata a mano.
 */
function ultimaTestaRegistro_(sh) {
  const ultima = sh.getLastRow();
  if (ultima <= 1) return { seq: 0, hash: REGEV_CFG_.GENESI, riga: 1 };

  const valori = sh.getRange(ultima, 1, 1, REGEV_N_COL_).getValues()[0];
  const testa = {
    seq:  Number(valori[REGEV_COL_.SEQ - 1]) || (ultima - 1),
    hash: String(valori[REGEV_COL_.HASH_RIGA - 1] || '').trim(),
    riga: ultima,
  };

  const raw = PropertiesService.getScriptProperties().getProperty(REGEV_CFG_.PROP_HEAD);
  if (raw) {
    let specchio = null;
    try { specchio = JSON.parse(raw); } catch(e) {}
    if (specchio && specchio.hash && specchio.hash !== testa.hash) {
      traceLog_('[RegistroEventi] ERRORE la testa del foglio non coincide con lo specchio: foglio=' +
                testa.hash.slice(0, 12) + ' specchio=' + String(specchio.hash).slice(0, 12));
      throw new Error('Testa del registro incoerente: esegui verificaCatenaRegistroEventi() prima di sincronizzare di nuovo.');
    }
  }
  return testa;
}

/**
 * Appende righe alla catena. Il lock copre leggi-testa → append → aggiorna
 * specchio: appendRow è atomico, la sequenza no, e lo scenario reale di
 * rottura è l'esecuzione manuale sovrapposta a quella schedulata.
 */
function appendiRigheRegistro_(sh, righe) {
  if (!righe || !righe.length) return 0;

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let testa = ultimaTestaRegistro_(sh);
    const blocco = [];

    righe.forEach(function(r) {
      const seq = testa.seq + 1;
      const hash = sha256Hex_(canonizzaRigaRegistro_(testa.hash, seq, r));
      blocco.push([
        String(seq), normalizzaCampoRegistro_(r.rilevato), normalizzaCampoRegistro_(r.calendario),
        normalizzaCampoRegistro_(r.eventId), normalizzaCampoRegistro_(r.icalUid),
        normalizzaCampoRegistro_(r.recurringId), normalizzaCampoRegistro_(r.originalStart),
        normalizzaCampoRegistro_(r.stato), normalizzaCampoRegistro_(r.titolo),
        normalizzaCampoRegistro_(r.inizio), normalizzaCampoRegistro_(r.fine),
        normalizzaCampoRegistro_(r.luogo), normalizzaCampoRegistro_(r.etag),
        normalizzaCampoRegistro_(r.fingerprint), testa.hash, hash,
      ]);
      testa = { seq: seq, hash: hash, riga: testa.riga + 1 };
    });

    sh.getRange(sh.getLastRow() + 1, 1, blocco.length, REGEV_N_COL_).setValues(blocco);
    SpreadsheetApp.flush();

    PropertiesService.getScriptProperties().setProperty(
      REGEV_CFG_.PROP_HEAD, JSON.stringify({ seq: testa.seq, hash: testa.hash }));

    return blocco.length;
  } finally {
    lock.releaseLock();
  }
}

/** Riga di servizio nella catena (RESYNC): un salto va spiegato, non nascosto. */
function rigaServizioRegistro_(calendario, stato, nota) {
  return {
    rilevato: adessoUTC_(), calendario: calendario, eventId: '', icalUid: '',
    recurringId: '', originalStart: '', stato: stato, titolo: nota,
    inizio: '', fine: '', luogo: '', etag: '', fingerprint: '',
  };
}

function adessoUTC_() {
  return Utilities.formatDate(new Date(), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. SINCRONIZZAZIONE
// ═════════════════════════════════════════════════════════════════════════════

/** Handler del trigger (ogni 4 ore). */
function sincronizzaRegistroEventi() {
  const avvio = Date.now();
  const calendari = calendariRegistro_();
  if (!calendari.length) {
    traceLog_('[RegistroEventi] WARN nessun calendario configurato: sincronizzazione saltata.');
    return { ok: false, motivo: 'Nessun calendario configurato.' };
  }

  const ss = getRegistroSpreadsheet_();
  const sh = ensureRegistroEventi_(ss);

  // La testa si verifica PRIMA di toccare qualsiasi cosa, e non solo quando
  // c'è qualcosa da appendere: se la catena è già incoerente, sincronizzare
  // sopra aggraverebbe il problema invece di segnalarlo. Un giro che non
  // appende nulla non deve poter passare sopra a una riga cancellata a mano.
  try {
    ultimaTestaRegistro_(sh);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    traceLog_('[RegistroEventi] ERRORE sincronizzazione annullata: ' + msg);
    Logger.log('[RegistroEventi] Sincronizzazione annullata: ' + msg);
    return { ok: false, motivo: msg };
  }

  const indice = indiceEtagRegistro_(sh);
  const esiti = [];

  for (let i = 0; i < calendari.length; i++) {
    if (Date.now() - avvio > REGEV_CFG_.MAX_MS_RUN) {
      traceLog_('[RegistroEventi] WARN tempo esaurito: "' + calendari[i].nome + '" e seguenti rinviati al prossimo giro.');
      break;
    }
    try {
      esiti.push(sincronizzaCalendario_(calendari[i], sh, indice, avvio));
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      traceLog_('[RegistroEventi] ERRORE su "' + calendari[i].nome + '": ' + msg);
      esiti.push({ calendario: calendari[i].nome, ok: false, errore: msg });
    }
  }

  try {
    ancoraSeNecessario_(sh, ss);
  } catch (e) {
    traceLog_('[RegistroEventi] WARN ancora non pubblicata: ' + (e && e.message ? e.message : e));
  }

  const totale = esiti.reduce(function(s, e) { return s + (e.nuove || 0); }, 0);
  traceLog_('[RegistroEventi] Sincronizzazione completata: ' + totale + ' righe nuove.', esiti);
  return { ok: true, nuove: totale, esiti: esiti };
}

/** Versione manuale, con riepilogo nei log. */
function sincronizzaRegistroEventiManuale() {
  const esito = sincronizzaRegistroEventi();
  Logger.log('=== Registro Eventi — sincronizzazione manuale ===');
  Logger.log(JSON.stringify(esito, null, 2));
  Logger.log('Se hai appena eseguito una sincronizzazione, questa deve riportare 0 righe nuove.');
  return esito;
}

/**
 * Indice (calendario|eventId) → etag dell'ultima versione registrata.
 * Una lettura sola per esecuzione: è ciò che rende idempotente un rilancio
 * dopo un crash, senza duplicare versioni.
 */
function indiceEtagRegistro_(sh) {
  const ultima = sh.getLastRow();
  const mappa = {};
  if (ultima <= 1) return mappa;

  const valori = sh.getRange(2, 1, ultima - 1, REGEV_N_COL_).getValues();
  valori.forEach(function(v) {
    const eventId = String(v[REGEV_COL_.EVENT_ID - 1] || '').trim();
    if (!eventId) return;
    mappa[String(v[REGEV_COL_.CALENDARIO - 1]) + '|' + eventId] = String(v[REGEV_COL_.ETAG - 1] || '').trim();
  });
  return mappa;
}

function sincronizzaCalendario_(cal, sh, indice, avvio) {
  const props = PropertiesService.getScriptProperties();
  const chiaveToken = REGEV_CFG_.PROP_SYNC_PREFIX + cal.chiave;
  let syncToken = props.getProperty(chiaveToken) || null;

  let pageToken = null;
  let pagine = 0;
  let nuovoSyncToken = null;
  let lette = 0;
  let tempoEsaurito = false;
  let nuoveScritte = 0;
  let daAppendere = [];

  // Ciclo esplicito e non `do…while (pageToken)`: dopo un 410 il token va
  // buttato e la sincronizzazione completa deve ripartire **dentro la stessa
  // esecuzione**. Con la condizione sul pageToken si uscirebbe invece dal
  // ciclo, lasciando il calendario senza token e senza sincronizzazione.
  for (;;) {
    const args = { maxResults: REGEV_CFG_.PAGINA, singleEvents: true, showDeleted: true };
    if (syncToken) args.syncToken = syncToken;
    if (pageToken) args.pageToken = pageToken;

    let risposta;
    try {
      risposta = Calendar.Events.list(cal.id, args);
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      // Il syncToken scade: si riparte da zero, e il salto va spiegato nella
      // catena, altrimenti somiglia a una manomissione.
      if (syncToken && /410|[Ss]ync token|fullSyncRequired|Gone/.test(msg)) {
        traceLog_('[RegistroEventi] Sync token scaduto per "' + cal.nome + '": riparto da una sincronizzazione completa.');
        props.deleteProperty(chiaveToken);
        // Prima si scrive ciò che si ha già letto, poi il marcatore: così la
        // riga RESYNC resta al punto giusto della cronologia.
        nuoveScritte += appendiRigheRegistro_(sh, daAppendere);
        daAppendere = [];
        appendiRigheRegistro_(sh, [rigaServizioRegistro_(cal.nome, REGEV_CFG_.STATO_RESYNC,
          'Sync token scaduto (410): ripartenza con sincronizzazione completa')]);
        syncToken = null;
        pageToken = null;
        nuovoSyncToken = null;
        pagine = 0;
        continue;
      }
      throw err;
    }

    (risposta.items || []).forEach(function(ev) {
      lette++;
      const riga = rigaDaEventoCalendar_(cal, ev);
      const chiave = cal.nome + '|' + riga.eventId;
      if (riga.etag && indice[chiave] === riga.etag) return;   // versione già registrata
      indice[chiave] = riga.etag;
      daAppendere.push(riga);
    });

    pageToken = risposta.nextPageToken || null;
    nuovoSyncToken = risposta.nextSyncToken || nuovoSyncToken;
    pagine++;

    if (Date.now() - avvio > REGEV_CFG_.MAX_MS_RUN) {
      traceLog_('[RegistroEventi] WARN "' + cal.nome + '": tempo esaurito a pagina ' + pagine + ', token NON salvato.');
      tempoEsaurito = true;
      break;
    }
    if (!pageToken) break;                              // paginazione conclusa
    if (pagine >= REGEV_CFG_.MAX_PAGINE) break;         // troppe pagine: si riprende al prossimo giro
  }

  const nuove = nuoveScritte + appendiRigheRegistro_(sh, daAppendere);

  // Il token si salva SOLO a paginazione conclusa e righe scritte: salvarlo a
  // metà significherebbe perdere per sempre gli eventi non ancora appesi.
  const completo = !pageToken && !tempoEsaurito && pagine < REGEV_CFG_.MAX_PAGINE;
  if (nuovoSyncToken && completo) {
    props.setProperty(chiaveToken, nuovoSyncToken);
  }

  traceLog_('[RegistroEventi] "' + cal.nome + '": ' + lette + ' eventi letti, ' + nuove + ' versioni nuove.');
  return { calendario: cal.nome, ok: true, lette: lette, nuove: nuove, completo: completo };
}

/**
 * Da evento Calendar a riga del registro.
 * Le istanze annullate arrivano quasi vuote (solo id, status, recurringEventId):
 * per questo ogni campo è difensivo.
 */
function rigaDaEventoCalendar_(cal, ev) {
  const inizio  = (ev.start && (ev.start.dateTime || ev.start.date)) || '';
  const fine    = (ev.end   && (ev.end.dateTime   || ev.end.date))   || '';
  const origine = (ev.originalStartTime && (ev.originalStartTime.dateTime || ev.originalStartTime.date)) || '';
  const titolo  = ev.summary || (ev.status === 'cancelled' ? '(evento annullato)' : '(senza titolo)');

  return {
    rilevato:      adessoUTC_(),
    calendario:    cal.nome,
    eventId:       ev.id || '',
    icalUid:       ev.iCalUID || '',
    recurringId:   ev.recurringEventId || '',
    originalStart: origine,
    stato:         ev.status || '',
    titolo:        titolo,
    inizio:        inizio,
    fine:          fine,
    luogo:         ev.location || '',
    etag:          ev.etag || '',
    fingerprint:   fingerprintEvento_(cal.nome, titolo, inizio, fine),
  };
}

/**
 * Impronta di identità «ricostruita».
 *
 * Un evento cancellato e ricreato su Calendar ha id e iCalUID nuovi: l'identità
 * tecnica si rompe e non c'è modo di ricucirla. Il fingerprint permette almeno
 * all'estratto di riconoscere che una coppia annullato+creato riguarda la stessa
 * serata. La pretesa dimostrabile resta «il registro prova cosa diceva il
 * calendario e quando», non «è lo stesso evento».
 */
function fingerprintEvento_(calendario, titolo, inizio, fine) {
  const t = String(titolo || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return sha256Hex_([calendario, t, String(inizio || ''), String(fine || '')].join(REGEV_SEP_)).slice(0, 32);
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. VERIFICA DELLA CATENA
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Ricalcola la catena e riporta la PRIMA divergenza, distinguendo due diagnosi
 * che a occhio si confondono:
 *
 *   contenuto    → l'impronta della riga non corrisponde ai suoi campi:
 *                  qualcuno ha modificato una cella.
 *   collegamento → l'impronta precedente non è quella della riga sopra:
 *                  una riga è stata cancellata o inserita.
 *
 * Dalla prima divergenza in poi tutte le righe risultano formalmente invalide
 * per propagazione: è la natura di una catena, non un secondo problema.
 */
function verificaCatenaRegistroEventi() {
  const ss = getRegistroSpreadsheet_();
  const sh = ensureRegistroEventi_(ss);
  const ultima = sh.getLastRow();

  if (ultima <= 1) {
    Logger.log('[RegistroEventi] Registro vuoto: niente da verificare.');
    return { ok: true, righe: 0, testa: REGEV_CFG_.GENESI };
  }

  const valori = sh.getRange(2, 1, ultima - 1, REGEV_N_COL_).getValues();
  let prev = REGEV_CFG_.GENESI;
  let problema = null;

  for (let i = 0; i < valori.length && !problema; i++) {
    const v = valori[i];
    const rigaFoglio = i + 2;
    const seq = String(v[REGEV_COL_.SEQ - 1] || '').trim();
    const hashPrec = String(v[REGEV_COL_.HASH_PREC - 1] || '').trim();
    const hashRiga = String(v[REGEV_COL_.HASH_RIGA - 1] || '').trim();

    if (hashPrec !== prev) {
      problema = { riga: rigaFoglio, seq: seq, tipo: 'collegamento',
        dettaglio: 'Hash precedente ' + hashPrec.slice(0, 12) + ' non corrisponde alla riga sopra (' +
                   prev.slice(0, 12) + '): riga cancellata o inserita.' };
      break;
    }

    const atteso = sha256Hex_(canonizzaRigaRegistro_(hashPrec, seq, rigaRegistroDaValori_(v)));
    if (atteso !== hashRiga) {
      problema = { riga: rigaFoglio, seq: seq, tipo: 'contenuto',
        dettaglio: 'Impronta ricalcolata ' + atteso.slice(0, 12) + ' diversa da quella scritta (' +
                   hashRiga.slice(0, 12) + '): contenuto modificato.' };
      break;
    }
    prev = hashRiga;
  }

  const totale = valori.length;
  if (!problema) {
    Logger.log('[RegistroEventi] Catena integra: ' + totale + ' righe, testa ' + prev.slice(0, 16));
    traceLog_('[RegistroEventi] Verifica catena: integra (' + totale + ' righe).');
    return { ok: true, righe: totale, testa: prev };
  }

  const propagate = totale - (problema.riga - 2);
  Logger.log('[RegistroEventi] CATENA ROTTA alla riga ' + problema.riga + ' (Seq ' + problema.seq + ') — ' + problema.tipo);
  Logger.log('  ' + problema.dettaglio);
  Logger.log('  Da qui in poi ' + propagate + ' righe risultano formalmente invalide per propagazione.');
  traceLog_('[RegistroEventi] ERRORE catena rotta alla riga ' + problema.riga + ' (' + problema.tipo + ').', problema);
  return { ok: false, righe: totale, primaDivergenza: problema, righeInvalidate: propagate };
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. ANCORA ESTERNA
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Pubblica l'impronta della testa FUORI dal registro: tab Ancore, log live e
 * una email a no-reply@. È l'unica cosa che rende la catena opponibile: una
 * riscrittura successiva contraddice un messaggio già ricevuto e datato.
 *
 * Email con GmailApp diretto, non con inviaEmail_: il destinatario è la casella
 * che inviaEmail_ mette in BCC, e si otterrebbe un BCC ricorsivo (stessa
 * ragione di inviaEmailResocontoWorkspace_).
 */
function ancoraRegistroEventi() {
  const ss = getRegistroSpreadsheet_();
  const sh = ensureRegistroEventi_(ss);
  const testa = ultimaTestaRegistro_(sh);
  const righe = Math.max(0, sh.getLastRow() - 1);
  const quando = adessoUTC_();
  const destinatario = CONFIG.EMAIL_TRANSITO_E_VERIFICA;

  ss.getSheetByName(REGEV_CFG_.SHEET_ANCORE)
    .appendRow([quando, String(testa.seq), testa.hash, String(righe), destinatario]);

  const corpo = [
    'Ancora del Registro degli Eventi — ' + CONFIG.NOME_LEGALE,
    '',
    'Questa email fissa nel tempo, fuori dal registro, l\'impronta della sua ultima riga.',
    'Serve come riferimento: una riscrittura successiva del registro contraddirebbe questo',
    'messaggio, che ha una data propria e non e\' modificabile dallo script.',
    '',
    'Ancorata il (UTC): ' + quando,
    'Righe totali:      ' + righe,
    'Ultima sequenza:   ' + testa.seq,
    'Impronta testa:    ' + testa.hash,
    '',
    'Verifica: eseguire verificaCatenaRegistroEventi() dall\'editor Apps Script.',
    'Non rispondere a questo messaggio e non cancellarlo.',
  ].join('\n');

  try {
    GmailApp.sendEmail(destinatario,
      '[{{NOME_GRUPPO}} Registro Eventi] Ancora ' + quando + ' — testa ' + testa.hash.slice(0, 12),
      corpo);
  } catch (err) {
    traceLog_('[RegistroEventi] WARN email di ancora non inviata: ' + (err && err.message ? err.message : err));
  }

  PropertiesService.getScriptProperties().setProperty(REGEV_CFG_.PROP_ANCORA,
    JSON.stringify({ giorno: quando.slice(0, 10), seq: testa.seq, hash: testa.hash, quando: quando }));

  traceLog_('[RegistroEventi] Ancora pubblicata: testa ' + testa.hash.slice(0, 16) + ' (' + righe + ' righe).');
  Logger.log('[RegistroEventi] Ancora pubblicata e inviata a ' + destinatario);
  return { ok: true, quando: quando, seq: testa.seq, hash: testa.hash, righe: righe };
}

/** Al massimo un'ancora per giorno solare, senza aggiungere un trigger. */
function ancoraSeNecessario_(sh, ss) {
  const raw = PropertiesService.getScriptProperties().getProperty(REGEV_CFG_.PROP_ANCORA);
  const oggi = adessoUTC_().slice(0, 10);
  if (raw) {
    let ultima = null;
    try { ultima = JSON.parse(raw); } catch(e) {}
    if (ultima && ultima.giorno === oggi) return null;
  }
  if (sh.getLastRow() <= 1) return null;   // registro vuoto: niente da ancorare
  return ancoraRegistroEventi();
}

function ultimaAncoraRegistro_() {
  const raw = PropertiesService.getScriptProperties().getProperty(REGEV_CFG_.PROP_ANCORA);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch(e) { return null; }
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. ESTRATTO PDF
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Estratto del registro per un periodo, in PDF.
 *
 * È l'oggetto che si consegna a un socio che chiede a quali eventi si riferiva
 * il suo consenso, o all'assicurazione che chiede quali attività erano in
 * programma. Il registro in sé non si condivide.
 *
 * @param {string} dal  data inclusa, formato gg/mm/aaaa
 * @param {string} al   data inclusa, formato gg/mm/aaaa
 */
function generaEstrattoRegistroEventi(dal, al) {
  const daData = parseDataItaliana_(dal);
  const aData  = parseDataItaliana_(al);
  if (!daData || !aData) {
    Logger.log('[RegistroEventi] Date non valide. Uso: generaEstrattoRegistroEventi("01/09/2026", "30/09/2026")');
    return { ok: false, errore: 'Date non valide.' };
  }
  aData.setHours(23, 59, 59, 999);

  const ss = getRegistroSpreadsheet_();
  const sh = ensureRegistroEventi_(ss);
  const ultima = sh.getLastRow();
  if (ultima <= 1) return { ok: false, errore: 'Registro vuoto.' };

  const valori = sh.getRange(2, 1, ultima - 1, REGEV_N_COL_).getValues();

  // Per ogni evento tiene l'ULTIMA versione registrata: l'estratto dice com'era
  // il programma alla fine del periodo, e segnala gli annullati.
  const perEvento = {};
  valori.forEach(function(v) {
    const eventId = String(v[REGEV_COL_.EVENT_ID - 1] || '').trim();
    if (!eventId) return;
    const inizio = String(v[REGEV_COL_.INIZIO - 1] || '').trim();
    if (!inizio) return;
    const d = new Date(inizio.length <= 10 ? inizio + 'T12:00:00Z' : inizio);
    if (isNaN(d.getTime()) || d < daData || d > aData) return;
    perEvento[String(v[REGEV_COL_.CALENDARIO - 1]) + '|' + eventId] = { v: v, quando: d };
  });

  const elenco = Object.keys(perEvento).map(function(k) { return perEvento[k]; })
    .sort(function(a, b) { return a.quando - b.quando; });

  const verifica = verificaCatenaRegistroEventi();
  const ancora = ultimaAncoraRegistro_();
  const testa = ultimaTestaRegistro_(sh);
  const periodo = dal.replace(/\//g, '-') + ' ' + al.replace(/\//g, '-');

  const doc = DocumentApp.create('Estratto Registro Eventi ' + periodo);
  try {
    const body = doc.getBody();
    body.appendParagraph(CONFIG.NOME_LEGALE).setHeading(DocumentApp.ParagraphHeading.HEADING3);
    body.appendParagraph('Estratto del Registro degli Eventi').setHeading(DocumentApp.ParagraphHeading.TITLE);
    body.appendParagraph('Periodo dal ' + dal + ' al ' + al + ' · estratto il ' +
      Utilities.formatDate(new Date(), 'Europe/Rome', 'dd/MM/yyyy HH:mm') +
      ' · calendari: ' + (calendariRegistro_().map(function(c) { return c.nome; }).join(', ') || '—'));

    body.appendParagraph('Eventi in programma').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    if (!elenco.length) {
      body.appendParagraph('Nessun evento registrato nel periodo.');
    } else {
      const tabella = [['Data', 'Calendario', 'Titolo', 'Luogo', 'Stato']];
      elenco.forEach(function(e) {
        const v = e.v;
        tabella.push([
          Utilities.formatDate(e.quando, 'Europe/Rome', 'dd/MM/yyyy HH:mm'),
          String(v[REGEV_COL_.CALENDARIO - 1] || ''),
          String(v[REGEV_COL_.TITOLO - 1] || ''),
          String(v[REGEV_COL_.LUOGO - 1] || '—'),
          String(v[REGEV_COL_.STATO - 1] || '') === 'cancelled' ? 'annullato' : 'confermato',
        ]);
      });
      body.appendTable(tabella).getRow(0).editAsText().setBold(true);
    }

    body.appendParagraph('Integrità del registro').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph('Righe nel registro: ' + (ultima - 1) + ' · ultima sequenza: ' + testa.seq);
    body.appendParagraph('Impronta dell\'ultima riga (SHA-256): ' + testa.hash);
    body.appendParagraph('Verifica della catena al momento dell\'estratto: ' +
      (verifica.ok ? 'integra'
                   : 'ROTTA alla riga ' + verifica.primaDivergenza.riga + ' (' + verifica.primaDivergenza.tipo + ')'));
    body.appendParagraph(ancora
      ? 'Ultima ancora esterna: ' + ancora.quando + ' — impronta ' + ancora.hash +
        ', pubblicata per email fuori dal registro. Questo estratto è verificabile rispetto a quell\'ancora.'
      : 'Nessuna ancora esterna registrata: l\'integrità è verificabile solo all\'interno del registro.');

    body.appendParagraph('Come si legge').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    body.appendParagraph(
      'Il registro conserva in sola aggiunta ogni versione degli eventi pubblicati nei calendari ' +
      'dell\'Associazione: un evento spostato o annullato non sostituisce la propria riga, ne aggiunge ' +
      'una nuova. Ogni riga porta l\'impronta della precedente, così una modifica o una cancellazione ' +
      'interrompe la catena in modo rilevabile. Il registro non contiene dati dei partecipanti: dice ' +
      'quali eventi erano in programma, non chi c\'era.');
    body.appendParagraph('© ' + Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy') + ' ' +
      CONFIG.NOME_LEGALE + ' · C.F. ' + CONFIG.CF + ' · Tutti i diritti riservati');

    doc.saveAndClose();

    const pdf = UrlFetchApp.fetch(
      'https://docs.google.com/document/d/' + doc.getId() + '/export?format=pdf',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }
    ).getBlob().setName('Estratto Registro Eventi ' + periodo + '.pdf');

    const file = cartellaRegistroEventi_(ss).createFile(pdf);
    traceLog_('[RegistroEventi] Estratto generato: ' + file.getUrl() + ' (' + elenco.length + ' eventi).');
    Logger.log('[RegistroEventi] Estratto: ' + file.getUrl());
    return { ok: true, url: file.getUrl(), eventi: elenco.length, catenaIntegra: verifica.ok };

  } finally {
    // La copia di lavoro va sempre cestinata, come in _fnGeneraPDF_.
    try { DriveApp.getFileById(doc.getId()).setTrashed(true); } catch(e) {}
  }
}

/** Cartella dove salvare gli estratti: quella dello spreadsheet del registro. */
function cartellaRegistroEventi_(ss) {
  try {
    const parents = DriveApp.getFileById(ss.getId()).getParents();
    if (parents.hasNext()) return parents.next();
  } catch(e) {}
  return DriveApp.getRootFolder();
}

function parseDataItaliana_(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return isNaN(d.getTime()) ? null : d;
}
