/**
 * MODULO: 22_LiberatoriaWebApp.gs
 * ══════════════════════════════════════════════════════════════════════
 * Liberatoria firmata: foto, video, audio e licenza sull'esecuzione musicale.
 *
 * Pagina servita dal router unico (?pagina=liberatoria&t=<token>), senza login,
 * con firma elettronica semplice a canvas. Per i Volontari minorenni serve il
 * consenso di ENTRAMBI i genitori, raccolto in due momenti distinti.
 *
 * ── Le quattro regole di merito, e perché ──────────────────────────────────
 *
 * 1. **Obbligatorio è rispondere, non acconsentire.** Il gate sul pagamento
 *    guarda se una risposta esiste, non se è positiva. Un consenso preteso come
 *    condizione per iscriversi non è libero (art. 7 par. 4 GDPR) e cade in
 *    origine, trascinando con sé ogni pubblicazione fatta su quella base; lo
 *    Statuto arriva allo stesso divieto dall'altra parte (Art. 6.2 e 8.1).
 *    Un NO registrato è una risposta valida e non blocca nulla.
 *
 * 2. **Per acconsentire servono due firme, per rifiutare basta una.** Il
 *    consenso per un minore lo danno i titolari della responsabilità
 *    genitoriale (Statuto Art. 8.7, art. 316 c.c.): entrambi. Ma il dissenso di
 *    uno solo chiude la pratica come 'Negata' senza attendere l'altro: non
 *    esiste un secondo genitore che possa superare il no del primo.
 *
 * 3. **Due atti distinti in un solo passaggio.** Il consenso privacy
 *    (art. 6.1.a GDPR, art. 10 c.c., artt. 96-97 L. 633/1941) e la licenza sui
 *    diritti dell'artista interprete esecutore (artt. 80 e segg. L. 633/1941)
 *    hanno natura diversa e si revocano in modo diverso. Restano separati nel
 *    testo, nel foglio e nel PDF.
 *
 * 4. **Si conserva ciò che si ha davvero.** Versione del testo, sua impronta,
 *    timestamp, firma e — per il secondo genitore — la prova del controllo di
 *    una casella email e del codice fiscale dichiarato. In Apps Script l'IP del
 *    client NON è disponibile: non lo si finge e non lo si promette.
 *
 * Funzioni da eseguire a mano dall'editor:
 *   inviaLinkLiberatoriaRetroattivo()   → campagna ai Membri già ufficiali
 *   liberatoriaCreaLinkPerPratica(id)   → link di firma per una pratica
 *   verificaCatenaLiberatorie()         → integrità del registro delle firme
 */

const LIB_CFG_ = {
  PROP_TK_PREFIX:  'LIB_TK_',     // + digest del token
  PROP_IDX_PREFIX: 'LIB_IDX_',    // + ID pratica → elenco dei digest attivi
  PROP_HEAD:       'LIB_HEAD',    // testa della catena delle firme
  PROP_NUDGE:      'LIB_NUDGE_',  // + ID pratica → anti-raffica sulle email
  PROP_CURSORE:    'LIB_CURSORE_RETRO',
  GIORNI_VALIDITA: 30,
  MAX_TENTATIVI:   5,
  NUDGE_ORE:       24,
  SHEET:           'Liberatorie',
  ETA_ASSENSO:     14,            // art. 2-quinquies Codice Privacy
  MAX_RETRO_BATCH: 60,            // 6 minuti per esecuzione, 1500 email/giorno
};

/** Ruoli che possono firmare. */
const LIB_RUOLI_ = { INTERESSATO: 'interessato', GENITORE1: 'genitore1', GENITORE2: 'genitore2' };

/** Stati scritti in BZ. Il gate distingue «non ha risposto» da «ha detto no». */
const LIB_STATI_ = {
  ASSENTE:  '-',
  ATTESA2:  'In attesa 2° genitore',
  REGISTRATA: 'Registrata',
  NEGATA:   'Negata',
};

/** I sette canali, nell'ordine in cui compaiono nel testo e nel PDF. */
const LIB_CANALI_ = [
  { chiave: 'sito',       idx: 'LIBERATORIA_SITO',       etichetta: 'Sito web dell\'Associazione ({{DOMINIO}})' },
  { chiave: 'social',     idx: 'LIBERATORIA_SOCIAL',     etichetta: 'Canali social dell\'Associazione (Instagram, Facebook, TikTok, YouTube)' },
  { chiave: 'stampa',     idx: 'LIBERATORIA_STAMPA',     etichetta: 'Materiale promozionale stampato (locandine, brochure, comunicati stampa)' },
  { chiave: 'video',      idx: 'LIBERATORIA_VIDEO',      etichetta: 'Video promozionali dell\'attività associativa' },
  { chiave: 'audio',      idx: 'LIBERATORIA_AUDIO',      etichetta: 'Registrazioni audio, anche pubblicate come podcast o su piattaforme musicali' },
  { chiave: 'streaming',  idx: 'LIBERATORIA_STREAMING',  etichetta: 'Diretta streaming dei concerti su piattaforme terze' },
  { chiave: 'esecuzione', idx: 'LIBERATORIA_ESECUZIONE', etichetta: 'Licenza sull\'esecuzione musicale (fissazione e diffusione della propria esecuzione)' },
];

// ═════════════════════════════════════════════════════════════════════════════
// 1. IL TESTO, VERSIONATO
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Il testo sta QUI, nel codice, e non nel template del PDF: così l'impronta
 * conservata insieme alla firma è l'impronta di ciò che la persona ha letto, e
 * modificare il template non può retro-cambiare il significato di una firma
 * già raccolta. Cambiare una parola significa aprire una versione nuova.
 */
