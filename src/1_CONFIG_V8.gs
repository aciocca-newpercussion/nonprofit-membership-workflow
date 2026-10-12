/**
 * MODULO: 1_CONFIG_V8.gs
 * ══════════════════════════════════════════════════════════════════════
 * Configurazione strutturale — legge i valori sensibili da 0_Secrets.gs.
 * Non contiene API key o password: quelle stanno tutte in 0_Secrets.gs.
 */

const CONFIG = {

  // ── Identità ─────────────────────────────────────────────────────────────
  get LOGO_URL()    { return SECRETS.LOGO_URL; },
  NOME_GRUPPO: '{{NOME_GRUPPO}}',
  NOME_LEGALE: '{{NOME_LEGALE}}',
  CF:          '{{CF}}',
  SITO_WEB:    '{{SITO_WEB}}',
  DOMINIO:     '{{DOMINIO}}',

  // ── Email ─────────────────────────────────────────────────────────────────
  EMAIL_MITTENTE:     '{{EMAIL_MITTENTE}}',
  EMAIL_ADMIN_ERRORI: '{{EMAIL_MITTENTE}}',
  EMAIL_TRANSITO_E_VERIFICA:      '{{EMAIL_TRANSITO_E_VERIFICA}}',

  // ── IDs fogli e template ─────────────────────────────────────────────────
  get SHEET_ID()           { return SECRETS.SHEET_ID; },
  SHEET_NAME:         '{{SHEET_NAME}}',
  SHEET_STORICO:      '{{SHEET_STORICO}}',
  // Libro degli associati (art. 15 c.1 lett. a D.Lgs. 117/2017) e registro dei
  // volontari: due estrazioni di 20_LibriSociali.gs. 'Risposte' è l'archivio
  // delle domande, questi due sono i libri.
  SHEET_LIBRO_ASSOCIATI: 'Libro degli Associati',
  // Registro dei volontari non occasionali (art. 17 c.1 D.Lgs. 117/2017) —
  // foglio a parte, come 'Storico' e 'Note Presidenza': è un libro con una sua
  // vita, non quattro colonne in più su 'Risposte'. Generato/allineato da
  // generaRegistroVolontari() in 20_LibriSociali.gs.
  SHEET_REGISTRO_VOLONTARI: 'Registro Volontari',
  get SLIDES_TEMPLATE_ID() { return SECRETS.SLIDES_TEMPLATE_ID; },
  get TESSERE_FOLDER_ID()  { return SECRETS.TESSERE_FOLDER_ID; },

  // ── Liberatoria firmata (22_LiberatoriaWebApp.gs) ────────────────────────
  // Foglio dei consensi firmati: a parte come 'Storico' e 'Note Presidenza',
  // in sola aggiunta e con la stessa catena di impronte del registro eventi.
  SHEET_LIBERATORIE: 'Liberatorie',
  // Cartella Drive dedicata ai PDF firmati. **Non** TESSERE_FOLDER_ID: quella è
  // condivisa, disordinata e contiene già documenti d'identità di minori.
  get LIBERATORIE_FOLDER_ID()   { return SECRETS.LIBERATORIE_FOLDER_ID || ''; },
  get LIBERATORIA_TEMPLATE_ID() { return SECRETS.LIBERATORIA_TEMPLATE_ID || ''; },
  // Interruttore del gate sul pagamento. Spegnerlo NON richiede un nuovo
  // deployment: serve a fermare in pochi secondi un blocco che si riveli
  // sbagliato, senza lasciare fuori chi sta pagando in quel momento.
  //
  // ⚠️ Nasce SPENTO di proposito. Con il gate acceso, il minuto stesso in cui i
  // file finiscono nell'editor nessun Socio ammesso riesce più a pagare finché
  // non firma — comprese le pratiche già in corso, che non hanno mai ricevuto
  // l'invito. Si accende DOPO la prova end-to-end su una riga di collaudo e
  // dopo la campagna retroattiva, che è l'ordine descritto nel piano.
  LIBERATORIA_GATE_ATTIVO: false,
  // Versione del testo in vigore. Cambiare il testo senza cambiare questa
  // stringa significa attribuire a una firma parole che non sono state lette.
  LIBERATORIA_VERSIONE_CORRENTE: '2026.1',

  // ── Registro degli Eventi (21_RegistroEventi.gs) ─────────────────────────
  // I calendari di cui si conserva la storia. Gli ID stanno in SECRETS per
  // coerenza con gli altri identificativi, non perché siano segreti: due dei
  // tre sono già pubblici nel bundle del sito.
  get CALENDARI_REGISTRO()      { return SECRETS.CALENDARI_REGISTRO || {}; },
  get REGISTRO_EVENTI_SHEET_ID(){ return SECRETS.REGISTRO_EVENTI_SHEET_ID || ''; },

  // ── Link di riferimento ───────────────────────────────────────────────────
  get PORTAL_BASE_URL()    { return SECRETS.MEMBER_PORTAL_URL; },

  // ── Ponte Supabase (19_SupabaseSync.gs) ──────────────────────────────────
  // Vuoti finché non vengono aggiunti a 0_Secrets.gs: _supabaseSyncPost_
  // salta la chiamata (SKIP loggato) invece di fallire, così l'assenza di
  // questa configurazione non blocca mai onboarding o pagamento reale.
  get SUPABASE_SYNC_URL()    { return SECRETS.SUPABASE_SYNC_URL; },
  get SUPABASE_SYNC_SECRET() { return SECRETS.SUPABASE_SYNC_SECRET; },

  // ── Google Chat ───────────────────────────────────────────────────────────
  get CHAT_WEBHOOK_URL()             { return SECRETS.CHAT_WEBHOOK_URL || ''; },
  get CHAT_WEBHOOK_URL_RICHIESTE()   { return SECRETS.CHAT_WEBHOOK_URL_RICHIESTE || SECRETS.CHAT_WEBHOOK_URL || ''; },
  get CHAT_WEBHOOK_URL_CONFERME()    { return SECRETS.CHAT_WEBHOOK_URL_CONFERME  || SECRETS.CHAT_WEBHOOK_URL || ''; },
  CALENDAR_ID:         '{{CALENDAR_ID}}',
  FALLBACK_MEET_URL:   'https://meet.google.com/',
  NOME_CODA_PROPRIETA: 'CODA_NOTIFICHE_CHAT',
  get LINK_FOGLIO_FISSO() { return SECRETS.LINK_FOGLIO_FISSO; },

  // ── Google Workspace Groups ───────────────────────────────────────────────
  // Le chiavi devono corrispondere ESATTAMENTE ai valori nella colonna AM
  WORKSPACE_GROUPS: {
    'Presidenza':        '{{GROUP_PRESIDENZA}}',
    'Assemblea dei Soci':'{{GROUP_SOCI}}',
    'Volontari':         '{{GROUP_VOLONTARI}}',
  },

  // ── Cause di cessazione del rapporto associativo (Statuto Art. 9.1) ──────
  // Cinque cause, cinque procedure diverse. La tabella tiene insieme la causa,
  // lo stato che finisce in AK e l'organo competente, perché è esattamente la
  // distinzione che il codice sbagliava: usare 'Decaduto' per un'espulsione fa
  // dire al libro soci una cosa che non è successa.
  CAUSE_CESSAZIONE: {
    'Decadenza': {
      stato: 'Decaduto', articolo: 'Art. 9.1.b',
      organo: 'Presidenza (accertamento)',
      descrizione: 'Mancato pagamento della quota associativa annuale.',
    },
    'Recesso': {
      stato: 'Receduto', articolo: 'Art. 9.5',
      organo: 'Socio (comunicazione scritta al Presidente)',
      descrizione: 'Recesso volontario comunicato per iscritto al Presidente.',
    },
    'Espulsione': {
      stato: 'Espulso', articolo: 'Art. 9.3',
      organo: 'Assemblea dei Soci, su proposta della Presidenza',
      descrizione: 'Misura disciplinare deliberata dall\'Assemblea dopo contraddittorio.',
    },
    'Incapacita': {
      stato: 'Cessato', articolo: 'Art. 9.1.a',
      organo: 'Presidenza (accertamento)',
      etichetta: 'Perdita della capacità di agire',
      descrizione: 'Sentenza che accerta l\'infermità di mente o interdizione legale.',
    },
    'Decesso': {
      stato: 'Cessato', articolo: 'Art. 9.1.e',
      organo: 'Presidenza (accertamento)',
      descrizione: 'Decesso dell\'associato.',
    },
  },

  // ── Assicurazione dei volontari (art. 18 D.Lgs. 117/2017) ────────────────
  // Obbligatoria per i volontari iscritti nel registro: infortuni, malattie
  // connesse all'attività e responsabilità civile verso terzi. Qui stanno solo
  // gli estremi da riportare nel registro; la polizza la stipula e la rinnova
  // la Presidenza. Finché POLIZZA_N è vuoto, generaRegistroVolontari() scrive
  // il registro segnalando la copertura come non documentata: è la condizione
  // che va vista, non nascosta.
  //
  // Compila i tre campi PRIMA di aprire le iscrizioni ai volontari: il
  // registro dell'art. 17 e' anche il documento su cui si dimostra la
  // copertura dell'art. 18, e senza polizza l'attivita' di volontariato
  // non e' in regola. Finche' POLIZZA_N e' vuoto il registro viene
  // generato con «DA DOCUMENTARE» nelle tre celle: e' una condizione che
  // va vista, non nascosta.
  ASSICURAZIONE_VOLONTARI: {
    COMPAGNIA:   '',
    POLIZZA_N:   '',
    SCADENZA:    '',   // 'gg/mm/aaaa'
  },

  // ── Stripe ────────────────────────────────────────────────────────────────
  get STRIPE() {
    return {
      SECRET_KEY:      SECRETS.STRIPE_SECRET_KEY,
      WEBHOOK_SECRET:  SECRETS.STRIPE_WEBHOOK_SECRET,
      QUOTA_CENTESIMI: {{STRIPE_QUOTA_CENTESIMI}},
      CURRENCY:        '{{STRIPE_CURRENCY}}',
      // Finestra entro cui un checkout avviato ma non ancora completato blocca
      // un nuovo tentativo di pagamento per la stessa pratica — vedi
      // avviaPagamentoQuota (16_ModuloPagamentoWebApp.gs) e
      // creaCheckoutSessionQuotaSocio_ (3_StripeAdmin.gs).
      CHECKOUT_TTL_MIN: 30,
    };
  },

  // ── Microsoft 365 ─────────────────────────────────────────────────────────
  get M365() {
    return {
      TENANT_ID:      SECRETS.M365_TENANT_ID,
      CLIENT_ID:      SECRETS.M365_CLIENT_ID,
      CLIENT_SECRET:  SECRETS.M365_CLIENT_SECRET,
      DOMAIN:         '{{M365_DOMAIN}}',
      LICENSE_SKU_ID: SECRETS.M365_LICENSE_SKU,
      EXCLUDED_PLANS: [],
    };
  },

  // ── Brand ─────────────────────────────────────────────────────────────────
  COLORI: { BLU: '{{COLORE_BLU}}', ARANCIO: '{{COLORE_ARANCIO}}', BEIGE: '{{COLORE_BEIGE}}' },

  // ── Colonne foglio (0-based) ──────────────────────────────────────────────
  IDX: {
    DATA_SUBMISSION:          0,  // A
    TIPO_ASSOCIATO:           1,  // B  Socio Ordinario | Volontario
    SESSO_SOCIO:              2,  // C
    NOME_SOCIO:               3,  // D
    COGNOME_SOCIO:            4,  // E
    CF_SOCIO:                 5,  // F
    DATA_NASCITA_SOCIO:       6,  // G
    EMAIL_SOCIO:              7,  // H
    TEL_SOCIO:                8,  // I
    PRODOTTO:                 9,  // J
    SESSO_VOLONTARIO:        10,  // K
    NOME_VOLONTARIO:         11,  // L
    COGNOME_VOLONTARIO:      12,  // M
    CF_VOLONTARIO:           13,  // N
    DATA_NASCITA_VOLONTARIO: 14,  // O
    EMAIL_VOLONTARIO:        15,  // P
    TEL_VOLONTARIO:          16,  // Q
    CF_GENITORE:             17,  // R
    ID_PRATICA_GENITORE:     18,  // S
    FILE_DOC_IDENTITA:       19,  // T
    TC_POLITICHE:            20,  // U
    TC_PRIVACY:              21,  // V
    TC_STATUTO:              22,  // W
    FIRMA_SOCIO:             23,  // X
    FIRMA_GENITORE:          24,  // Y
    DATA_INVIO:              25,  // Z
    ORA_INVIO:               26,  // AA
    ID_PRATICA:              27,  // AB
    SUBMISSION_IP:           28,  // AC
    SUBMISSION_URL:          29,  // AD
    EDIT_URL:                30,  // AE
    LAST_UPDATE:             31,  // AF
    PAYER_INFO:              32,  // AG
    PAYER_ADDRESS:           33,  // AH
    SUBMISSION_ID:           34,  // AI
    // Gestionali
    EMAIL_ISTITUZIONALE:     35,  // AJ ← monitorata per storico
    // AK  In Corso | Ammesso | Rifiutato | Duplicato | Errore | Errore Tipo
    //     · stati terminali di cessazione (Statuto Art. 9.1, uno per causa):
    //       Decaduto (mancato pagamento) | Receduto | Espulso | Cessato
    //       (incapacità, decesso). La causa in chiaro sta in CAUSA_CESSAZIONE.
    STATO_DOMANDA:           36,  // AK
    DATA_AMMISSIONE:         37,  // AL ← monitorata
    GRUPPO:                  38,  // AM ← monitorata
    RIFIUTATO_PERCHE:        39,  // AN ← monitorata
    STATO_PAGAMENTO:         40,  // AO ← monitorata
	  MEMBRO_UFFICIALE:        41,  // AP ← monitorata; compilata automaticamente dallo script
    ESPULSO:                 42,  // AQ ← monitorata
    ESPULSO_PERCHE:          43,  // AR ← monitorata
    // Aggiunte da inizializzaColonneAggiuntive()
    ID_TRANSAZIONE:          44,  // AS
    STRIPE_SUB_ID:           45,  // AT
    STRIPE_CUSTOMER_ID:      46,  // AU
    DATA_SCADENZA_QUOTA:     47,  // AV
    DATA_ULTIMO_RINNOVO:     48,  // AW
    RUOLO_ASSOCIATIVO:       49,  // AX ← monitorata
    // Tracciamento azioni (AY–BI)
    MAIL_1_SOCIO:               50,  // AY
    MAIL_RISPOSTA_SOCIO:        51,  // AZ
    MAIL_RISPOSTA_VOLONTARIO:   52,  // BA
    MAIL_RISPOSTA_GENITORE:     53,  // BB
    MAIL_FIRMA_SOCIO_PERSONALE: 54,  // BC
    MAIL_FIRMA_SOCIO_IST:       55,  // BD
    MAIL_FIRMA_VOL_PERSONALE:   56,  // BE
    MAIL_FIRMA_VOL_IST:         57,  // BF
    MAIL_FIRMA_GEN_IST:         58,  // BG
    CREAZIONE_UTENTE_GOOGLE:    59,  // BH
    CREAZIONE_UTENTE_M365:      60,  // BI
    // Aggiunta da 15_ModuloIscrizioneWebApp.gs
    NOTE_ABILITA_MUSICALI:      61,  // BJ — descrizione libera abilità musicali (solo Volontari)
    // Aggiunta per il flusso a due fasi (approvazione poi pagamento)
    MAIL_INVITO_PAGAMENTO:      62,  // BK — evita di reinviare più volte la mail "Associati adesso"
    // Liberatoria uso immagini/video (facoltativa, granulare per canale — SI/NO)
    LIBERATORIA_SITO:           63,  // BL
    LIBERATORIA_SOCIAL:         64,  // BM
    LIBERATORIA_STAMPA:         65,  // BN
    LIBERATORIA_VIDEO:          66,  // BO
    // Aggiornamento liberatoria dal pannello Presidenza (revoca o nuovo consenso).
    // La data della prima raccolta resta DATA_SUBMISSION: queste due colonne
    // valgono '-' finché nessuno tocca la liberatoria dopo l'intake.
    LIBERATORIA_AGGIORNATA_IL:  67,  // BP
    LIBERATORIA_AGGIORNATA_DA:  68,  // BQ
    // ── Ciclo di vita associativo (Statuto Artt. 8–9) ─────────────────────
    // BR — estremi della decisione su ammissione o rigetto. L'Art. 8.3 permette
    // alla Presidenza di delegare un componente, ma la decisione del delegato è
    // soggetta a ratifica entro 10 giorni (poi si consolida ex tunc): senza
    // questa colonna il foglio non sa dire chi ha deliberato, quando, e se la
    // ratifica è arrivata — che è quanto l'art. 15 c.1 lett. a) D.Lgs. 117/2017
    // chiede di annotare nel libro degli associati.
    DELIBERA_RIF:               69,  // BR ← monitorata
    // BS–BT — l'Art. 9.1 elenca cinque cause di perdita della qualifica, con
    // organi, procedure ed effetti diversi. Il solo stato in AK non le
    // distingue: il libro soci deve dire come e quando il rapporto è cessato.
    CAUSA_CESSAZIONE:           70,  // BS ← monitorata
    DATA_CESSAZIONE:            71,  // BT ← monitorata
    // BU — l'espulsione (Art. 9.3) è deliberata dall'Assemblea su proposta della
    // Presidenza, dopo aver ascoltato l'interessato in contraddittorio. Sono due
    // momenti distinti e vanno registrati come tali: la proposta non produce
    // effetti, la delibera sì.
    ESPULSIONE_PROPOSTA_IL:     72,  // BU ← monitorata
    // BV — l'atto su cui la cessazione si fonda: gli estremi della delibera
    // dell'Assemblea per l'espulsione, il riferimento della comunicazione di
    // recesso o dell'accertamento per le altre cause.
    RIFERIMENTO_CESSAZIONE:     73,  // BV ← monitorata
    // ── Liberatoria firmata v. 2026.1 (foto, video, audio, esecuzione) ─────
    // Le quattro colonne BL–BO restano dove sono: i canali nuovi si aggiungono
    // in coda e non accanto ai vecchi, perché inserire una colonna in mezzo
    // sposterebbe ogni indice successivo e quindi ogni riga già scritta.
    LIBERATORIA_AUDIO:          74,  // BW ← monitorata — registrazioni audio e podcast
    LIBERATORIA_STREAMING:      75,  // BX ← monitorata — diretta su piattaforme terze
    // BY — licenza sui diritti dell'artista interprete esecutore (artt. 80 e
    // segg. L. 633/1941): è un atto diverso dal consenso privacy, e per
    // un'orchestra è quello che rende pubblicabile il video di un concerto.
    LIBERATORIA_ESECUZIONE:     76,  // BY ← monitorata
    // BZ — 'Registrata' | 'Negata' | 'In attesa 2° genitore' | '-'
    // Il gate guarda questa colonna: una risposta negativa È una risposta e non
    // blocca nulla (art. 7 par. 4 GDPR: un consenso preteso non è libero).
    LIBERATORIA_STATO:          77,  // BZ ← monitorata
    LIBERATORIA_VERSIONE:       78,  // CA — versione del testo firmato, es. '2026.1'
    LIBERATORIA_PDF_URL:        79,  // CB — PDF firmato, in cartella ad accesso ristretto
    LIBERATORIA_HASH:           80,  // CC — impronta del testo+dati firmati
    MAIL_LIBERATORIA_INVITO:    81,  // CD — guard: non reinvia il link al Membro
    MAIL_LIBERATORIA_PRESIDENZA: 82, // CE — guard: non riavvisa la Presidenza a ogni passaggio
    // Alias
    APPROVATO:               36,
  },
};

