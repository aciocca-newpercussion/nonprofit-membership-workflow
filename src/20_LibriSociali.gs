/**
 * MODULO: 20_LibriSociali.gs
 * ══════════════════════════════════════════════════════════════════════
 * I due libri che il foglio 'Risposte' contiene ma non sa esibire:
 *
 *   generaLibroAssociati()      libro degli associati — art. 15 c.1 lett. a)
 *                               D.Lgs. 117/2017, Statuto Art. 15.7
 *   generaRegistroVolontari()   registro dei volontari non occasionali —
 *                               art. 17 c.1 D.Lgs. 117/2017
 *
 * Il foglio 'Risposte' è un archivio di *domande*: ci stanno dentro anche i
 * rifiutati, i duplicati e le righe in errore, che nel libro degli associati
 * non devono comparire. E i libri richiedono cose che la pratica non ha — un
 * numero progressivo, gli estremi della delibera, la data e la causa di
 * cessazione. Questi due estrattori producono i libri veri a partire dai dati
 * di lavoro; l'art. 15 c.3 consente la tenuta elettronica proprio a condizione
 * che le posizioni dei soci siano estraibili, ed è ciò che succede qui.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * REGISTRO DEI VOLONTARI (art. 17 c.1).
 *
 * Lo Statuto (Art. 5) dice che l'Associazione si avvale
 * «prevalentemente» dell'attività di volontariato dei propri soci. Da quella
 * frase discendono due obblighi che il resto di questo progetto non toccava in
 * nessun punto:
 *
 *   art. 17 c.1  i volontari che prestano attività in modo NON occasionale
 *                vanno iscritti in un apposito registro;
 *   art. 18      quegli stessi volontari vanno assicurati contro infortuni e
 *                malattie connessi all'attività e per la responsabilità civile
 *                verso terzi. È un obbligo sanzionato: la copertura o c'è o non
 *                c'è, e il registro è il posto dove si vede.
 *
 * `generaRegistroVolontari()` tiene allineato un foglio `Registro Volontari` con le
 * righe di 'Risposte'. Non decide chi è volontario non occasionale — quello lo
 * decide la Presidenza, e lo scrive nella colonna «Non occasionale» del
 * registro, che questa funzione non sovrascrive mai. Stessa cosa per «Attività
 * svolta», «Data inizio attività» e «Note»: sono campi umani, e il refresh li
 * conserva. Tutto il resto (anagrafica, cessazione, estremi della polizza)
 * viene riscritto a ogni esecuzione, perché la fonte di verità è altrove.
 *
 * Non è automatico di proposito: un registro che si aggiorna da solo mentre
 * nessuno guarda è esattamente ciò che, in sede di controllo, non si riesce a
 * spiegare. Si esegue a mano dall'editor Apps Script — per questo il nome non
 * ha l'underscore finale.
 *
 * Attenzione privacy: il registro contiene dati personali di minorenni. Vive
 * nello stesso foglio di 'Risposte', che è già ristretto alla Presidenza, e non
 * va condiviso oltre.
 */

// Colonne del registro. L'ordine è quello di lettura, non quello di scrittura:
// le tre colonne "umane" stanno in mezzo perché è lì che le si compila.
const REGISTRO_VOLONTARI_COLONNE = [
  'N.',                    // 0  progressivo, riassegnato a ogni refresh
  'ID Pratica',            // 1  chiave di raccordo con 'Risposte'
  'Cognome',               // 2
  'Nome',                  // 3
  'Codice fiscale',        // 4
  'Data di nascita',       // 5
  'Tipo di associato',     // 6
  'Ambito',                // 7  gruppo Workspace: Presidenza / Soci / Volontari
  'Non occasionale',       // 8  ← compilata dalla Presidenza (SI / NO)
  'Attività svolta',       // 9  ← compilata dalla Presidenza
  'Data inizio attività',  // 10 ← compilata dalla Presidenza; default: ammissione
  'Data cessazione',       // 11 da 'Risposte' (BT)
  'Causa cessazione',      // 12 da 'Risposte' (BS)
  'Compagnia assicurativa',// 13 da CONFIG.ASSICURAZIONE_VOLONTARI
  'Polizza n.',            // 14 idem
  'Scadenza polizza',      // 15 idem
  'Note',                  // 16 ← compilata dalla Presidenza
];