const LIBERATORIA_TESTI = {
  '2026.1': {
    versione: '2026.1',
    inVigoreDal: '12/09/2026',
    titolo: 'Liberatoria per riprese fotografiche, video e audio e licenza sull\'esecuzione musicale',
    premessa: [
      '{{NOME_LEGALE}} documenta la propria attività — concerti, campus e prove — ' +
      'con fotografie, riprese video e registrazioni audio, e ne pubblica una parte sui propri canali per ' +
      'raccontare quello che fa.',
      'Questo documento serve a chiedere il permesso di farlo. È facoltativo in ogni sua parte: si può ' +
      'autorizzare tutto, una parte, o niente. La scelta NON incide in alcun modo sull\'ammissione, sulla ' +
      'quota associativa, sulla partecipazione alle attività e ai concerti, né su qualunque altro diritto ' +
      'associativo (Statuto Artt. 6.2 e 8.1).',
      'Rispondere, però, è necessario: senza una risposta — anche negativa — l\'Associazione non sa come ' +
      'trattare le immagini e le registrazioni in cui la persona compare, e per questo la richiesta va ' +
      'chiusa prima di completare l\'iscrizione.',
    ],
    eventiCoperti:
      'Il permesso riguarda le attività istituzionali dell\'Associazione annotate nel Registro degli Eventi, ' +
      'che conserva la storia dei calendari Concerti, Campus e Prove. Su richiesta l\'Associazione rilascia ' +
      'un estratto del Registro con l\'elenco degli eventi di un periodo determinato.',
    parteA: {
      titolo: 'Parte A — Consenso al trattamento e alla pubblicazione di immagini, video e audio',
      corpo: [
        'Il sottoscritto autorizza {{NOME_LEGALE}}, a titolo gratuito, a effettuare ' +
        'riprese fotografiche, video e audio durante le attività associative e a trattare le immagini, la ' +
        'voce e le registrazioni così ottenute, nonché a conservarle nei propri archivi.',
        'L\'autorizzazione alla pubblicazione è data separatamente per ciascun canale indicato più sotto: ' +
        'vale solo per i canali autorizzati e per nessun altro.',
        'Base giuridica: consenso dell\'interessato, art. 6 par. 1 lett. a) del Regolamento (UE) 2016/679; ' +
        'artt. 10 del codice civile e 96-97 della legge 22 aprile 1941 n. 633 per il diritto all\'immagine.',
      ],
    },
    parteB: {
      titolo: 'Parte B — Licenza sui diritti dell\'artista interprete esecutore',
      corpo: [
        'Chi suona in un concerto è artista interprete esecutore e ha diritti propri sulla fissazione e sulla ' +
        'diffusione della propria esecuzione (artt. 80 e segg. della legge 633/1941). Il consenso della Parte A, ' +
        'da solo, non basta a pubblicare la registrazione di un concerto.',
        'Con la Parte A al canale «Licenza sull\'esecuzione musicale» il sottoscritto concede quindi ' +
        'all\'Associazione una licenza gratuita e non esclusiva, senza limiti di tempo e di territorio, per ' +
        'fissare, riprodurre, comunicare al pubblico e mettere a disposizione la propria esecuzione, nell\'ambito ' +
        'delle finalità istituzionali e di promozione dell\'Associazione e sui canali autorizzati nella Parte A, ' +
        'comprese le piattaforme di terzi da essa utilizzate.',
        'Restano esclusi: la cessione a terzi per finalità commerciali proprie di terzi, e ogni utilizzo che ' +
        'rechi pregiudizio all\'onore, alla reputazione o al decoro della persona (art. 97 comma 2 della ' +
        'legge 633/1941). Il diritto morale resta in ogni caso dell\'autore e dell\'interprete.',
      ],
    },
    revoca: {
      titolo: 'Revoca',
      corpo: [
        'Il permesso può essere revocato in qualsiasi momento, in tutto o per singolo canale, scrivendo a ' +
        '{{EMAIL_MITTENTE}} o a {{EMAIL_PRIVACY}}. La revoca non deve essere motivata e non ' +
        'ha alcuna conseguenza sul rapporto associativo.',
        'Due limiti, detti chiaramente perché il contrario non sarebbe vero: la revoca opera per il futuro, e ' +
        'l\'Associazione si impegna a rimuovere il materiale dai propri canali entro trenta giorni dalla ' +
        'richiesta; non può invece garantire il ritiro di copie già scaricate o ricondivise da terzi su ' +
        'piattaforme che non controlla.',
      ],
    },
    durata:
      'Il permesso vale fino a revoca. Va firmato di nuovo in tre soli casi: quando cambia la versione di ' +
      'questo testo, quando un Volontario minorenne compie 18 anni e conferma in nome proprio, e dopo una ' +
      'revoca, se si decide di concederlo di nuovo.',
    minori: {
      titolo: 'Volontari minorenni',
      corpo: [
        'Per un Membro minorenne i diritti sono esercitati dai titolari della responsabilità genitoriale ' +
        '(Statuto Art. 8.7, art. 316 del codice civile): il permesso richiede la firma di ENTRAMBI i genitori, ' +
        'raccolte anche in momenti diversi. Il rifiuto di uno solo dei due chiude la richiesta come negata.',
        'Chi esercita da solo la responsabilità genitoriale — genitore unico, affido esclusivo, tutore — lo ' +
        'dichiara ai sensi dell\'art. 47 del DPR 445/2000 e firma da solo.',
        'Dai 14 anni compiuti il minore firma a sua volta il proprio assenso, accanto a quello dei genitori ' +
        '(art. 2-quinquies del Codice in materia di protezione dei dati personali).',
      ],
    },
    titolare:
      'Titolare del trattamento: {{NOME_LEGALE}}, {{SEDE_LEGALE}}, C.F. e P.IVA {{CF}} — {{EMAIL_MITTENTE}}. Responsabile ' +
      'designato per la protezione dei dati: {{NOME_REFERENTE_PRIVACY}} — {{EMAIL_PRIVACY}}. Informativa ' +
      'completa su {{DOMINIO}}/privacy. Diritti esercitabili: accesso, rettifica, cancellazione, ' +
      'limitazione, opposizione, portabilità, revoca del consenso e reclamo al Garante.',
    firma:
      'La firma è apposta per via elettronica, tracciando il proprio segno sullo schermo. Insieme alla firma ' +
      'vengono conservati la versione di questo testo, la sua impronta informatica, la data e l\'ora. Questa ' +
      'forma di firma è liberamente valutabile in giudizio quanto alle sue caratteristiche di sicurezza, ' +
      'integrità e immodificabilità (art. 20 comma 1-bis del D.Lgs. 82/2005).',
  },
};

/** Il testo in vigore, con la sua impronta. */
function libTestoCorrente_() {
  const v = CONFIG.LIBERATORIA_VERSIONE_CORRENTE;
  const t = LIBERATORIA_TESTI[v];
  if (!t) throw new Error('Versione della liberatoria non trovata: ' + v);
  return t;
}

/**
 * Impronta del testo: serializzazione canonica costruita a mano, per la stessa
 * ragione del registro eventi. Se cambia una virgola cambia l'impronta, ed è
 * esattamente ciò che si vuole.
 */