// ── Colonne monitorate per storico (1-based) ──────────────────────────────────
// AJ=36, AK=37, AL=38, AM=39, AN=40, AO=41, AP=42, AQ=43, AR=44, AX=50
// BL=64, BM=65, BN=66, BO=67 — liberatoria immagini/video: ogni revoca o nuovo
// consenso dev'essere dimostrabile (chi, quando, da cosa a cosa).
// BR=70, BS=71, BT=72, BU=73, BV=74 — delibere e cessazione del rapporto: sono
// le colonne che rendono il foglio un libro degli associati leggibile a
// distanza di anni. Le scritture da pannello loggano già da sé (onEdit non
// scatta per gli script); qui si copre chi le modifica a mano sul foglio.
// BW=75, BX=76, BY=77, BZ=78 — liberatoria firmata: i due canali nuovi, la
// licenza sull'esecuzione e lo stato. Valgono le stesse ragioni di BL–BO, con
// un'aggravante: su BZ poggia il gate del pagamento, e una modifica a mano di
// quella cella cambia ciò che il sistema considera «risposto».
const COLS_STORICO_1BASED = [36, 37, 38, 39, 40, 41, 42, 43, 44, 50, 64, 65, 66, 67,
                             70, 71, 72, 73, 74, 75, 76, 77, 78];