// Indici delle colonne che l'aggiornamento non tocca mai.
const REGISTRO_VOLONTARI_COL_UMANE = [8, 9, 10, 16];

/**
 * Crea o aggiorna il foglio `Registro Volontari`.
 * Da eseguire a mano dall'editor Apps Script. Ritorna un riepilogo (anche
 * loggato) con quante righe sono state scritte e che cosa manca.
 */
function generaRegistroVolontari() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    const I     = CONFIG.IDX;
    const dati  = sheet.getDataRange().getValues();

    let registro = ss.getSheetByName(CONFIG.SHEET_REGISTRO_VOLONTARI);
    if (!registro) {
      registro = ss.insertSheet(CONFIG.SHEET_REGISTRO_VOLONTARI);
      traceLog_('[RegistroVolontari] Foglio creato.');
    }

    // Quello che una persona ha già scritto, indicizzato per ID Pratica.
    const precedenti = _registroVolontariValoriUmani_(registro);

    const ass = CONFIG.ASSICURAZIONE_VOLONTARI || {};
    const polizzaMancante = !String(ass.POLIZZA_N || '').trim();
    const valoreAss = (v) => String(v || '').trim() || 'DA DOCUMENTARE';

    const righe = [];
    let senzaInizio = 0;
    for (let i = 1; i < dati.length; i++) {
      const r = dati[i];
      const tipo = r[I.TIPO_ASSOCIATO];
      if (!tipo) continue;
      // Nel registro entra chi il rapporto associativo ce l'ha davvero: le
      // domande in corso, rifiutate o duplicate non sono volontari di nessuno.
      if (r[I.MEMBRO_UFFICIALE] !== 'SI') continue;

      const d    = getDatiAnagrafici_(r, tipo);
      const idP  = String(r[I.ID_PRATICA] || '').trim();
      const pre  = precedenti[idP.toUpperCase()] || {};
      const inizio = pre[10] || _registroVolontariData_(r[I.DATA_AMMISSIONE]);
      if (!inizio) senzaInizio++;

      righe.push([
        righe.length + 1,
        idP,
        d.cognome || '',
        d.nome || '',
        String(d.cf || '').toUpperCase(),
        _registroVolontariData_(d.dataNascita),
        tipo,
        r[I.GRUPPO] || '',
        pre[8] || '',
        pre[9] || '',
        inizio,
        _registroVolontariData_(r[I.DATA_CESSAZIONE]),
        cessazioneRegistrata_(r) ? etichettaCausaCessazione_(cessazioneRegistrata_(r)) : '',
        valoreAss(ass.COMPAGNIA),
        valoreAss(ass.POLIZZA_N),
        valoreAss(ass.SCADENZA),
        pre[16] || '',
      ]);
    }

    registro.clear();
    registro.getRange(1, 1, 1, REGISTRO_VOLONTARI_COLONNE.length)
      .setValues([REGISTRO_VOLONTARI_COLONNE])
      .setFontWeight('bold').setBackground('{{COLORE_BLU}}').setFontColor('#FFFFFF');
    if (righe.length) {
      registro.getRange(2, 1, righe.length, REGISTRO_VOLONTARI_COLONNE.length).setValues(righe);
    }
    registro.setFrozenRows(1);
    registro.getRange(1, 1, registro.getMaxRows(), REGISTRO_VOLONTARI_COLONNE.length)
      .setVerticalAlignment('middle');

    // La nota sul foglio serve a chi lo apre fra due anni senza avere davanti
    // questo file.
    registro.getRange(1, 9).setNote(
      'Compilata dalla Presidenza: SI per chi presta attività di volontariato in modo non ' +
      'occasionale (art. 17 c.1 D.Lgs. 117/2017). Il refresh automatico non la sovrascrive.');
    registro.getRange(1, 14).setNote(
      'Estremi della copertura obbligatoria (art. 18 D.Lgs. 117/2017), da CONFIG.ASSICURAZIONE_VOLONTARI ' +
      'in 1_CONFIG_V8.gs. "DA DOCUMENTARE" significa che la polizza non è stata censita.');
    SpreadsheetApp.flush();

    const avvisi = [];
    if (polizzaMancante) {
      avvisi.push('Copertura assicurativa non documentata: compila CONFIG.ASSICURAZIONE_VOLONTARI ' +
        '(art. 18 D.Lgs. 117/2017 — la polizza è obbligatoria, e la sua assenza è sanzionata).');
    }
    if (senzaInizio) {
      avvisi.push(senzaInizio + ' righe senza data di inizio attività: vanno compilate a mano.');
    }
    const nonOccasionaliDaDecidere = righe.filter(r => !String(r[8]).trim()).length;
    if (nonOccasionaliDaDecidere) {
      avvisi.push(nonOccasionaliDaDecidere + ' righe senza la colonna "Non occasionale": ' +
        'la valutazione spetta alla Presidenza, il registro non la può dedurre.');
    }

    const esito = { ok: true, righe: righe.length, avvisi: avvisi };
    traceLog_('=== REGISTRO VOLONTARI aggiornato: ' + righe.length + ' righe ===' +
      (avvisi.length ? '\n- ' + avvisi.join('\n- ') : ' Nessun avviso.'));
    return esito;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Rilegge dal registro le colonne compilate a mano, per ID Pratica.
 * Ritorna { 'PR-00012': { 8: 'SI', 9: 'Percussioni', 10: Date, 16: '…' } }.
 */