function libHashTesto_(t) {
  const pezzi = [
    'lib', t.versione, t.titolo,
    t.premessa.join(' '), t.eventiCoperti,
    t.parteA.titolo, t.parteA.corpo.join(' '),
    t.parteB.titolo, t.parteB.corpo.join(' '),
    t.revoca.titolo, t.revoca.corpo.join(' '),
    t.durata, t.minori.titolo, t.minori.corpo.join(' '),
    t.titolare, t.firma,
    LIB_CANALI_.map(function(c) { return c.chiave + '=' + c.etichetta; }).join('|'),
  ];
  return sha256Hex_(pezzi.join(String.fromCharCode(31)));
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. TOKEN
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Lo store è indicizzato per IMPRONTA del token, non per token: così il
 * segreto non è mai scritto da nessuna parte e non viene mai confrontato — si
 * fa un lookup diretto. Niente confronti in tempo costante da inventare, e
 * niente token nei log.
 */
function _libChiaveToken_(token) {
  return LIB_CFG_.PROP_TK_PREFIX + sha256Hex_(String(token || ''));
}

/**
 * Apps Script non ha un generatore crittografico: due UUID concatenati danno
 * ~244 bit di entropia, che è quanto si può fare onestamente qui.
 * Math.random() non va usato: è prevedibile.
 */
function _libNuovoToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function _libCreaToken_(idPratica, ruolo, extra) {
  const props = PropertiesService.getScriptProperties();
  const token = _libNuovoToken_();
  const chiave = _libChiaveToken_(token);
  const record = {
    idP: String(idPratica),
    ruolo: ruolo,
    creatoIl: new Date().toISOString(),
    scadeIl: new Date(Date.now() + LIB_CFG_.GIORNI_VALIDITA * 86400000).toISOString(),
    usatoIl: '',
    tentativi: 0,
  };
  if (extra) Object.keys(extra).forEach(function(k) { record[k] = extra[k]; });
  props.setProperty(chiave, JSON.stringify(record));

  // Indice per pratica: serve a revocare i link vecchi quando se ne manda uno
  // nuovo, altrimenti un link inoltrato mesi prima resterebbe valido.
  const chIdx = LIB_CFG_.PROP_IDX_PREFIX + idPratica;
  let elenco = [];
  try { elenco = JSON.parse(props.getProperty(chIdx) || '[]'); } catch(e) {}
  elenco = elenco.filter(function(x) { return x && x.ruolo !== ruolo; });
  elenco.push({ chiave: chiave, ruolo: ruolo, scadeIl: record.scadeIl });
  props.setProperty(chIdx, JSON.stringify(elenco));

  return token;
}

function _libLeggiToken_(token) {
  if (!token || String(token).length < 32) return null;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(_libChiaveToken_(token));
  if (!raw) return null;
  let rec = null;
  try { rec = JSON.parse(raw); } catch(e) { return null; }
  if (!rec) return null;
  rec._chiave = _libChiaveToken_(token);
  rec.scaduto = !!(rec.scadeIl && new Date(rec.scadeIl).getTime() < Date.now());
  rec.bloccato = Number(rec.tentativi || 0) >= LIB_CFG_.MAX_TENTATIVI;
  return rec;
}

function _libAggiornaToken_(rec, modifiche) {
  const props = PropertiesService.getScriptProperties();
  const aggiornato = JSON.parse(JSON.stringify(rec));
  delete aggiornato._chiave;
  delete aggiornato.scaduto;
  delete aggiornato.bloccato;
  Object.keys(modifiche || {}).forEach(function(k) { aggiornato[k] = modifiche[k]; });
  props.setProperty(rec._chiave, JSON.stringify(aggiornato));
}

function _libRevocaTokenPratica_(idPratica, soloRuolo) {
  const props = PropertiesService.getScriptProperties();
  const chIdx = LIB_CFG_.PROP_IDX_PREFIX + idPratica;
  let elenco = [];
  try { elenco = JSON.parse(props.getProperty(chIdx) || '[]'); } catch(e) {}
  const restano = [];
  elenco.forEach(function(x) {
    if (!x || !x.chiave) return;
    if (soloRuolo && x.ruolo !== soloRuolo) { restano.push(x); return; }
    props.deleteProperty(x.chiave);
  });
  if (restano.length) props.setProperty(chIdx, JSON.stringify(restano));
  else props.deleteProperty(chIdx);
}

/**
 * Pulizia dei token scaduti. Chiamata dal controllo giornaliero: ScriptProperties
 * ha mezzo mega in tutto, e i token sono la cosa che cresce.
 */
function libPurgeTokenScaduti_() {
  const props = PropertiesService.getScriptProperties();
  const tutte = props.getProperties();
  let rimossi = 0;
  Object.keys(tutte).forEach(function(k) {
    if (k.indexOf(LIB_CFG_.PROP_TK_PREFIX) !== 0) return;
    let rec = null;
    try { rec = JSON.parse(tutte[k]); } catch(e) {}
    const scaduto = !rec || (rec.scadeIl && new Date(rec.scadeIl).getTime() < Date.now());
    if (scaduto) { props.deleteProperty(k); rimossi++; }
  });
  if (rimossi) traceLog_('[Liberatoria] Token scaduti rimossi: ' + rimossi);
  return rimossi;
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. STATO SULLA RIGA
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Che cosa risulta oggi sulla riga.
 *
 * `rispostaRegistrata` è la sola cosa che il gate guarda: 'Registrata' e
 * 'Negata' passano entrambe, perché il NO è una risposta. In attesa del secondo
 * genitore no: il consenso per un minore non è ancora formato.
 */
function statoLiberatoria_(rowData) {
  const I = CONFIG.IDX;
  const stato = String(rowData[I.LIBERATORIA_STATO] || '').trim();
  const gateAttivo = CONFIG.LIBERATORIA_GATE_ATTIVO !== false;
  const risposta = (stato === LIB_STATI_.REGISTRATA || stato === LIB_STATI_.NEGATA);
  return {
    stato: stato || LIB_STATI_.ASSENTE,
    versione: String(rowData[I.LIBERATORIA_VERSIONE] || '').trim(),
    pdfUrl: String(rowData[I.LIBERATORIA_PDF_URL] || '').trim(),
    attesaSecondoGenitore: stato === LIB_STATI_.ATTESA2,
    // Con il gate spento tutto passa: l'interruttore serve a fermare in pochi
    // secondi un blocco sbagliato, senza aspettare un nuovo deployment.
    rispostaRegistrata: gateAttivo ? risposta : true,
    gateAttivo: gateAttivo,
  };
}

/** I canali come risultano oggi sulla riga. */
function _libCanaliDaRiga_(rowData) {
  const I = CONFIG.IDX;
  const out = {};
  LIB_CANALI_.forEach(function(c) {
    out[c.chiave] = String(rowData[I[c.idx]] || '').trim().toUpperCase() === 'SI';
  });
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. IL FOGLIO DELLE FIRME, IN SOLA AGGIUNTA
// ═════════════════════════════════════════════════════════════════════════════

const LIB_INTESTAZIONI_ = [
  'Seq', 'Registrato il (UTC)', 'ID Pratica', 'Tipo associato', 'Ruolo firmatario',
  'Nome firmatario', 'Email firmatario', 'CF firmatario', 'Versione testo', 'Impronta testo',
  'Esito', 'Canali', 'Firma (URL)', 'Dichiarazione', 'User agent', 'Token (impronta)',
  'PDF', 'Hash precedente', 'Hash riga',
];

function _libFoglio_(ss) {
  let sh = ss.getSheetByName(CONFIG.SHEET_LIBERATORIE);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.SHEET_LIBERATORIE);
    sh.appendRow(LIB_INTESTAZIONI_);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, LIB_INTESTAZIONI_.length)
      .setFontWeight('bold').setBackground('{{COLORE_BLU}}').setFontColor('#FFFFFF');
    traceLog_('[Liberatoria] Creato il foglio "' + CONFIG.SHEET_LIBERATORIE + '".');
  }
  // Testo su tutto, come nel registro eventi: una data riconvertita da Sheets
  // farebbe fallire la verifica della catena senza che nessuno abbia toccato nulla.
  sh.getRange(1, 1, sh.getMaxRows(), LIB_INTESTAZIONI_.length).setNumberFormat('@');
  return sh;
}

/**
 * Payload canonico della firma. Stesse regole del registro eventi: join
 * esplicito, ordine fisso, mai JSON.stringify di un oggetto.
 */
function _libCanonizza_(prevHash, seq, r) {
  const SEP = String.fromCharCode(31);
  const pulisci = function(v) {
    return String(v === null || v === undefined ? '' : v).split(SEP).join(' ').replace(/[\r\n]+/g, ' ').trim();
  };
  return ['libv1', String(prevHash), String(seq),
    pulisci(r.registratoIl), pulisci(r.idPratica), pulisci(r.tipo), pulisci(r.ruolo),
    pulisci(r.nome), pulisci(r.email), pulisci(r.cf), pulisci(r.versione), pulisci(r.hashTesto),
    pulisci(r.esito), pulisci(r.canali), pulisci(r.firmaUrl), pulisci(r.dichiarazione),
    pulisci(r.userAgent), pulisci(r.tokenImpronta), pulisci(r.pdfUrl),
  ].join(SEP);
}

/** Append con catena, sotto lock. Mirror della testa in ScriptProperties. */
function _libAppendiFirma_(sh, r) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ultima = sh.getLastRow();
    let prevHash = '0000000000000000000000000000000000000000000000000000000000000000';
    let seq = 0;
    if (ultima > 1) {
      const riga = sh.getRange(ultima, 1, 1, LIB_INTESTAZIONI_.length).getValues()[0];
      seq = Number(riga[0]) || (ultima - 1);
      prevHash = String(riga[LIB_INTESTAZIONI_.length - 1] || '').trim();
    }
    const props = PropertiesService.getScriptProperties();
    const specchio = props.getProperty(LIB_CFG_.PROP_HEAD);
    if (specchio) {
      let s = null;
      try { s = JSON.parse(specchio); } catch(e) {}
      if (s && s.hash && s.hash !== prevHash) {
        traceLog_('[Liberatoria] ERRORE la testa del foglio firme non coincide con lo specchio.');
        throw new Error('Registro delle liberatorie incoerente: esegui verificaCatenaLiberatorie().');
      }
    }

    seq = seq + 1;
    const hash = sha256Hex_(_libCanonizza_(prevHash, seq, r));
    sh.appendRow([
      String(seq), r.registratoIl, r.idPratica, r.tipo, r.ruolo, r.nome, r.email, r.cf,
      r.versione, r.hashTesto, r.esito, r.canali, r.firmaUrl, r.dichiarazione,
      r.userAgent, r.tokenImpronta, r.pdfUrl, prevHash, hash,
    ]);
    SpreadsheetApp.flush();
    props.setProperty(LIB_CFG_.PROP_HEAD, JSON.stringify({ seq: seq, hash: hash }));
    return { seq: seq, hash: hash };
  } finally {
    lock.releaseLock();
  }
}