// ── Design System CSS ────────────────────────────────────────────────────────
const DESIGN_SYSTEM = `<style>
body,table,td,p,a,h1,h2,h3,div,span{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue",Helvetica,Arial,sans-serif!important;}
body{margin:0;padding:0;background-color:#F5F5F7;}
.wrapper{width:100%;background-color:#F5F5F7;padding:48px 16px;box-sizing:border-box;}
.container{max-width:600px;margin:0 auto;background-color:#FFFFFF;border-radius:24px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.03);border:1px solid #E5E5EA;}
.header{background-color:${CONFIG.COLORI.BLU};padding:44px 32px 36px 32px;text-align:center;border-bottom:1px solid #F2F2F7;}
.header img, .logo{width:68px;height:auto;margin-bottom:16px;border-radius:16px;}
.header h1, .header-title{color:#FFFFFF;font-size:24px;font-weight:700;margin:0;line-height:1.2;letter-spacing:-0.5px;}
.header p, .header-subtitle{color:${CONFIG.COLORI.ARANCIO};font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin:8px 0 0 0;}
.content{padding:40px 36px;color:#1D1D1F;}
.greeting{font-size:20px;font-weight:700;margin-bottom:16px;color:#1D1D1F;letter-spacing:-0.4px;}
.text{font-size:15px;line-height:1.6;color:#424245;margin-bottom:24px;}
.card{background-color:#F5F5F7;border:1px solid #E5E5EA;border-radius:16px;padding:24px;margin-bottom:24px;}
.card-title{font-size:11px;text-transform:uppercase;font-weight:700;color:${CONFIG.COLORI.BLU};margin-bottom:14px;letter-spacing:1px;}
.row{width:100%;border-bottom:1px solid #E5E5EA;border-collapse:collapse;}
.row td{padding:12px 0;font-size:14px;}
.row:last-child{border-bottom:none;}
.label{color:#86868B;width:44%;vertical-align:top;}
.value{font-weight:600;color:#1D1D1F;text-align:right;width:56%;vertical-align:top;word-break:break-word;}
.highlight-box{background-color:#FFF9F2;border:1px solid rgba(242,145,4,0.15);padding:24px;border-radius:16px;margin:24px 0;text-align:center;}
.highlight-title{font-size:11px;font-weight:700;color:${CONFIG.COLORI.BLU};text-transform:uppercase;margin-bottom:8px;letter-spacing:1px;}
.highlight-value{font-size:28px;font-weight:700;color:${CONFIG.COLORI.BLU};letter-spacing:-0.5px;}
.alert-box{background-color:#FFF5F5;border:1px solid #FFD6D6;border-radius:16px;padding:24px;margin-bottom:24px;}
.alert-title{color:#FF3B30;font-size:16px;font-weight:700;margin-bottom:8px;}
.alert-text{color:#FF3B30;font-size:14px;line-height:1.55;margin:0;}
.info-note{background-color:#F5F5F7;border-radius:16px;padding:20px;font-size:13px;color:#424245;line-height:1.55;border:1px solid #E5E5EA;margin-bottom:24px;}
.code-block{background:#1D1D1F;border-radius:12px;padding:18px;margin:14px 0;overflow:auto;}
.code-block pre{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;color:#E8E8E8;white-space:pre-wrap;word-break:break-all;}
.footer{background-color:#FFFFFF;padding:44px 24px;text-align:center;border-top:1px solid #F2F2F7;}
.footer p, .footer-p{font-size:11px;color:#86868B;margin:0 0 8px 0;line-height:1.5;}
.footer a, .footer-link{color:${CONFIG.COLORI.BLU};text-decoration:none;font-weight:600;}
code{background:rgba(0,0,0,0.05);padding:2px 6px;border-radius:5px;font-family:monospace;font-size:12px;color:#1D1D1F;}
.btn{display:inline-block;padding:13px 26px;border-radius:12px;font-weight:600;font-size:14px;text-decoration:none;margin:6px 4px;}
.btn-primary{background:${CONFIG.COLORI.BLU};color:#FFFFFF;}
.btn-secondary{background:${CONFIG.COLORI.ARANCIO};color:#FFFFFF;}
</style>`;