function _registroVolontariValoriUmani_(registro) {
  const out = {};
  try {
    const ultimaRiga = registro.getLastRow();
    if (ultimaRiga < 2) return out;
    const valori = registro.getRange(2, 1, ultimaRiga - 1, REGISTRO_VOLONTARI_COLONNE.length).getValues();
    valori.forEach(riga => {
      const id = String(riga[1] || '').trim().toUpperCase();
      if (!id) return;
      const conservate = {};
      REGISTRO_VOLONTARI_COL_UMANE.forEach(c => { if (riga[c] !== '' && riga[c] !== null) conservate[c] = riga[c]; });
      out[id] = conservate;
    });
  } catch (err) {
    // Un registro illeggibile non deve impedire di rigenerarlo: al massimo si
    // perdono le colonne umane, e l'avviso lo dice.
    traceLog_('[RegistroVolontari] WARN rilettura colonne compilate: ' + err.message);
  }
  return out;
}

/** Data normalizzata per il registro, stringa vuota se non è una data. */
function _registroVolontariData_(v) {
  if (!v) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  return isNaN(d.getTime()) ? '' : d;
}


// ═══════════════════════════════════════════════════════════════════════════
// LIBRO DEGLI ASSOCIATI — art. 15 c.1 lett. a) D.Lgs. 117/2017
// ═══════════════════════════════════════════════════════════════════════════
//
// Ci entra chi il rapporto associativo l'ha davvero instaurato, e ci resta
// anche dopo che è cessato: un libro dei soci che cancella gli ex soci non è
// un libro, è un elenco. Restano fuori le domande in corso, i rifiuti, i
// duplicati e le righe in errore, che nel foglio 'Risposte' convivono con i
// soci solo perché quello è l'archivio delle pratiche.
//
// L'ordine è cronologico per data di ammissione, e il numero progressivo
// segue quell'ordine: è il numero d'iscrizione, non l'ordine di una lista.

const LIBRO_ASSOCIATI_COLONNE = [
  'N. iscrizione',
  'ID Pratica',
  'Cognome',
  'Nome',
  'Codice fiscale',
  'Data di nascita',
  'Categoria',              // Socio Ordinario | Volontario
  'Ambito',
  'Email',
  'Data di ammissione',
  'Delibera / ratifica',    // Statuto Art. 8.3
  'Quota — scadenza',
  'Stato',
  'Data di cessazione',
  'Causa di cessazione',
  'Riferimento cessazione', // delibera dell'Assemblea, per l'espulsione
];

