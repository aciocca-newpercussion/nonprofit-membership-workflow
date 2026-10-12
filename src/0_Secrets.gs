/**
 * MODULO: 0_Secrets.gs
 * ══════════════════════════════════════════════════════════════════════
 * File unico per tutti i dati sensibili.
 *
 * ⚠️  NON CONDIVIDERE QUESTO FILE — NON COMMITTARLO SU GIT
 *      Non include nomi di variabili pubblici, solo valori privati.
 *      Quando condividi il codice con altri (es. AI), escludi questo file.
 *
 * COME USARLO IN MODO ANCORA PIÙ SICURO:
 *  Invece di lasciare i valori in chiaro nel codice, puoi salvarli
 *  nelle Script Properties (Extensions > Project Settings > Script Properties)
 *  e leggere con PropertiesService.getScriptProperties().getProperty('CHIAVE').
 *  Questo file è un'alternativa più comoda per uso interno.
 */

const SECRETS = {

  // ── Google Chat ──────────────────────────────────────────────────────────
  // Legacy/fallback webhook (compatibilità)
  CHAT_WEBHOOK_URL: '{{CHAT_WEBHOOK_URL}}',
  // Nuove richieste di ammissione (RouterModuli / Mail1)
  CHAT_WEBHOOK_URL_RICHIESTE: '{{CHAT_WEBHOOK_URL_RICHIESTE}}',
  // Conferme/esiti ammissione (Ammesso/Rifiutato)
  CHAT_WEBHOOK_URL_CONFERME:  '{{CHAT_WEBHOOK_URL_CONFERME}}',

  // ── Stripe ───────────────────────────────────────────────────────────────
  STRIPE_SECRET_KEY:      '{{STRIPE_SECRET_KEY}}',
  STRIPE_WEBHOOK_SECRET:  '{{STRIPE_WEBHOOK_SECRET}}',

  // ── Microsoft Azure AD ───────────────────────────────────────────────────
  M365_TENANT_ID:     '{{M365_TENANT_ID}}',
  M365_CLIENT_ID:     '{{M365_CLIENT_ID}}',
  M365_CLIENT_SECRET: '{{M365_CLIENT_SECRET}}',
  M365_LICENSE_SKU:   '{{M365_LICENSE_SKU}}',

  // ── Service Account GCP (per Domain-Wide Delegation firma Gmail) ─────────
  SA_CLIENT_EMAIL: '{{SA_CLIENT_EMAIL}}',
  SA_PRIVATE_KEY:  '{{SA_PRIVATE_KEY}}',

  // ── Link risorse ─────────────────────────────────────────────────────────
  // Cartella Google Drive con le guide PDF per i nuovi membri
  DRIVE_GUIDE_URL: '{{DRIVE_GUIDE_URL}}',

  // ── Link al database ─────────────────────────────────────────────────────
  MEMBER_PORTAL_URL: '{{MEMBER_PORTAL_URL}}',

  // ── Ponte Supabase (19_SupabaseSync.gs) ──────────────────────────────────
  // SUPABASE_SYNC_SECRET deve combaciare ESATTAMENTE con il secret Supabase
  // WORKFLOW_SYNC_SECRET (progetto {{SUPABASE_PROJECT_REF}}, Edge Function
  // "workflow-membership-sync") — vanno impostati insieme, mai uno solo.
  SUPABASE_SYNC_URL:    '{{SUPABASE_SYNC_URL}}',
  SUPABASE_SYNC_SECRET: '{{SUPABASE_SYNC_SECRET}}',

  // ── Google Drive / Sheets IDs ─────────────────────────────────────────────
  SHEET_ID:           '{{SHEET_ID}}',
  SLIDES_TEMPLATE_ID: '{{SLIDES_TEMPLATE_ID}}',
  TESSERE_FOLDER_ID:  '{{TESSERE_FOLDER_ID}}',
  LINK_FOGLIO_FISSO:  '{{LINK_FOGLIO_FISSO}}',

  // ── Liberatoria immagini (22_LiberatoriaWebApp.gs) ───────────────────────
  // Cartella DEDICATA ai PDF e alle firme. Non riusare TESSERE_FOLDER_ID:
  // quella contiene documenti d'identita' ed e' condivisa piu' largamente.
  LIBERATORIE_FOLDER_ID:   '{{LIBERATORIE_FOLDER_ID}}',
  LIBERATORIA_TEMPLATE_ID: '{{LIBERATORIA_TEMPLATE_ID}}',

  // ── Registro degli Eventi (21_RegistroEventi.gs) ──────────────────────────
  REGISTRO_EVENTI_SHEET_ID: '{{REGISTRO_EVENTI_SHEET_ID}}',
  CALENDARI_REGISTRO: {},   // { chiave: 'id-del-calendario@group.calendar.google.com' }

  // ── Documenti allegati alla domanda di iscrizione ─────────────────────────
  DOCUMENTI_FOLDER_ID: '{{DRIVE_FOLDER_ID}}',

  // ── Dati di incasso ───────────────────────────────────────────────────────
  IBAN_ENTE: '{{IBAN_ENTE}}',


  // ── Logo ──────────────────────────────────────────────────────────────────
  LOGO_URL: '{{LOGO_URL}}',
};