const FOOTER_TEMPLATE = `<div class="footer">
  <p class="footer-p"><strong>&copy; ${new Date().getFullYear()} ${CONFIG.NOME_LEGALE}</strong></p>
  <p class="footer-p">C.F.: ${CONFIG.CF} &middot; <a class="footer-link" href="https://${CONFIG.SITO_WEB}">${CONFIG.SITO_WEB}</a></p>
  <p class="footer-p" style="margin-top:12px;font-size:10px;opacity:0.55;">Sistema gestionale membri. Sviluppato da ${CONFIG.NOME_LEGALE}.</p>
</div>`;

const DISCLAIMER_SICUREZZA = `<div class="info-note">
  <strong>Non sei stato tu ad effettuare questa operazione o i dati inseriti non sono corretti?</strong>&nbsp;
  <a href="mailto:${CONFIG.EMAIL_MITTENTE}" style="color:${CONFIG.COLORI.ARANCIO};font-weight:600;">Contattaci immediatamente</a>.
</div>`;

// ═════════════════════════════════════════════════════════════════════════════
// HELPER EMAIL (GmailApp — invia dal vero account Workspace, deliverability OK)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Wrapper centralizzato per l'invio email.
 * Usa GmailApp invece di MailApp per garantire deliverability su tutti i domini.
 * Un solo posto da modificare se in futuro si cambia provider.
 *
 * @param {string|string[]} to          Destinatario o array di destinatari
 * @param {string}          subject     Oggetto
 * @param {string}          htmlBody    Corpo HTML
 * @param {Object}          [opts]      Opzioni aggiuntive
 * @param {Blob[]}          [opts.attachments]
 * @param {string}          [opts.cc]
 * @param {string}          [opts.bcc]
 * @param {string}          [opts.replyTo]
 */