/** Verifica della catena delle firme. Da eseguire a mano. */
function verificaCatenaLiberatorie() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sh = _libFoglio_(ss);
  const ultima = sh.getLastRow();
  if (ultima <= 1) {
    Logger.log('[Liberatoria] Nessuna firma registrata.');
    return { ok: true, righe: 0 };
  }
  const valori = sh.getRange(2, 1, ultima - 1, LIB_INTESTAZIONI_.length).getValues();
  let prev = '0000000000000000000000000000000000000000000000000000000000000000';
  let problema = null;

  for (let i = 0; i < valori.length && !problema; i++) {
    const v = valori[i];
    const hashPrec = String(v[LIB_INTESTAZIONI_.length - 2] || '').trim();
    const hashRiga = String(v[LIB_INTESTAZIONI_.length - 1] || '').trim();
    if (hashPrec !== prev) {
      problema = { riga: i + 2, tipo: 'collegamento', dettaglio: 'riga cancellata o inserita' };
      break;
    }
    const r = {
      registratoIl: v[1], idPratica: v[2], tipo: v[3], ruolo: v[4], nome: v[5], email: v[6],
      cf: v[7], versione: v[8], hashTesto: v[9], esito: v[10], canali: v[11], firmaUrl: v[12],
      dichiarazione: v[13], userAgent: v[14], tokenImpronta: v[15], pdfUrl: v[16],
    };
    if (sha256Hex_(_libCanonizza_(hashPrec, String(v[0]), r)) !== hashRiga) {
      problema = { riga: i + 2, tipo: 'contenuto', dettaglio: 'una cella è stata modificata' };
      break;
    }
    prev = hashRiga;
  }

  if (!problema) {
    Logger.log('[Liberatoria] Catena delle firme integra: ' + valori.length + ' firme.');
    return { ok: true, righe: valori.length, testa: prev };
  }
  Logger.log('[Liberatoria] CATENA ROTTA alla riga ' + problema.riga + ' — ' + problema.tipo + ' (' + problema.dettaglio + ')');
  traceLog_('[Liberatoria] ERRORE catena firme rotta alla riga ' + problema.riga + '.', problema);
  return { ok: false, righe: valori.length, primaDivergenza: problema };
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. LA PAGINA
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Servita dal router unico. Tutto passa dal token: l'ID pratica non arriva mai
 * dal client, si ricava dal token lato server (regola del modulo 03 §8 della
 * Memoria: mai dati personali in URL o log).
 */
