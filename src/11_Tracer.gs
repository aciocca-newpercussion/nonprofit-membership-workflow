/**
 * MODULO: 11_Tracer.gs
 * ============================================================================
 * Tracciamento live del workflow.
 *
 * Scrive ogni log anche in uno spreadsheet separato da "Risposte", cosi le righe
 * di log non attivano RouterModuli/onChange sul foglio operativo.
 *
 * Setup consigliato prima della produzione:
 *   1. Esegui inizializzaTracciamentoLive()
 *   2. Apri l'URL stampato nei log
 *   3. Tieni aperto il tab "Eventi" per vedere il workflow in tempo reale
 */

const TRACE_CFG_ = {
  PROP_SPREADSHEET_ID: 'WF_TRACE_SPREADSHEET_ID',
  PROP_ENABLED:        'WF_TRACE_ENABLED',
  SHEET_EVENTI:        'Eventi',
  MAX_MESSAGE_LEN:     30000,
  MAX_META_LEN:        20000,
};

var __TRACE_RUN_ID_ = null;
var __TRACE_SEQ_ = 0;
var __TRACE_SPREADSHEET_ID_ = null;
var __TRACE_READY_ = false;

function traceLog_(msg, meta) {
  const text = sanitizzaTrace_(normalizzaTraceMessage_(msg));

  try { console.log(text); } catch(e) {}
  Logger.log(text);

  if (!tracciamentoLiveAbilitato_()) return;

  try {
    const ss = getTraceSpreadsheet_();
    ensureTraceSpreadsheet_(ss);

    const level = inferTraceLevel_(text);
    const source = inferTraceSource_(text);
    const metaJson = meta === undefined ? '' : troncaTrace_(safeTraceJson_(meta), TRACE_CFG_.MAX_META_LEN);

    ss.getSheetByName(TRACE_CFG_.SHEET_EVENTI).appendRow([
      new Date(),
      getTraceRunId_(),
      ++__TRACE_SEQ_,
      level,
      source,
      troncaTrace_(text, TRACE_CFG_.MAX_MESSAGE_LEN),
      metaJson,
      getTraceUser_(),
    ]);
  } catch (err) {
    // Non deve mai rompere il workflow principale.
    Logger.log('[Trace] WARN: log live non scritto: ' + (err && err.message ? err.message : err));
  }
}

function traceStep_(source, message, meta) {
  traceLog_('[' + source + '] ' + message, meta);
}

function inizializzaTracciamentoLive() {
  const ss = getTraceSpreadsheet_();
  ensureTraceSpreadsheet_(ss);
  PropertiesService.getScriptProperties().setProperty(TRACE_CFG_.PROP_ENABLED, 'true');
  Logger.log('[Trace] Tracciamento live attivo: ' + ss.getUrl());
  return ss.getUrl();
}

function apriTracciamentoLive() {
  const id = PropertiesService.getScriptProperties().getProperty(TRACE_CFG_.PROP_SPREADSHEET_ID);
  if (!id) {
    Logger.log('[Trace] Nessun log live configurato. Esegui inizializzaTracciamentoLive().');
    return null;
  }
  const url = SpreadsheetApp.openById(id).getUrl();
  Logger.log('[Trace] Log live: ' + url);
  return url;
}

function attivaTracciamentoLive() {
  PropertiesService.getScriptProperties().setProperty(TRACE_CFG_.PROP_ENABLED, 'true');
  Logger.log('[Trace] Tracciamento live abilitato.');
}

function disattivaTracciamentoLive() {
  PropertiesService.getScriptProperties().setProperty(TRACE_CFG_.PROP_ENABLED, 'false');
  Logger.log('[Trace] Tracciamento live disabilitato.');
}

function tracciamentoLiveAbilitato_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(TRACE_CFG_.PROP_ENABLED);
    if (raw === null || raw === undefined || raw === '') return true;
    return String(raw).toLowerCase() !== 'false' && String(raw) !== '0';
  } catch(e) {
    return false;
  }
}

function getTraceSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = __TRACE_SPREADSHEET_ID_ || props.getProperty(TRACE_CFG_.PROP_SPREADSHEET_ID);

  if (!id) {
    const ss = SpreadsheetApp.create('{{NOME_GRUPPO}} Workflow Live Log');
    id = ss.getId();
    props.setProperty(TRACE_CFG_.PROP_SPREADSHEET_ID, id);
    __TRACE_SPREADSHEET_ID_ = id;
    __TRACE_READY_ = false;
    return ss;
  }

  __TRACE_SPREADSHEET_ID_ = id;
  return SpreadsheetApp.openById(id);
}

function ensureTraceSpreadsheet_(ss) {
  if (__TRACE_READY_) return;

  let sh = ss.getSheetByName(TRACE_CFG_.SHEET_EVENTI);
  if (!sh) {
    sh = ss.insertSheet(TRACE_CFG_.SHEET_EVENTI);
  }

  if (sh.getLastRow() === 0) {
    sh.appendRow(['Timestamp', 'Run ID', 'Seq', 'Level', 'Source', 'Messaggio', 'Meta JSON', 'Utente']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 8)
      .setFontWeight('bold')
      .setBackground('{{COLORE_BLU}}')
      .setFontColor('#FFFFFF');
    sh.autoResizeColumns(1, 8);
  }

  // Rimuove il foglio vuoto creato automaticamente da SpreadsheetApp.create().
  const sheets = ss.getSheets();
  if (sheets.length > 1) {
    sheets.forEach(function(s) {
      if (s.getName() !== TRACE_CFG_.SHEET_EVENTI && s.getLastRow() === 0) {
        try { ss.deleteSheet(s); } catch(e) {}
      }
    });
  }

  __TRACE_READY_ = true;
}

function getTraceRunId_() {
  if (!__TRACE_RUN_ID_) {
    const ts = Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyyMMdd-HHmmss');
    __TRACE_RUN_ID_ = ts + '-' + Utilities.getUuid().slice(0, 8);
  }
  return __TRACE_RUN_ID_;
}

function inferTraceLevel_(text) {
  const t = String(text || '').toUpperCase();
  if (t.includes('ERRORE') || t.includes('ERROR') || t.includes('FALLIT') || t.includes('NON VALIDA')) return 'ERROR';
  if (t.includes('WARN') || t.includes('ATTENZIONE') || t.includes('SKIP') || t.includes('KO')) return 'WARN';
  if (t.includes('START') || t.includes('===') || t.includes('COMPLETATO')) return 'STEP';
  return 'INFO';
}

function inferTraceSource_(text) {
  const s = String(text || '');
  const bracket = s.match(/^\[([^\]]+)\]/);
  if (bracket && bracket[1]) return bracket[1];
  const title = s.match(/^=+\s*([^=]+?)\s*=+$/);
  if (title && title[1]) return title[1].trim();
  const prefix = s.match(/^([A-Za-z0-9_ +.-]+):/);
  if (prefix && prefix[1]) return prefix[1].trim();
  return 'Workflow';
}

function getTraceUser_() {
  try {
    const active = Session.getActiveUser().getEmail();
    if (active) return active;
  } catch(e) {}
  try {
    const effective = Session.getEffectiveUser().getEmail();
    if (effective) return effective;
  } catch(e2) {}
  return '';
}

function normalizzaTraceMessage_(msg) {
  if (msg === null || msg === undefined) return '';
  if (typeof msg === 'string') return msg;
  return safeTraceJson_(msg);
}

function safeTraceJson_(value) {
  try {
    return JSON.stringify(value);
  } catch(e) {
    return String(value);
  }
}

function troncaTrace_(text, maxLen) {
  const s = String(text || '');
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen) + '... [TRONCATO]';
}

function sanitizzaTrace_(text) {
  return String(text || '')
    .replace(/sk_(test|live)_[A-Za-z0-9]+/g, function(match) {
      return match.substring(0, 12) + '...[MASKED]';
    })
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[MASKED]')
    .replace(/(client_secret=)[^&\s]+/gi, '$1[MASKED]')
    .replace(/(password\s*[:=]\s*)[^,\n\r]+/gi, '$1[MASKED]');
}