function inviaEmail_(to, subject, htmlBody, opts) {
  opts = opts || {};
  const destinatario = Array.isArray(to) ? to.filter(Boolean).join(',') : String(to || '');
  if (!destinatario) { traceLog_('[Email] SKIP: destinatario vuoto per oggetto: ' + subject); return; }

  // BCC silenzioso a no-reply per archivio completo di ogni email uscente
  const bccList = [CONFIG.EMAIL_TRANSITO_E_VERIFICA];
  if (opts.bcc) bccList.push(opts.bcc);

  const options = {
    htmlBody: htmlBody,
    name:     CONFIG.NOME_GRUPPO,
    bcc:      bccList.filter(Boolean).join(','),
  };
  if (opts.attachments && opts.attachments.length) options.attachments = opts.attachments;
  if (opts.cc)      options.cc      = opts.cc;
  if (opts.replyTo) options.replyTo = opts.replyTo;

  try {
    GmailApp.sendEmail(destinatario, subject, '', options);
    traceLog_('[Email] ✅ Inviata a: ' + destinatario + ' | Oggetto: ' + subject);
  } catch (err) {
    traceLog_('[Email] ❌ ERRORE a ' + destinatario + ': ' + err.toString());
    throw err;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// HTML HELPERS
// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
// HTML HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Centered button helper with bulletproof Outlook-safe table layout.
 */
function _pulsante(testo, url, backgroundCol, align) {
  const bg = backgroundCol || CONFIG.COLORI.BLU;
  const al = align || 'center';
  const marginStr = al === 'center' ? '24px auto 12px' : (al === 'left' ? '16px 0' : '16px 0 16px auto');
  return `
    <table cellpadding="0" cellspacing="0" border="0" style="margin: ${marginStr}; border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; display: ${al === 'center' ? 'table' : 'inline-table'};">
      <tr>
        <td align="${al}" valign="middle" style="background-color: ${bg}; border-radius: 12px; padding: 0; text-align: ${al};">
          <a href="${url}" target="_blank" style="display: inline-block; background-color: ${bg}; color: #FFFFFF; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif; font-size: 14px; font-weight: 600; text-decoration: none; padding: 13px 28px; border-radius: 12px; border: 1px solid ${bg}; letter-spacing: -0.1px; text-align: center;">
            ${testo}
          </a>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Automatically injects inline CSS styles into HTML tags based on their class attributes.
 * Essential for rendering correctly in email clients (like Gmail App on Android/iOS)
 * that strip style blocks.
 */
function inlineCss_(html) {
  const styles = {
    'wrapper': `width:100%; background-color:#F5F5F7; padding:48px 16px; box-sizing:border-box; margin:0;`,
    'container': `max-width:600px; margin:0 auto; background-color:#FFFFFF; border-radius:24px; overflow:hidden; border:1px solid #E5E5EA; box-shadow:0 8px 24px rgba(0,0,0,0.03);`,
    'header': `padding:44px 32px 36px 32px; text-align:center; border-bottom:1px solid #F2F2F7;`,
    'logo': `width:68px; height:auto; margin-bottom:16px; border-radius:16px; display:inline-block;`,
    'header-title': `color:#FFFFFF; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif; font-size:24px; font-weight:700; margin:0; line-height:1.2; letter-spacing:-0.5px;`,
    'header-subtitle': `font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; margin:8px 0 0 0;`,
    'content': `padding:40px 36px; color:#1D1D1F; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;`,
    'greeting': `font-size:20px; font-weight:700; margin-bottom:16px; color:#1D1D1F; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif; letter-spacing:-0.4px;`,
    'text': `font-size:15px; line-height:1.6; color:#424245; margin-bottom:24px; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;`,
    'card': `background-color:#F5F5F7; border:1px solid #E5E5EA; border-radius:16px; padding:24px; margin-bottom:24px;`,
    'card-title': `font-size:11px; text-transform:uppercase; font-weight:700; color:${CONFIG.COLORI.BLU}; margin-bottom:14px; letter-spacing:1px; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;`,
    'row': `width:100%; border-collapse:collapse; border-bottom:1px solid #E5E5EA;`,
    'label': `padding:12px 0; font-size:14px; color:#86868B; width:44%; vertical-align:top; text-align:left; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;`,
    'value': `padding:12px 0; font-size:14px; font-weight:600; color:#1D1D1F; text-align:right; width:56%; vertical-align:top; word-break:break-word; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;`,
    'highlight-box': `background-color:#FFF9F2; border:1px solid rgba(242,145,4,0.15); padding:24px; border-radius:16px; margin:24px 0; text-align:center;`,
    'highlight-title': `font-size:11px; font-weight:700; color:${CONFIG.COLORI.BLU}; text-transform:uppercase; margin-bottom:8px; letter-spacing:1px; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;`,
    'highlight-value': `font-size:28px; font-weight:700; color:${CONFIG.COLORI.BLU}; letter-spacing:-0.5px; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','Helvetica Neue',Arial,sans-serif;`,
    'alert-box': `background-color:#FFF5F5; border:1px solid #FFD6D6; border-radius:16px; padding:24px; margin-bottom:24px;`,
    'alert-title': `color:#FF3B30; font-size:16px; font-weight:700; margin-bottom:8px; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;`,
    'alert-text': `color:#FF3B30; font-size:14px; line-height:1.55; margin:0; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;`,
    'info-note': `background-color:#F5F5F7; border-radius:16px; padding:20px; font-size:13px; color:#424245; line-height:1.55; border:1px solid #E5E5EA; margin-bottom:24px; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;`,
    'footer': `background-color:#FFFFFF; padding:44px 24px; text-align:center; border-top:1px solid #F2F2F7;`,
    'footer-p': `font-size:11px; color:#86868B; margin:0 0 8px 0; line-height:1.5; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;`,
    'footer-link': `color:${CONFIG.COLORI.BLU}; text-decoration:none; font-weight:600;`,
    'btn': `display:inline-block; padding:13px 26px; border-radius:12px; font-weight:600; font-size:14px; text-decoration:none; margin:6px 4px; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;`,
    'btn-primary': `background:${CONFIG.COLORI.BLU}; color:#FFFFFF;`,
    'btn-secondary': `background:${CONFIG.COLORI.ARANCIO}; color:#FFFFFF;`
  };

  return html.replace(/<([a-z1-6]+)([^>]+)>/gi, function(match, tagName, attrs) {
    const classMatch = attrs.match(/class=["']([^"']+)["']/i);
    if (!classMatch) return match;

    const classNames = classMatch[1].split(/\s+/);
    let inlineStyles = '';

    classNames.forEach(name => {
      if (styles[name]) {
        inlineStyles += (inlineStyles ? ' ' : '') + styles[name];
      }
    });

    if (!inlineStyles) return match;

    const styleMatch = attrs.match(/style=["']([^"']+)["']/i);
    let newAttrs = attrs;
    if (styleMatch) {
      const mergedStyle = inlineStyles + ' ' + styleMatch[1];
      newAttrs = attrs.replace(/style=["']([^"']+)["']/i, `style="${mergedStyle}"`);
    } else {
      newAttrs = attrs + ` style="${inlineStyles}"`;
    }

    return `<${tagName}${newAttrs}>`;
  });
}

function _htmlWrapper(titolo, contenuto, headerColor, subtitleColor) {
  const hc = headerColor || CONFIG.COLORI.BLU;
  const sc = subtitleColor || CONFIG.COLORI.ARANCIO;
  const rawHtml = `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
${DESIGN_SYSTEM}</head>
<body><div class="wrapper"><div class="container">
<div class="header" style="background-color:${hc};">
  <img class="logo" src="${CONFIG.LOGO_URL}" alt="Logo {{NOME_GRUPPO}}">
  <h1 class="header-title">${titolo}</h1>
  <p class="header-subtitle" style="color:${sc};">${CONFIG.NOME_GRUPPO}</p>
</div>
<div class="content">${contenuto}</div>
${FOOTER_TEMPLATE}
</div></div></body></html>`;

  return inlineCss_(rawHtml);
}

function _riga(label, valore) {
  return `<table class="row" cellpadding="0" cellspacing="0" border="0"><tr>
    <td class="label">${label}</td>
    <td class="value">${valore || ''}</td>
  </tr></table>`;
}

/** Escape HTML per mostrare codice grezzo in email */
function _htmlEscape(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ═════════════════════════════════════════════════════════════════════════════
// UTILITY GLOBALI
// ═════════════════════════════════════════════════════════════════════════════

function formatData_(d) {
  if (!d) return 'N/D';
  try {
    const o = (d instanceof Date) ? d : new Date(d);
    return isNaN(o.getTime()) ? String(d) : Utilities.formatDate(o, 'Europe/Rome', 'dd/MM/yyyy');
  } catch(e) { return 'N/D'; }
}

function formatOra_(o) {
  if (!o) return 'N/D';
  try {
    if (o instanceof Date) return Utilities.formatDate(o, 'Europe/Rome', 'HH:mm');
    return String(o).substring(0, 5);
  } catch(e) { return 'N/D'; }
}

function aggiungi365Giorni_(base) {
  const d = (base instanceof Date) ? new Date(base) : new Date(base);
  d.setDate(d.getDate() + 365);
  return d;
}

function getDatiAnagrafici_(rowData, tipo) {
  const I = CONFIG.IDX;
  if (tipo === 'Socio Ordinario') {
    return { nome: rowData[I.NOME_SOCIO]||'', cognome: rowData[I.COGNOME_SOCIO]||'',
             cf: rowData[I.CF_SOCIO]||'', dataNascita: rowData[I.DATA_NASCITA_SOCIO]||'',
             email: rowData[I.EMAIL_SOCIO]||'', tel: rowData[I.TEL_SOCIO]||'' };
  }
  return { nome: rowData[I.NOME_VOLONTARIO]||'', cognome: rowData[I.COGNOME_VOLONTARIO]||'',
           cf: rowData[I.CF_VOLONTARIO]||'', dataNascita: rowData[I.DATA_NASCITA_VOLONTARIO]||'',
           email: rowData[I.EMAIL_VOLONTARIO]||'', tel: rowData[I.TEL_VOLONTARIO]||'' };
}

function generaPasswordCasuale_() {
  const u='ABCDEFGHJKMNPQRSTUVWXYZ', l='abcdefghjkmnpqrstuvwxyz', d='23456789', s='!@#$%&';
  const all=u+l+d+s;
  let p=[u[~~(Math.random()*u.length)],l[~~(Math.random()*l.length)],
         d[~~(Math.random()*d.length)],s[~~(Math.random()*s.length)]];
  for(let i=4;i<14;i++) p.push(all[~~(Math.random()*all.length)]);
  for(let i=p.length-1;i>0;i--){const j=~~(Math.random()*(i+1));[p[i],p[j]]=[p[j],p[i]];}
  return p.join('');
}

function normalizzaPerEmail_(str) {
  return String(str||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]/g,'');
}

/** Genera lo slug URL del membro: "Mario Rossi" → "mario-rossi" */
function generaSlugMembro_(nome, cognome) {
  return (String(nome||'') + '-' + String(cognome||''))
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-|-$/g,'');
}