function doGetLiberatoria(e) {
  const p = (e && e.parameter) || {};
  const token = String(p.t || '').trim();
  const t = libTestoCorrente_();

  const dati = {
    ok: false, motivo: '', ruolo: '', tipo: '', nome: '', idPraticaMascherato: '',
    stato: '', canali: {}, richiedeCF: false, richiedeAssensoMinore: false,
    testo: t, hashTesto: libHashTesto_(t), canaliElenco: LIB_CANALI_,
    logoUrl: CONFIG.LOGO_URL, emailContatto: CONFIG.EMAIL_MITTENTE,
  };

  try {
    const rec = _libLeggiToken_(token);
    if (!rec) {
      dati.motivo = 'Il collegamento non è valido. Chiedi alla Presidenza di inviarne uno nuovo.';
    } else if (rec.scaduto) {
      dati.motivo = 'Il collegamento è scaduto. Chiedi alla Presidenza di inviarne uno nuovo.';
    } else if (rec.bloccato) {
      dati.motivo = 'Questo collegamento è stato disattivato per troppi tentativi non riusciti. Scrivi alla Presidenza.';
    } else {
      const trovata = trovaRigaPerIdPratica_(rec.idP);
      if (!trovata || !trovata.row) {
        dati.motivo = 'Non riusciamo a trovare la pratica collegata. Scrivi alla Presidenza.';
      } else {
        const I = CONFIG.IDX;
        const rowData = trovata.rowData;
        const tipo = String(rowData[I.TIPO_ASSOCIATO] || '').trim();
        const anag = getDatiAnagrafici_(rowData, tipo);
        const st = statoLiberatoria_(rowData);

        dati.ok = true;
        // Il token torna nella pagina perché serve alla chiamata di scrittura:
        // chi la sta leggendo lo ha già nel proprio URL, quindi non è una
        // esposizione in più. Resta fuori dai log e dalle email di servizio.
        dati.token = token;
        dati.ruolo = rec.ruolo;
        dati.tipo = tipo;
        dati.nome = (anag.nome || '') + ' ' + (anag.cognome || '');
        dati.idPraticaMascherato = _libMascheraIdPratica_(rec.idP);
        dati.stato = st.stato;
        dati.canali = _libCanaliDaRiga_(rowData);
        dati.giaFirmata = !!rec.usatoIl;
        dati.pdfUrl = st.pdfUrl && st.pdfUrl !== '-' ? st.pdfUrl : '';
        // Il secondo genitore si identifica digitando il proprio codice fiscale:
        // è il solo fattore che il primo genitore non può fornire al posto suo.
        dati.richiedeCF = rec.ruolo === LIB_RUOLI_.GENITORE2;
        dati.richiedeAssensoMinore = (tipo === 'Volontario') && _libMinoreDaAssenso_(rowData);
        dati.nomeMinore = tipo === 'Volontario'
          ? String(rowData[I.NOME_VOLONTARIO] || '') + ' ' + String(rowData[I.COGNOME_VOLONTARIO] || '')
          : '';
      }
    }
  } catch (err) {
    traceLog_('[Liberatoria] ERRORE apertura pagina: ' + (err && err.message ? err.message : err));
    dati.ok = false;
    dati.motivo = 'Si è verificato un problema tecnico. Riprova più tardi o scrivi alla Presidenza.';
  }

  const template = HtmlService.createTemplateFromFile('LiberatoriaHTML');
  template.DATI = dati;
  return template.evaluate()
    .setTitle('Liberatoria immagini e riprese — ' + CONFIG.NOME_GRUPPO)
    .setFaviconUrl(CONFIG.LOGO_URL)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/** PR-00042 → PR-•••42: conferma alla persona di essere sulla pratica giusta senza esporla. */
function _libMascheraIdPratica_(idP) {
  const s = String(idP || '');
  return s.length <= 5 ? s : s.slice(0, 3) + '•••' + s.slice(-2);
}

/** Il Volontario ha 14 anni compiuti? Da quell'età firma anche lui. */
function _libMinoreDaAssenso_(rowData) {
  const I = CONFIG.IDX;
  const nascita = rowData[I.DATA_NASCITA_VOLONTARIO];
  if (!nascita) return false;
  const d = (nascita instanceof Date) ? nascita : new Date(nascita);
  if (isNaN(d.getTime())) return false;
  const anni = (Date.now() - d.getTime()) / (365.25 * 86400000);
  return anni >= LIB_CFG_.ETA_ASSENSO;
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. REGISTRAZIONE DELLA RISPOSTA
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Chiamata dalla pagina via google.script.run.
 *
 * Da una pagina HtmlService è invocabile qualunque funzione globale del
 * progetto: per questo `idPratica` NON arriva mai dal client ma si ricava dal
 * token, e ogni controllo sta qui e non nel browser.
 *
 * @param {string} token
 * @param {Object} payload {canali, firmaBase64, nomeFirmatario, emailFirmatario,
 *                          cfFirmatario, secondoGenitore:{nome,email,cf},
 *                          genitoreUnico:{dichiarato,motivo},
 *                          assensoMinore:{presente,firmaBase64}, userAgent}
 */
function liberatoriaRegistraRisposta(token, payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const p = payload || {};
    const rec = _libLeggiToken_(token);

    if (!rec)          return { ok: false, error: 'Collegamento non valido.' };
    if (rec.scaduto)   return { ok: false, error: 'Collegamento scaduto. Chiedi alla Presidenza di inviarne uno nuovo.' };
    if (rec.bloccato)  return { ok: false, error: 'Collegamento disattivato. Scrivi alla Presidenza.' };
    if (rec.usatoIl)   return { ok: false, error: 'Questa firma è già stata registrata.', giaFirmata: true };

    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    const trovata = trovaRigaPerIdPratica_(rec.idP);
    if (!trovata || !trovata.row) return { ok: false, error: 'Pratica non trovata. Scrivi alla Presidenza.' };

    const I = CONFIG.IDX;
    const row = trovata.row;
    const rowData = trovata.rowData;
    const tipo = String(rowData[I.TIPO_ASSOCIATO] || '').trim();
    const anag = getDatiAnagrafici_(rowData, tipo);

    // ── Secondo genitore: si identifica col proprio codice fiscale ──────────
    // È il solo fattore che il primo genitore non può fornire al posto suo. Un
    // messaggio generico, e un tentativo contato: se il link è finito alla
    // persona sbagliata, non le si dice nemmeno di chi è la pratica.
    if (rec.ruolo === LIB_RUOLI_.GENITORE2) {
      const atteso = String(rec.cfAtteso || '').trim().toUpperCase();
      const dato = String(p.cfFirmatario || '').trim().toUpperCase();
      if (!atteso || dato !== atteso) {
        _libAggiornaToken_(rec, { tentativi: Number(rec.tentativi || 0) + 1 });
        traceLog_('[Liberatoria] WARN codice fiscale non corrispondente su token ' +
                  String(rec._chiave).slice(-12) + ' (tentativo ' + (Number(rec.tentativi || 0) + 1) + ').');
        return { ok: false, error: 'I dati inseriti non corrispondono. Controlla il codice fiscale e riprova.' };
      }
    }

    // ── La firma è obbligatoria: senza segno non c'è sottoscrizione ─────────
    // Il controllo sulla lunghezza non è pedanteria: un canvas creato mentre il
    // suo contenitore è nascosto misura 0x0 e toDataURL restituisce "data:,".
    // Sarebbe una firma vuota indistinguibile da una vera, e nessuno se ne
    // accorgerebbe fino al giorno in cui serve esibirla.
    if (!p.firmaBase64 || String(p.firmaBase64).length < 1000) {
      traceLog_('[Liberatoria] WARN firma assente o non acquisita per ' + rec.idP +
                ' (lunghezza ' + String(p.firmaBase64 || '').length + ').');
      return { ok: false, error: 'La firma non è stata acquisita. Rifalla e riprova.' };
    }
    if (!String(p.nomeFirmatario || '').trim()) return { ok: false, error: 'Manca il nome di chi firma.' };

    const canali = {};
    let almenoUnSi = false;
    LIB_CANALI_.forEach(function(c) {
      const v = !!(p.canali && p.canali[c.chiave]);
      canali[c.chiave] = v;
      if (v) almenoUnSi = true;
    });

    // ── Volontari: chi firma e che cosa manca ancora ────────────────────────
    const volontario = (tipo === 'Volontario');
    const genitoreUnico = !!(p.genitoreUnico && p.genitoreUnico.dichiarato);
    let secondoGenitore = null;

    if (volontario && rec.ruolo === LIB_RUOLI_.GENITORE1 && almenoUnSi && !genitoreUnico) {
      const sg = p.secondoGenitore || {};
      const nome = String(sg.nome || '').trim();
      const email = String(sg.email || '').trim();
      const cf = String(sg.cf || '').trim().toUpperCase();
      if (!nome || !email || !/^[A-Z0-9]{16}$/.test(cf)) {
        return { ok: false, error: 'Per autorizzare servono anche i dati dell\'altro genitore: nome, email e codice fiscale. ' +
                 'Se eserciti da solo la responsabilità genitoriale, spunta la dichiarazione.' };
      }
      secondoGenitore = { nome: nome, email: email, cf: cf };
    }

    const testo = libTestoCorrente_();
    const hashTesto = libHashTesto_(testo);
    const esito = almenoUnSi ? 'Concesso' : 'Negato';

    // ── Firma su Drive, nella cartella ristretta ────────────────────────────
    const firmaUrl = _libSalvaFirmaDrive_(p.firmaBase64, rec.idP, rec.ruolo);
    let assensoUrl = '';
    if (p.assensoMinore && p.assensoMinore.presente &&
        String(p.assensoMinore.firmaBase64 || '').length >= 1000) {
      assensoUrl = _libSalvaFirmaDrive_(p.assensoMinore.firmaBase64, rec.idP, 'minore');
    }

    // ── Stato risultante ───────────────────────────────────────────────────
    // Per acconsentire servono due firme, per rifiutare basta una: un NO chiude
    // la pratica subito, senza aspettare l'altro genitore.
    let statoNuovo;
    if (esito === 'Negato') statoNuovo = LIB_STATI_.NEGATA;
    else if (!volontario || genitoreUnico || rec.ruolo === LIB_RUOLI_.GENITORE2) statoNuovo = LIB_STATI_.REGISTRATA;
    else statoNuovo = LIB_STATI_.ATTESA2;

    // ── Scritture sul foglio ───────────────────────────────────────────────
    _assicuraColonne_(sheet, I.MAIL_LIBERATORIA_PRESIDENZA + 1);
    const statoPrec = String(rowData[I.LIBERATORIA_STATO] || '');

    LIB_CANALI_.forEach(function(c) {
      const vecchio = String(rowData[I[c.idx]] || '');
      const nuovo = canali[c.chiave] ? 'SI' : 'NO';
      if (vecchio !== nuovo) {
        sheet.getRange(row, I[c.idx] + 1).setValue(nuovo);
        // onEdit non scatta per le scritture da script: lo Storico si scrive a mano.
        logModifica_(row, 'Liberatoria ' + c.chiave, vecchio, nuovo, rec.idP,
                     (anag.nome || '') + ' ' + (anag.cognome || ''));
      }
    });
    sheet.getRange(row, I.LIBERATORIA_STATO + 1).setValue(statoNuovo);
    sheet.getRange(row, I.LIBERATORIA_VERSIONE + 1).setValue(testo.versione);
    sheet.getRange(row, I.LIBERATORIA_HASH + 1).setValue(hashTesto);
    sheet.getRange(row, I.LIBERATORIA_AGGIORNATA_IL + 1).setValue(formatData_(new Date()));
    sheet.getRange(row, I.LIBERATORIA_AGGIORNATA_DA + 1).setValue(
      String(p.nomeFirmatario).trim() + ' (' + rec.ruolo + ')');
    if (statoPrec !== statoNuovo) {
      logModifica_(row, 'Liberatoria stato', statoPrec, statoNuovo, rec.idP,
                   (anag.nome || '') + ' ' + (anag.cognome || ''));
    }

    // ── Riga nella catena delle firme ──────────────────────────────────────
    const firmeSh = _libFoglio_(ss);
    const dichiarazioni = [];
    if (genitoreUnico) {
      dichiarazioni.push('Genitore unico o affido esclusivo (art. 47 DPR 445/2000): ' +
        String((p.genitoreUnico && p.genitoreUnico.motivo) || 'non specificato'));
    }
    if (assensoUrl) dichiarazioni.push('Assenso del minore raccolto: ' + assensoUrl);
    if (secondoGenitore) dichiarazioni.push('Secondo genitore indicato: ' + secondoGenitore.nome);

    _libAppendiFirma_(firmeSh, {
      registratoIl: new Date().toISOString(),
      idPratica: rec.idP,
      tipo: tipo,
      ruolo: rec.ruolo,
      nome: String(p.nomeFirmatario).trim(),
      email: String(p.emailFirmatario || anag.email || '').trim(),
      cf: String(p.cfFirmatario || '').trim().toUpperCase(),
      versione: testo.versione,
      hashTesto: hashTesto,
      esito: esito,
      canali: LIB_CANALI_.map(function(c) { return c.chiave + '=' + (canali[c.chiave] ? 'SI' : 'NO'); }).join(';'),
      firmaUrl: firmaUrl,
      dichiarazione: dichiarazioni.join(' | '),
      userAgent: String(p.userAgent || '').slice(0, 250),
      tokenImpronta: String(rec._chiave).replace(LIB_CFG_.PROP_TK_PREFIX, '').slice(0, 16),
      pdfUrl: '',
    });

    _libAggiornaToken_(rec, { usatoIl: new Date().toISOString() });

    // ── Da qui in poi è tutto best-effort: il consenso è già registrato ─────
    let pdfUrl = '';
    try {
      pdfUrl = _libGeneraPDF_(ss, sheet, row, rec.idP);
    } catch (err) {
      traceLog_('[Liberatoria] WARN PDF non generato per ' + rec.idP + ': ' + (err && err.message ? err.message : err));
    }

    if (secondoGenitore && statoNuovo === LIB_STATI_.ATTESA2) {
      try {
        const token2 = _libCreaToken_(rec.idP, LIB_RUOLI_.GENITORE2, {
          cfAtteso: secondoGenitore.cf, nomeAtteso: secondoGenitore.nome,
        });
        inviaEmailLiberatoriaSecondoGenitore_(rowData, tipo, secondoGenitore, token2,
          String(p.nomeFirmatario).trim());
      } catch (err) {
        traceLog_('[Liberatoria] ERRORE invito al secondo genitore per ' + rec.idP + ': ' +
                  (err && err.message ? err.message : err));
      }
    }

    try {
      inviaEmailLiberatoriaEsito_(rowData, tipo, statoNuovo, canali, testo.versione, pdfUrl);
    } catch (err) {
      traceLog_('[Liberatoria] WARN email di esito non inviata: ' + (err && err.message ? err.message : err));
    }

    // ── Il rientro: senza questo, chi firma non riceve mai l'invito a pagare ─
    let sbloccato = null;
    try {
      sbloccato = sbloccaDopoLiberatoria_(sheet, row);
    } catch (err) {
      traceLog_('[Liberatoria] WARN sblocco dopo la firma non riuscito per ' + rec.idP + ': ' +
                (err && err.message ? err.message : err));
    }

    traceLog_('[Liberatoria] Risposta registrata per ' + rec.idP + ': ' + esito + ' / ' + statoNuovo +
              ' (ruolo ' + rec.ruolo + ').');

    return {
      ok: true, esito: esito, stato: statoNuovo, pdfUrl: pdfUrl,
      attesaSecondoGenitore: statoNuovo === LIB_STATI_.ATTESA2,
      nomeSecondoGenitore: secondoGenitore ? secondoGenitore.nome : '',
      prossimoPasso: (sbloccato && sbloccato.azione) || '',
    };

  } catch (err) {
    traceLog_('[Liberatoria] ERRORE registrazione: ' + (err && err.message ? err.message : err));
    return { ok: false, error: 'Non siamo riusciti a registrare la firma. Riprova o scrivi a ' + CONFIG.EMAIL_MITTENTE + '.' };
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

/**
 * Firma su Drive, nella cartella dedicata.
 * Mai TESSERE_FOLDER_ID: quella è condivisa, contiene documenti d'identità di
 * minori e ha fra gli autorizzati un account di prova.
 */
function _libSalvaFirmaDrive_(base64, idPratica, ruolo) {
  const contenuto = String(base64).split(',')[1] || String(base64);
  const blob = Utilities.newBlob(Utilities.base64Decode(contenuto), 'image/png',
    'Firma_' + idPratica + '_' + ruolo + '_' +
    Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyyMMdd-HHmmss') + '.png');
  return _libCartella_().createFile(blob).getUrl();
}

function _libCartella_() {
  const id = String(CONFIG.LIBERATORIE_FOLDER_ID || '').trim();
  if (!id) throw new Error('LIBERATORIE_FOLDER_ID non configurato: la cartella ristretta va creata a mano.');
  return DriveApp.getFolderById(id);
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. PDF DELLA LIBERATORIA FIRMATA
// ═════════════════════════════════════════════════════════════════════════════

/**
 * PDF da template Google Docs, non HTML→PDF: il renderer legacy di
 * Utilities.newBlob(...).getAs('application/pdf') non impagina e non rende in
 * modo affidabile le immagini in data URI. Con due firme il risultato
 * probabile sarebbero due riquadri vuoti, che è peggio di nessun PDF.
 *
 * Nota su DocumentApp: replaceText NON inserisce immagini. Il segnaposto si
 * trova con findText, si prende il paragrafo e si usa insertInlineImage.
 */
function _libGeneraPDF_(ss, sheet, row, idPratica) {
  const templateId = String(CONFIG.LIBERATORIA_TEMPLATE_ID || '').trim();
  const I = CONFIG.IDX;
  const rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  const tipo = String(rowData[I.TIPO_ASSOCIATO] || '').trim();
  const anag = getDatiAnagrafici_(rowData, tipo);
  const testo = libTestoCorrente_();
  const firme = _libFirmeDellaPratica_(ss, idPratica);

  const doc = templateId
    ? DocumentApp.openById(DriveApp.getFileById(templateId)
        .makeCopy('Liberatoria ' + idPratica + ' ' + (anag.cognome || ''), _libCartella_()).getId())
    : DocumentApp.create('Liberatoria ' + idPratica + ' ' + (anag.cognome || ''));

  try {
    const body = doc.getBody();
    if (!templateId) {
      // Senza template si compone il documento da zero: serve a non bloccare
      // il flusso se il template non è ancora stato creato a mano.
      body.appendParagraph(CONFIG.NOME_LEGALE).setHeading(DocumentApp.ParagraphHeading.HEADING3);
      body.appendParagraph(testo.titolo).setHeading(DocumentApp.ParagraphHeading.TITLE);
      body.appendParagraph('Versione ' + testo.versione + ' · in vigore dal ' + testo.inVigoreDal +
        ' · impronta del testo: ' + libHashTesto_(testo));
      body.appendParagraph('Pratica ' + idPratica + ' · ' + (anag.nome || '') + ' ' + (anag.cognome || '') +
        ' · ' + tipo);

      testo.premessa.forEach(function(par) { body.appendParagraph(par); });
      body.appendParagraph(testo.eventiCoperti);

      body.appendParagraph(testo.parteA.titolo).setHeading(DocumentApp.ParagraphHeading.HEADING2);
      testo.parteA.corpo.forEach(function(par) { body.appendParagraph(par); });

      const tab = [['Canale', 'Autorizzato']];
      LIB_CANALI_.forEach(function(c) {
        tab.push([c.etichetta, String(rowData[I[c.idx]] || '-').toUpperCase() === 'SI' ? 'SI' : 'NO']);
      });
      body.appendTable(tab).getRow(0).editAsText().setBold(true);

      body.appendParagraph(testo.parteB.titolo).setHeading(DocumentApp.ParagraphHeading.HEADING2);
      testo.parteB.corpo.forEach(function(par) { body.appendParagraph(par); });
      body.appendParagraph(testo.revoca.titolo).setHeading(DocumentApp.ParagraphHeading.HEADING2);
      testo.revoca.corpo.forEach(function(par) { body.appendParagraph(par); });
      body.appendParagraph(testo.durata);
      body.appendParagraph(testo.minori.titolo).setHeading(DocumentApp.ParagraphHeading.HEADING2);
      testo.minori.corpo.forEach(function(par) { body.appendParagraph(par); });
      body.appendParagraph(testo.titolare);
      body.appendParagraph(testo.firma);
      body.appendParagraph('Firme').setHeading(DocumentApp.ParagraphHeading.HEADING2);
    }

    // Le firme si inseriscono come immagini, una sotto l'altra.
    firme.forEach(function(f) {
      body.appendParagraph(_libEtichettaRuolo_(f.ruolo) + ' — ' + f.nome +
        ' · ' + f.registratoIl + ' · esito: ' + f.esito);
      if (f.firmaUrl) {
        try {
          const idFile = _libIdDaUrlDrive_(f.firmaUrl);
          if (idFile) {
            const par = body.appendParagraph('');
            par.appendInlineImage(DriveApp.getFileById(idFile).getBlob()).setWidth(220).setHeight(80);
          }
        } catch (e) {
          body.appendParagraph('[firma archiviata: ' + f.firmaUrl + ']');
        }
      }
      if (f.dichiarazione) body.appendParagraph(f.dichiarazione);
    });

    body.appendParagraph('Documento generato automaticamente il ' +
      Utilities.formatDate(new Date(), 'Europe/Rome', 'dd/MM/yyyy HH:mm') +
      ' · © ' + Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy') + ' ' + CONFIG.NOME_LEGALE +
      ' · Tutti i diritti riservati');

    doc.saveAndClose();

    const pdf = UrlFetchApp.fetch(
      'https://docs.google.com/document/d/' + doc.getId() + '/export?format=pdf',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true }
    ).getBlob().setName('Liberatoria_' + idPratica + '_v' + testo.versione + '.pdf');

    const file = _libCartella_().createFile(pdf);
    sheet.getRange(row, I.LIBERATORIA_PDF_URL + 1).setValue(file.getUrl());
    return file.getUrl();

  } finally {
    // La copia di lavoro va sempre cestinata, come in _fnGeneraPDF_.
    try { DriveApp.getFileById(doc.getId()).setTrashed(true); } catch(e) {}
  }
}

function _libEtichettaRuolo_(ruolo) {
  if (ruolo === LIB_RUOLI_.INTERESSATO) return 'L\'interessato';
  if (ruolo === LIB_RUOLI_.GENITORE1) return 'Primo genitore o tutore';
  if (ruolo === LIB_RUOLI_.GENITORE2) return 'Secondo genitore o tutore';
  return ruolo;
}

function _libIdDaUrlDrive_(url) {
  const m = String(url || '').match(/[-\w]{25,}/);
  return m ? m[0] : '';
}

/** Tutte le firme registrate per una pratica, in ordine. */
function _libFirmeDellaPratica_(ss, idPratica) {
  const sh = _libFoglio_(ss);
  const ultima = sh.getLastRow();
  if (ultima <= 1) return [];
  const valori = sh.getRange(2, 1, ultima - 1, LIB_INTESTAZIONI_.length).getValues();
  return valori.filter(function(v) { return String(v[2]).trim() === String(idPratica).trim(); })
    .map(function(v) {
      return { seq: v[0], registratoIl: v[1], ruolo: v[4], nome: v[5], esito: v[10],
               canali: v[11], firmaUrl: v[12], dichiarazione: v[13] };
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// 8. IL RIENTRO NEL FLUSSO
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Da chiamare appena una risposta è registrata.
 *
 * Senza questa funzione la liberatoria diventa un vicolo cieco: il job
 * differito che aveva trovato la precondizione mancante ha già cancellato la
 * propria chiave in ScriptProperties e `eliminaTriggerSeNessunJob_` ha rimosso
 * il trigger, quindi nessuno rivaluta più quella riga. Il Socio firmerebbe e
 * non riceverebbe mai l'invito a pagare.
 *
 * Modellata su attivaVolontariAmmessiInAttesaGenitore_ (2_TriggerAmmissione.gs).
 */
function sbloccaDopoLiberatoria_(sheet, row) {
  const I = CONFIG.IDX;
  const rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  const stato = String(rowData[I.STATO_DOMANDA] || '').trim();
  const idP = String(rowData[I.ID_PRATICA] || '').trim();

  if (stato !== 'Ammesso') return { azione: 'nessuna', motivo: 'Domanda non in stato Ammesso.' };
  if (String(rowData[I.MEMBRO_UFFICIALE] || '').trim().toUpperCase() === 'SI') {
    return { azione: 'nessuna', motivo: 'Già Membro ufficiale.' };
  }

  const check = verificaPrecondizioni_(rowData, sheet);

  if (check.ok) {
    traceLog_('[Liberatoria] ' + idP + ': precondizioni soddisfatte, avvio onboarding.');
    eseguiOnboarding_(sheet, row, rowData);
    return { azione: 'onboarding' };
  }

  if (check.inAttesaPagamento) {
    const guard = String(rowData[I.MAIL_INVITO_PAGAMENTO] || '').trim();
    if (guard === 'OK') return { azione: 'nessuna', motivo: 'Invito al pagamento già inviato.' };
    try {
      inviaEmailInvitoPagamento_(rowData, idP);
      sheet.getRange(row, I.MAIL_INVITO_PAGAMENTO + 1).setValue('OK');
      traceLog_('[Liberatoria] ' + idP + ': inviato l\'invito al pagamento dopo la firma.');
      return { azione: 'invito_pagamento' };
    } catch (err) {
      sheet.getRange(row, I.MAIL_INVITO_PAGAMENTO + 1).setValue('Errore');
      traceLog_('[Liberatoria] ERRORE invito al pagamento per ' + idP + ': ' + (err && err.message ? err.message : err));
      return { azione: 'errore_invito' };
    }
  }

  if (check.inAttesaGenitore) return { azione: 'nessuna', motivo: 'In attesa del genitore Socio Ordinario.' };
  if (check.inAttesaLiberatoria) return { azione: 'nessuna', motivo: 'Liberatoria ancora incompleta.' };
  return { azione: 'nessuna', motivo: check.motivo || 'Precondizioni non soddisfatte.' };
}

// ═════════════════════════════════════════════════════════════════════════════
// 9. RICHIESTA DELLA FIRMA (usata dal gate)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Chiede la liberatoria: un'email al Membro con il suo link e una alla
 * Presidenza, ognuna con il proprio guard sul modello di MAIL_INVITO_PAGAMENTO.
 *
 * `contesto` dice da dove arriva la richiesta ('ammissione', 'pagamento',
 * 'retroattivo'): serve alla Presidenza per capire se qualcuno è bloccato
 * davanti al pagamento o se è solo una pratica appena ammessa.
 *
 * Il cooldown è indispensabile: la pagina di pagamento può essere riaperta
 * dieci volte di seguito, e dieci email non aiutano nessuno.
 */
function libRichiediLiberatoria_(sheet, row, rowData, contesto) {
  const I = CONFIG.IDX;
  const idP = String(rowData[I.ID_PRATICA] || '').trim();
  const tipo = String(rowData[I.TIPO_ASSOCIATO] || '').trim();
  const props = PropertiesService.getScriptProperties();
  const esito = { inviataMembro: false, inviataPresidenza: false, contesto: contesto || '' };

  const chiaveNudge = LIB_CFG_.PROP_NUDGE + idP;
  const ultimo = Number(props.getProperty(chiaveNudge) || 0);
  if (ultimo && (Date.now() - ultimo) < LIB_CFG_.NUDGE_ORE * 3600000) {
    esito.saltata = true;
    return esito;
  }

  _assicuraColonne_(sheet, I.MAIL_LIBERATORIA_PRESIDENZA + 1);

  // ── Email al Membro (o al genitore firmatario, per i Volontari) ──────────
  const guardMembro = String(rowData[I.MAIL_LIBERATORIA_INVITO] || '').trim();
  if (guardMembro !== 'OK') {
    try {
      const ruolo = (tipo === 'Volontario') ? LIB_RUOLI_.GENITORE1 : LIB_RUOLI_.INTERESSATO;
      _libRevocaTokenPratica_(idP, ruolo);
      const token = _libCreaToken_(idP, ruolo);
      inviaEmailLiberatoriaInvito_(rowData, tipo, token, contesto);
      sheet.getRange(row, I.MAIL_LIBERATORIA_INVITO + 1).setValue('OK');
      esito.inviataMembro = true;
      traceLog_('[Liberatoria] Invito alla firma inviato per ' + idP + ' (' + contesto + ').');
    } catch (err) {
      sheet.getRange(row, I.MAIL_LIBERATORIA_INVITO + 1).setValue('Errore');
      traceLog_('[Liberatoria] ERRORE invito alla firma per ' + idP + ': ' + (err && err.message ? err.message : err));
    }
  }

  // ── Email dedicata alla Presidenza ──────────────────────────────────────
  const guardPres = String(rowData[I.MAIL_LIBERATORIA_PRESIDENZA] || '').trim();
  if (guardPres !== 'OK') {
    try {
      inviaEmailLiberatoriaPresidenza_(rowData, tipo, contesto);
      sheet.getRange(row, I.MAIL_LIBERATORIA_PRESIDENZA + 1).setValue('OK');
      esito.inviataPresidenza = true;
    } catch (err) {
      sheet.getRange(row, I.MAIL_LIBERATORIA_PRESIDENZA + 1).setValue('Errore');
      traceLog_('[Liberatoria] WARN avviso alla Presidenza non inviato per ' + idP + ': ' +
                (err && err.message ? err.message : err));
    }
  }

  props.setProperty(chiaveNudge, String(Date.now()));
  return esito;
}

/**
 * Link di firma per una pratica, da eseguire a mano quando qualcuno chiede di
 * riceverlo di nuovo. Revoca il link precedente: un collegamento inoltrato
 * mesi prima non deve restare valido.
 */
function liberatoriaCreaLinkPerPratica(idPratica, ruolo) {
  const trovata = trovaRigaPerIdPratica_(idPratica);
  if (!trovata || !trovata.row) {
    Logger.log('[Liberatoria] Pratica non trovata: ' + idPratica);
    return null;
  }
  const I = CONFIG.IDX;
  const tipo = String(trovata.rowData[I.TIPO_ASSOCIATO] || '').trim();
  const r = ruolo || ((tipo === 'Volontario') ? LIB_RUOLI_.GENITORE1 : LIB_RUOLI_.INTERESSATO);
  _libRevocaTokenPratica_(idPratica, r);
  const token = _libCreaToken_(idPratica, r);
  const url = libUrlFirma_(token);
  Logger.log('[Liberatoria] Link per ' + idPratica + ' (' + r + '), valido ' +
             LIB_CFG_.GIORNI_VALIDITA + ' giorni:');
  Logger.log('  ' + url);
  Logger.log('Non inoltrarlo a nessun altro: vale come firma.');
  return url;
}

function libUrlFirma_(token) {
  let base = '';
  try { base = ScriptApp.getService().getUrl() || ''; } catch(e) {}
  if (!base) base = 'https://' + CONFIG.DOMINIO;
  return base + '?pagina=liberatoria&t=' + encodeURIComponent(token);
}

// ═════════════════════════════════════════════════════════════════════════════
// 10. CAMPAGNA RETROATTIVA E PROMEMORIA
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Manda il link della liberatoria ai Membri già ufficiali, a lotti.
 *
 * Il cursore sta in ScriptProperties perché i limiti sono due e veri: sei
 * minuti per esecuzione e 1500 email al giorno. Si rilancia finché il log dice
 * che non resta nessuno.
 */
function inviaLinkLiberatoriaRetroattivo() {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  const I = CONFIG.IDX;
  const dati = sheet.getDataRange().getValues();
  const partenza = Number(props.getProperty(LIB_CFG_.PROP_CURSORE) || 1);
  const avvio = Date.now();

  let inviate = 0, saltate = 0, i = partenza;

  for (; i < dati.length; i++) {
    if (inviate >= LIB_CFG_.MAX_RETRO_BATCH || (Date.now() - avvio) > 4.5 * 60 * 1000) break;

    const rowData = dati[i];
    const ufficiale = String(rowData[I.MEMBRO_UFFICIALE] || '').trim().toUpperCase() === 'SI';
    const cessato = !!cessazioneRegistrata_(rowData);
    const st = statoLiberatoria_(rowData);

    if (!ufficiale || cessato || st.stato === LIB_STATI_.REGISTRATA || st.stato === LIB_STATI_.NEGATA) {
      saltate++;
      continue;
    }
    try {
      libRichiediLiberatoria_(sheet, i + 1, rowData, 'retroattivo');
      inviate++;
    } catch (err) {
      traceLog_('[Liberatoria] ERRORE campagna retroattiva su riga ' + (i + 1) + ': ' +
                (err && err.message ? err.message : err));
    }
  }

  if (i >= dati.length) {
    props.deleteProperty(LIB_CFG_.PROP_CURSORE);
    Logger.log('[Liberatoria] Campagna retroattiva COMPLETATA. Inviate in questo lotto: ' + inviate +
               ', saltate: ' + saltate + '.');
  } else {
    props.setProperty(LIB_CFG_.PROP_CURSORE, String(i));
    Logger.log('[Liberatoria] Lotto terminato alla riga ' + i + '. Inviate: ' + inviate +
               ', saltate: ' + saltate + '. Rilancia la funzione per continuare.');
  }
  return { inviate: inviate, saltate: saltate, prossimaRiga: i < dati.length ? i : null };
}

/**
 * Promemoria a chi non ha ancora risposto, a 30, 15 e 7 giorni dalla scadenza
 * della quota, più una card alla Presidenza alla scadenza.
 *
 * Non si blocca il rinnovo: un rinnovo Stripe si ferma solo cancellando
 * l'abbonamento, e quello farebbe partire il flusso di annullamento con le
 * email al socio e ai Volontari collegati. Sarebbe una sanzione sproporzionata
 * per non aver cliccato un link — e comunque una sanzione la decide la
 * Presidenza, non il software.
 */
function liberatoriaPromemoriaRinnovi_() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  const I = CONFIG.IDX;
  const dati = sheet.getDataRange().getValues();
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const soglie = [30, 15, 7];
  const scaduti = [];
  let promemoria = 0;

  for (let i = 1; i < dati.length; i++) {
    const rowData = dati[i];
    if (String(rowData[I.MEMBRO_UFFICIALE] || '').trim().toUpperCase() !== 'SI') continue;
    if (cessazioneRegistrata_(rowData)) continue;

    const st = statoLiberatoria_(rowData);
    if (st.stato === LIB_STATI_.REGISTRATA || st.stato === LIB_STATI_.NEGATA) continue;

    const scad = rowData[I.DATA_SCADENZA_QUOTA];
    if (!scad) continue;
    const d = (scad instanceof Date) ? new Date(scad.getTime()) : new Date(scad);
    if (isNaN(d.getTime())) continue;
    d.setHours(0, 0, 0, 0);

    const giorni = Math.round((d.getTime() - oggi.getTime()) / 86400000);
    if (soglie.indexOf(giorni) !== -1) {
      try {
        // Il guard della mail viene azzerato: è un promemoria, non un duplicato.
        sheet.getRange(i + 1, I.MAIL_LIBERATORIA_INVITO + 1).setValue('-');
        PropertiesService.getScriptProperties()
          .deleteProperty(LIB_CFG_.PROP_NUDGE + String(rowData[I.ID_PRATICA] || '').trim());
        libRichiediLiberatoria_(sheet, i + 1, rowData, 'promemoria a ' + giorni + ' giorni dal rinnovo');
        promemoria++;
      } catch (err) {
        traceLog_('[Liberatoria] WARN promemoria non inviato su riga ' + (i + 1) + ': ' +
                  (err && err.message ? err.message : err));
      }
    } else if (giorni <= 0) {
      const anag = getDatiAnagrafici_(rowData, String(rowData[I.TIPO_ASSOCIATO] || ''));
      scaduti.push((anag.nome || '') + ' ' + (anag.cognome || '') +
                   ' (' + String(rowData[I.ID_PRATICA] || '') + ')');
    }
  }

  if (scaduti.length) {
    try {
      inviaNotificaLiberatoriaScadute_(scaduti);
    } catch (err) {
      traceLog_('[Liberatoria] WARN card alla Presidenza non inviata: ' + (err && err.message ? err.message : err));
    }
  }
  if (promemoria || scaduti.length) {
    traceLog_('[Liberatoria] Promemoria inviati: ' + promemoria + ' · senza risposta oltre la scadenza: ' + scaduti.length);
  }
  return { promemoria: promemoria, scaduti: scaduti.length };
}