/**
 * Crea o aggiorna il foglio `Libro degli Associati`.
 * Da eseguire a mano dall'editor Apps Script — per questo il nome non ha
 * l'underscore finale. Ritorna un riepilogo, anche loggato.
 */
function generaLibroAssociati() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    const I     = CONFIG.IDX;
    const dati  = sheet.getDataRange().getValues();

    let libro = ss.getSheetByName(CONFIG.SHEET_LIBRO_ASSOCIATI);
    if (!libro) {
      libro = ss.insertSheet(CONFIG.SHEET_LIBRO_ASSOCIATI);
      traceLog_('[LibroAssociati] Foglio creato.');
    }

    const voci = [];
    let senzaDelibera = 0;
    for (let i = 1; i < dati.length; i++) {
      const r = dati[i];
      const tipo = r[I.TIPO_ASSOCIATO];
      if (!tipo) continue;
      if (r[I.MEMBRO_UFFICIALE] !== 'SI') continue;

      const d       = getDatiAnagrafici_(r, tipo);
      const causa   = cessazioneRegistrata_(r);
      const dataAmm = _registroVolontariData_(r[I.DATA_AMMISSIONE]);
      const delibera = String(r[I.DELIBERA_RIF] || '').trim();
      if (!delibera || delibera === '-') senzaDelibera++;

      voci.push({
        ordine: dataAmm instanceof Date ? dataAmm.getTime() : 0,
        riga: [
          0, // assegnato dopo l'ordinamento
          String(r[I.ID_PRATICA] || '').trim(),
          d.cognome || '',
          d.nome || '',
          String(d.cf || '').toUpperCase(),
          _registroVolontariData_(d.dataNascita),
          tipo,
          r[I.GRUPPO] || '',
          r[I.EMAIL_ISTITUZIONALE] || d.email || '',
          dataAmm,
          (delibera && delibera !== '-') ? delibera : 'Non annotata',
          _registroVolontariData_(r[I.DATA_SCADENZA_QUOTA]),
          causa ? 'Cessato' : 'Attivo',
          _registroVolontariData_(r[I.DATA_CESSAZIONE]),
          causa ? etichettaCausaCessazione_(causa) + ' (' + (CONFIG.CAUSE_CESSAZIONE[causa] || {}).articolo + ')' : '',
          String(r[I.RIFERIMENTO_CESSAZIONE] || '').replace(/^-$/, '').trim(),
        ],
      });
    }

    voci.sort((a, b) => a.ordine - b.ordine);
    const righe = voci.map((v, idx) => { v.riga[0] = idx + 1; return v.riga; });

    libro.clear();
    libro.getRange(1, 1, 1, LIBRO_ASSOCIATI_COLONNE.length)
      .setValues([LIBRO_ASSOCIATI_COLONNE])
      .setFontWeight('bold').setBackground('{{COLORE_BLU}}').setFontColor('#FFFFFF');
    if (righe.length) {
      libro.getRange(2, 1, righe.length, LIBRO_ASSOCIATI_COLONNE.length).setValues(righe);
    }
    libro.setFrozenRows(1);
    libro.getRange(1, 11).setNote(
      'Estremi della deliberazione di ammissione (Statuto Art. 8.3). "Non annotata" sono le ' +
      'pratiche decise prima che il pannello registrasse la delibera: per quelle il riferimento ' +
      'sta nel libro delle adunanze della Presidenza.');
    SpreadsheetApp.flush();

    const avvisi = [];
    if (senzaDelibera) {
      avvisi.push(senzaDelibera + ' iscritti senza estremi di delibera annotati: sono le ammissioni ' +
        'anteriori a questa colonna, da riconciliare con i verbali della Presidenza.');
    }

    traceLog_('=== LIBRO DEGLI ASSOCIATI aggiornato: ' + righe.length + ' iscritti ===' +
      (avvisi.length ? '\n- ' + avvisi.join('\n- ') : ' Nessun avviso.'));
    return { ok: true, iscritti: righe.length, avvisi: avvisi };
  } finally {
    lock.releaseLock();
  }
}