function generaEmailIstituzionale_(rowData, tipo, gruppo) {
  const d = getDatiAnagrafici_(rowData, tipo);
  const n = normalizzaPerEmail_(d.nome), c = normalizzaPerEmail_(d.cognome);
  const local = (gruppo === 'Presidenza') ? n.charAt(0)+'.'+c : n+'.'+c;
  return local + '@' + CONFIG.DOMINIO;
}

function rendiEmailUnica_(sheet, emailBase, rigaCorrente) {
  const data = sheet.getDataRange().getValues();
  const set  = new Set();
  for (let i=1;i<data.length;i++) {
    if (i+1===rigaCorrente) continue;
    const e = data[i][CONFIG.IDX.EMAIL_ISTITUZIONALE];
    if (e) set.add(String(e).toLowerCase().trim());
  }
  if (!set.has(emailBase.toLowerCase())) return emailBase;
  const [loc,dom] = emailBase.split('@');
  let n=2;
  while(set.has(`${loc}${n}@${dom}`.toLowerCase())) n++;
  return `${loc}${n}@${dom}`;
}

function calcolaDataScadenza_(rowData) {
  const I = CONFIG.IDX;
  const ult = rowData[I.DATA_ULTIMO_RINNOVO];
  if (ult && ult !== '') {
    const d = (ult instanceof Date) ? ult : new Date(ult);
    if (!isNaN(d.getTime())) return aggiungi365Giorni_(d);
  }
  const amm = rowData[I.DATA_AMMISSIONE];
  if (amm) {
    const d = (amm instanceof Date) ? amm : new Date(amm);
    if (!isNaN(d.getTime())) return aggiungi365Giorni_(d);
  }
  return null;
}

function inviaEmailErroreAmministratore(error) {
  try {
    GmailApp.sendEmail(CONFIG.EMAIL_ADMIN_ERRORI, '🚨 ERRORE Script gestione associati',
      'Errore:\n\n' + error.message + '\n\nStack:\n' + (error.stack||'N/D'),
      { bcc: CONFIG.EMAIL_TRANSITO_E_VERIFICA });
  } catch(e) { traceLog_('Impossibile inviare email errore: '+e.message); }
}

function webhookChatValido_(url) {
  return !!url && !String(url).includes('INSERISCI');
}

function getLinkFoglioGoogle_() {
  return CONFIG.LINK_FOGLIO_FISSO || ('https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID + '/edit');
}

/**
 * Link al pannello Presidenza (17_PresidenzaAdmin.gs, ?pagina=presidenza).
 * Con idPratica valorizzato apre il pannello già aperto sulla pratica
 * specifica (deep-link gestito da doGetPresidenzaAdmin + PresidenzaAdminHTML);
 * senza, apre la dashboard con la lista completa. Se l'URL della web app non
 * è disponibile (es. eseguito fuori da un deployment attivo), ripiega sul
 * link al foglio così il bottone nelle notifiche Chat porta comunque da
 * qualche parte.
 */
function getLinkPresidenza_(idPratica) {
  const idP = String(idPratica||'').trim().toUpperCase();
  try {
    const baseUrl = ScriptApp.getService().getUrl();
    if (baseUrl) {
      return baseUrl + '?pagina=presidenza' + (idP && idP !== 'N/D' ? '&idPratica=' + encodeURIComponent(idP) : '');
    }
  } catch(e) { traceLog_('[Presidenza] URL web app non disponibile: ' + e.message); }
  return getLinkFoglioGoogle_();
}

/**
 * Invio robusto a Google Chat webhook: retry su errori transitori.
 * @returns {{ok:boolean, skipped?:boolean, code?:number, body?:string, error?:string}}
 */
function inviaPayloadChat_(webhookUrl, payload, contesto) {
  const label = contesto || 'Chat';
  if (!webhookChatValido_(webhookUrl)) {
    traceLog_('[' + label + '] SKIP: webhook non configurato.');
    return { ok:false, skipped:true };
  }

  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    try {
      const resp = UrlFetchApp.fetch(webhookUrl, {
        method:'post',
        contentType:'application/json',
        payload:JSON.stringify(payload),
        muteHttpExceptions:true,
      });
      const code = resp.getResponseCode();
      const body = resp.getContentText();
      if (code === 200) return { ok:true, code:code, body:body };

      traceLog_('[' + label + '] Tentativo ' + tentativo + '/3 HTTP ' + code);
      const retriable = code === 429 || code >= 500;
      if (!retriable || tentativo === 3) return { ok:false, code:code, body:body };
    } catch (err) {
      traceLog_('[' + label + '] Tentativo ' + tentativo + '/3 errore: ' + err.message);
      if (tentativo === 3) return { ok:false, error:err.message };
    }
    Utilities.sleep(1200 * tentativo);
  }
  return { ok:false, error:'Tentativi esauriti.' };
}

// ═════════════════════════════════════════════════════════════════════════════
// STORICO MODIFICHE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Registra una modifica nel foglio "Storico".
 * Chiamato da TriggerStorico (onEdit) e da TriggerAmmissione.
 */
/**
 * Risolve il nome di una causa di cessazione (Statuto Art. 9.1) sulla chiave
 * canonica di CONFIG.CAUSE_CESSAZIONE, tollerando maiuscole/minuscole e gli
 * accenti: 'Incapacità' arriva dal pannello con l'accento e dall'API iOS senza,
 * perché passa da una query string. Ritorna `null` se la causa non esiste, così
 * il chiamante rifiuta invece di scrivere una causa inventata nel libro soci.
 */
function risolviCausaCessazione_(causa) {
  const cercata = normalizzaPerEmail_(String(causa || '').trim()).toLowerCase();
  if (!cercata) return null;
  const chiavi = Object.keys(CONFIG.CAUSE_CESSAZIONE);
  for (let i = 0; i < chiavi.length; i++) {
    if (normalizzaPerEmail_(chiavi[i]).toLowerCase() === cercata) {
      const c = CONFIG.CAUSE_CESSAZIONE[chiavi[i]];
      return {
        chiave: chiavi[i], stato: c.stato, articolo: c.articolo,
        organo: c.organo, descrizione: c.descrizione,
        etichetta: c.etichetta || chiavi[i],
      };
    }
  }
  return null;
}

/**
 * Causa di cessazione registrata sulla riga, o stringa vuota. Le righe già in
 * archivio hanno '-' in BS (vedi inizializzaColonneAggiuntive): '-' significa
 * "mai cessato", non una causa.
 */
function cessazioneRegistrata_(rowData) {
  const v = String(rowData[CONFIG.IDX.CAUSA_CESSAZIONE] || '').trim();
  return (v && v !== '-') ? v : '';
}

/**
 * Etichetta leggibile di una causa: 'Incapacita' è una chiave, non una parola
 * da mostrare a un socio.
 */
function etichettaCausaCessazione_(chiave) {
  const c = CONFIG.CAUSE_CESSAZIONE[chiave];
  return (c && c.etichetta) || chiave;
}

function logModifica_(riga, nomeColonna, vecchioValore, nuovoValore, idPratica, nomeMembro) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let storico = ss.getSheetByName(CONFIG.SHEET_STORICO);
  if (!storico) {
    storico = ss.insertSheet(CONFIG.SHEET_STORICO);
    storico.appendRow(['Timestamp','ID Pratica','Membro','Colonna','Vecchio Valore','Nuovo Valore','Riga Foglio']);
    storico.getRange(1,1,1,7).setFontWeight('bold').setBackground('{{COLORE_BLU}}').setFontColor('#FFFFFF');
    traceLog_('[Storico] Foglio "Storico" creato.');
  }
  storico.appendRow([
    new Date(),
    idPratica || 'N/D',
    nomeMembro || 'N/D',
    nomeColonna,
    vecchioValore !== undefined ? String(vecchioValore) : '',
    nuovoValore   !== undefined ? String(nuovoValore)   : '',
    riga,
  ]);
}

// ═════════════════════════════════════════════════════════════════════════════
// SETUP
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Aggiunge le colonne AS–BI e crea il foglio Storico se non esistono.
 * Eseguire UNA VOLTA prima del deploy.
 */
/**
 * Garantisce che la griglia del foglio abbia almeno `numColonne` colonne.
 * `getRange` su una colonna oltre il limite della griglia lancia, quindi ogni
 * volta che si scrive su una colonna gestionale aggiunta di recente (BP, BQ…)
 * va chiamata prima. Le colonne nuove vengono accodate in fondo: nessun
 * indice esistente si sposta.
 */
function _assicuraColonne_(sheet, numColonne) {
  const attuali = sheet.getMaxColumns();
  if (attuali >= numColonne) return;
  sheet.insertColumnsAfter(attuali, numColonne - attuali);
  traceLog_('[Foglio] Griglia estesa da ' + attuali + ' a ' + numColonne + ' colonne.');
}

function inizializzaColonneAggiuntive() {
  const ss    = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  // Le ultime colonne dell'elenco qui sotto possono non esistere ancora nella
  // griglia: vanno create prima di leggere le intestazioni.
  _assicuraColonne_(sheet, CONFIG.IDX.MAIL_LIBERATORIA_PRESIDENZA + 1);
  const hdrs  = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];

  const nuove = [
    {nome:'Transazione Stripe',                         col:45},
    {nome:'Subscription ID',                            col:46},
    {nome:'Customer ID',                                col:47},
    {nome:'Scadenza quota',                             col:48},
    {nome:'Rinnovo Stripe',                             col:49},
    {nome:'Ruolo Associativo',                          col:50},
    {nome:'Mail 1 al Socio',                            col:51},
    {nome:'Mail di risposta al Socio',                  col:52},
    {nome:'Mail di risposta al volontario',             col:53},
    {nome:'Mail di risposta al genitore del volontario',col:54},
    {nome:'Mail firma Socio personale',                 col:55},
    {nome:'Mail firma Socio istituzionale',             col:56},
    {nome:'Mail firma Volontario personale',            col:57},
    {nome:'Mail firma Volontario istituzionale',        col:58},
    {nome:'Mail firma Genitore istituzionale',          col:59},
    {nome:'Crezione Utente Google',                     col:60},
    {nome:'Crezione Utente M365',                       col:61},
    {nome:'Note abilità musicali',                      col:62},
    {nome:'Mail invito pagamento',                      col:63},
    {nome:'Liberatoria - Sito web',                     col:64},
    {nome:'Liberatoria - Social media',                 col:65},
    {nome:'Liberatoria - Materiale stampato',            col:66},
    {nome:'Liberatoria - Video promozionali',            col:67},
    {nome:'Liberatoria aggiornata il',                  col:68},
    {nome:'Liberatoria aggiornata da',                  col:69},
    {nome:'Delibera / ratifica',                        col:70},
    {nome:'Causa cessazione',                           col:71},
    {nome:'Data cessazione',                            col:72},
    {nome:'Espulsione proposta il',                     col:73},
    {nome:'Riferimento cessazione',                     col:74},
    {nome:'Liberatoria - Audio',                        col:75},
    {nome:'Liberatoria - Streaming',                    col:76},
    {nome:'Liberatoria - Esecuzione musicale',          col:77},
    {nome:'Liberatoria - Stato',                        col:78},
    {nome:'Liberatoria - Versione testo',               col:79},
    {nome:'Liberatoria - PDF firmato',                  col:80},
    {nome:'Liberatoria - Impronta',                     col:81},
    {nome:'Mail invito liberatoria',                    col:82},
    {nome:'Mail liberatoria alla Presidenza',           col:83},
  ];
  nuove.forEach(({nome,col}) => {
    const headerAttuale = String(hdrs[col-1] || '');
    if (headerAttuale !== nome) {
      sheet.getRange(1,col).setValue(nome)
        .setFontWeight('bold').setBackground('{{COLORE_BLU}}').setFontColor('#FFFFFF');
      traceLog_((headerAttuale ? '♻️ Colonna aggiornata: ' : '✅ Colonna aggiunta: ') + nome + ' (col ' + col + ')');
    } else {
      traceLog_('ℹ️ Colonna già corretta: '+headerAttuale+' (col '+col+')');
    }
  });

  // Inizializza righe dati esistenti con '-' per le colonne di tracciamento (AY–BI)
  const primaColTracciamento = 51; // AY (1-based)
  const numColTracciamento   = 11; // AY→BI
  const ultimaRiga = sheet.getLastRow();
  if (ultimaRiga >= 2) {
    const rangeTracciamento = sheet.getRange(2, primaColTracciamento, ultimaRiga - 1, numColTracciamento);
    const valoriEsistenti   = rangeTracciamento.getValues();
    const nuoviValori = valoriEsistenti.map(r => r.map(v => (v === '' || v === null || v === undefined) ? '-' : v));
    rangeTracciamento.setValues(nuoviValori);
    traceLog_('✅ Righe dati inizializzate con "-" per le colonne di tracciamento.');

    // Colonna BK (Mail invito pagamento) — stesso trattamento, ma separata perché
    // aggiunta in un secondo momento rispetto al blocco AY–BI.
    const rangeInvitoPag = sheet.getRange(2, CONFIG.IDX.MAIL_INVITO_PAGAMENTO+1, ultimaRiga - 1, 1);
    const valoriInvitoPag = rangeInvitoPag.getValues();
    rangeInvitoPag.setValues(valoriInvitoPag.map(r => r.map(v => (v === '' || v === null || v === undefined) ? '-' : v)));

    // Colonne BL–BO (Liberatoria immagini/video) — le domande già in archivio non
    // hanno mai avuto questa scelta, quindi '-' (non richiesto) e non 'NO'.
    const rangeLiberatoria = sheet.getRange(2, CONFIG.IDX.LIBERATORIA_SITO+1, ultimaRiga - 1, 4);
    const valoriLiberatoria = rangeLiberatoria.getValues();
    rangeLiberatoria.setValues(valoriLiberatoria.map(r => r.map(v => (v === '' || v === null || v === undefined) ? '-' : v)));

    // Colonne BP–BQ (chi/quando ha aggiornato la liberatoria) — '-' finché
    // nessuno la modifica dal pannello Presidenza.
    const rangeLibMeta = sheet.getRange(2, CONFIG.IDX.LIBERATORIA_AGGIORNATA_IL+1, ultimaRiga - 1, 2);
    const valoriLibMeta = rangeLibMeta.getValues();
    rangeLibMeta.setValues(valoriLibMeta.map(r => r.map(v => (v === '' || v === null || v === undefined) ? '-' : v)));

    // Colonne BR–BV (delibere e cessazione) — '-' sulle righe già in archivio:
    // per quelle la delibera esiste solo nel libro cartaceo della Presidenza, e
    // scrivere '-' dice esattamente questo. Le nuove pratiche le compilano da
    // sé passando dal pannello.
    const rangeCicloVita = sheet.getRange(2, CONFIG.IDX.DELIBERA_RIF+1, ultimaRiga - 1, 5);
    const valoriCicloVita = rangeCicloVita.getValues();
    rangeCicloVita.setValues(valoriCicloVita.map(r => r.map(v => (v === '' || v === null || v === undefined) ? '-' : v)));

    // Colonne BW–CE (liberatoria firmata v. 2026.1) — '-' su tutto l'archivio.
    // Per lo stato è una distinzione che conta: '-' significa «non ha ancora
    // risposto», non «ha detto no». Chi è già Membro ufficiale riceverà il link
    // dalla campagna retroattiva; il gate del pagamento non lo riguarda, perché
    // il suo rapporto associativo è già perfezionato.
    const rangeLibFirmata = sheet.getRange(2, CONFIG.IDX.LIBERATORIA_AUDIO+1, ultimaRiga - 1, 9);
    const valoriLibFirmata = rangeLibFirmata.getValues();
    rangeLibFirmata.setValues(valoriLibFirmata.map(r => r.map(v => (v === '' || v === null || v === undefined) ? '-' : v)));
  }

  // Crea foglio Storico se non esiste
  if (!ss.getSheetByName(CONFIG.SHEET_STORICO)) {
    const st = ss.insertSheet(CONFIG.SHEET_STORICO);
    st.appendRow(['Timestamp','ID Pratica','Membro','Colonna','Vecchio Valore','Nuovo Valore','Riga Foglio']);
    st.getRange(1,1,1,7).setFontWeight('bold').setBackground('{{COLORE_BLU}}').setFontColor('#FFFFFF');
    traceLog_('✅ Foglio Storico creato.');
  }

  SpreadsheetApp.flush();
  traceLog_('✅ Inizializzazione completata.');
}

/**
 * Installa TUTTI i trigger. Eseguire UNA VOLTA dall'editor.
 * IMPORTANTE: aprire questo script tramite Extensions > Apps Script dal foglio.
 */
function installaTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    traceLog_('❌ Apri lo script da Extensions > Apps Script nel foglio, non da script.google.com direttamente.');
    return;
  }
  traceLog_('Foglio: '+ss.getName()+' ('+ss.getId()+')');

  // Trigger fissi: sempre rimossi e reinstallati.
  // 'installaTriggers' è incluso qui solo come pulizia difensiva: questa funzione
  // va eseguita a mano dall'editor, non deve MAI avere un proprio trigger installato
  // (es. un onChange creato per errore dal pannello Trigger) — se qualcuno lo crea
  // per sbaglio, la prossima esecuzione di installaTriggers() lo rimuove da solo.
  const fissi = ['TriggerApprovazioneSocio','TriggerAmmissione',
    'TriggerCancellazioneAbbonamento','TriggerStorico','RouterModuli',
    'controlloScadenzeGiornaliero','processaCodaNotifiche',
    'sincronizzaRegistroEventi','installaTriggers'];

  // Trigger dinamici: rimossi SOLO se non hanno job attivi in ScriptProperties.
  // Questo evita di cancellare un timer in volo durante una reinstallazione.
  const props = PropertiesService.getScriptProperties().getProperties();
  const dinamiciProtetti = {
    'eseguiOnboardingDifferito':     'PENDING_AMM_',
    'eseguiRifiutoDifferito':        'PENDING_RIF_',
    'eseguiEmailBenvenutoRitardata': 'EMAIL_BV_'
  };
  const dinamiciDaRimuovere = Object.keys(dinamiciProtetti).filter(fn => {
    const prefisso = dinamiciProtetti[fn];
    const haJobAttivi = Object.keys(props).some(k => k.startsWith(prefisso));
    if (haJobAttivi) {
      traceLog_('⚠️ Protetto (job attivi in coda): ' + fn);
      return false; // non rimuovere
    }
    return true; // nessun job attivo, rimuovi normalmente
  });

  const daRimuovere = [...fissi, ...dinamiciDaRimuovere];

  ScriptApp.getProjectTriggers().forEach(t => {
    if (daRimuovere.includes(t.getHandlerFunction())) {
      ScriptApp.deleteTrigger(t);
      traceLog_('🗑️ Rimosso: '+t.getHandlerFunction());
    }
  });

  // onChange: Jotform INSERT_ROW
  ScriptApp.newTrigger('RouterModuli').forSpreadsheet(ss).onChange().create();
  traceLog_('✅ onChange: RouterModuli');

  // onEdit installabili
  ['TriggerAmmissione','TriggerCancellazioneAbbonamento','TriggerStorico'].forEach(fn => {
    ScriptApp.newTrigger(fn).forSpreadsheet(ss).onEdit().create();
    traceLog_('✅ onEdit: '+fn);
  });

  // Giornalieri
  ScriptApp.newTrigger('controlloScadenzeGiornaliero').timeBased().atHour(8).everyDays(1).create();
  traceLog_('✅ Giornaliero ore 08:00: controlloScadenzeGiornaliero');
  ScriptApp.newTrigger('processaCodaNotifiche').timeBased().atHour(9).everyDays(1).create();
  traceLog_('✅ Giornaliero ore 09:00: processaCodaNotifiche');

  // Registro degli Eventi: ogni 4 ore. Non di più — il tetto di Apps Script è
  // di 20 trigger per progetto e quelli dinamici dei job differiti ne occupano
  // fino a tre. L'ancora giornaliera della catena non ha un trigger proprio:
  // la pubblica la prima sincronizzazione utile della giornata.
  ScriptApp.newTrigger('sincronizzaRegistroEventi').timeBased().everyHours(4).create();
  traceLog_('✅ Ogni 4 ore: sincronizzaRegistroEventi');

  traceLog_('\n════════════════════════════════════════');
  traceLog_('✅ Tutti i trigger installati.');
  traceLog_('════════════════════════════════════════');
  ScriptApp.getProjectTriggers().forEach(t => traceLog_('  · '+t.getHandlerFunction()+' ['+t.getEventType()+']'));
}
