/**
 * MODULO: 9_MembroPortal.gs
 * ══════════════════════════════════════════════════════════════════════
 * Web App standalone — Portale Membri {{NOME_GRUPPO}}
 *
 * Deploy come PROGETTO GAS SEPARATO:
 *  1. script.google.com > Nuovo progetto > Nome: "{{NOME_GRUPPO}} Member Portal"
 *  2. Incolla questo file
 *  3. Deploy > New deployment > Web app
 *     Execute: Me | Access: Anyone with a Google account
 *  4. Copia l'URL e aggiornalo in CONFIG.MEMBER_PORTAL_URL
 */

// ⚠️ Progetto GAS standalone: non ha accesso a SECRETS del progetto principale.
//    SHEET_ID e LOGO_URL devono essere mantenuti in sincronia manualmente con 0_Secrets.gs.
const PORTAL_CFG = {
  SHEET_ID:   '{{SHEET_ID}}',  // = SECRETS.SHEET_ID
  SHEET_NAME: 'Risposte',
  DOMINIO:    '{{DOMINIO}}',
  NOME_LEGALE:'{{NOME_LEGALE}}',
  NOME_GRUPPO:'{{NOME_GRUPPO}}',
  LOGO_URL:   '{{LOGO_URL}}',  // = SECRETS.LOGO_URL
  SITO_WEB:   '{{SITO_WEB}}',
  EMAIL:      '{{EMAIL_MITTENTE}}',
  BLU:        '{{COLORE_BLU}}', ARANCIO:'{{COLORE_ARANCIO}}', BEIGE:'{{COLORE_BEIGE}}',
  ADMIN_EMAILS: ['{{EMAIL_MITTENTE}}'],
  IDX: {
    TIPO_ASSOCIATO:1, NOME_SOCIO:3, COGNOME_SOCIO:4, CF_SOCIO:5,
    DATA_NASCITA_SOCIO:6, EMAIL_SOCIO:7, TEL_SOCIO:8,
    NOME_VOLONTARIO:11, COGNOME_VOLONTARIO:12, CF_VOLONTARIO:13,
    DATA_NASCITA_VOLONTARIO:14, EMAIL_VOLONTARIO:15, TEL_VOLONTARIO:16,
    ID_PRATICA:27, EMAIL_ISTITUZIONALE:35, STATO_DOMANDA:36,
    DATA_AMMISSIONE:37, GRUPPO:38, STATO_PAGAMENTO:40,
    MEMBRO_UFFICIALE:41, ESPULSO:42, DATA_SCADENZA_QUOTA:47,
    DATA_ULTIMO_RINNOVO:48,
  },
};

function doGet() {
  const userEmail = Session.getActiveUser().getEmail();
  if (!userEmail) return _errPage('Sessione non disponibile', 'Accedi con il tuo account Google Workspace {{NOME_GRUPPO}}.');

  const isAdmin  = PORTAL_CFG.ADMIN_EMAILS.includes(userEmail);
  const isDomain = userEmail.endsWith('@' + PORTAL_CFG.DOMINIO);
  if (!isDomain && !isAdmin) return _errPage('Accesso riservato', `Questo portale è accessibile solo ai membri di <strong>${PORTAL_CFG.NOME_LEGALE}</strong>. Accedi con il tuo account <strong>@${PORTAL_CFG.DOMINIO}</strong>.`);

  const sheet   = SpreadsheetApp.openById(PORTAL_CFG.SHEET_ID).getSheetByName(PORTAL_CFG.SHEET_NAME);
  const allData = sheet.getDataRange().getValues();
  const I       = PORTAL_CFG.IDX;

  let membroRow = null;
  for (let i = 1; i < allData.length; i++) {
    const r = allData[i];
    if (String(r[I.EMAIL_ISTITUZIONALE]||'').toLowerCase().trim() === userEmail.toLowerCase()
        && r[I.MEMBRO_UFFICIALE] === 'SI'
        && !String(r[I.ESPULSO]||'').trim()) {
      membroRow = r; break;
    }
  }

  if (!membroRow && isAdmin) return _adminPage(allData);
  if (!membroRow) return _errPage('Profilo non trovato', 'Nessun profilo attivo associato al tuo account. Contatta la Presidenza.');
  return _membroPage(membroRow);
}

function _membroPage(r) {
  const I       = PORTAL_CFG;
  const IDX     = PORTAL_CFG.IDX;
  const tipo    = r[IDX.TIPO_ASSOCIATO];
  const isSoc   = (tipo === 'Socio Ordinario');
  const nome    = isSoc ? r[IDX.NOME_SOCIO]        : r[IDX.NOME_VOLONTARIO];
  const cognome = isSoc ? r[IDX.COGNOME_SOCIO]      : r[IDX.COGNOME_VOLONTARIO];
  const cf      = isSoc ? r[IDX.CF_SOCIO]           : r[IDX.CF_VOLONTARIO];
  const nascita = isSoc ? r[IDX.DATA_NASCITA_SOCIO] : r[IDX.DATA_NASCITA_VOLONTARIO];
  const email   = isSoc ? r[IDX.EMAIL_SOCIO]        : r[IDX.EMAIL_VOLONTARIO];
  const tel     = isSoc ? r[IDX.TEL_SOCIO]          : r[IDX.TEL_VOLONTARIO];
  const idP     = r[IDX.ID_PRATICA]||'N/D';
  const emailIst= r[IDX.EMAIL_ISTITUZIONALE]||'N/D';
  const gruppo  = r[IDX.GRUPPO]||'N/D';
  const dataAmm = _fmtDate(r[IDX.DATA_AMMISSIONE]);
  const dataScad= _fmtDate(r[IDX.DATA_SCADENZA_QUOTA]);
  const statoPag= r[IDX.STATO_PAGAMENTO]||'N/D';
  const avatar  = (nome||'?').charAt(0).toUpperCase();
  const pillPag = statoPag==='Regolare' ? 'pill-green' : 'pill-red';

  const html = `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Profilo — ${nome} ${cognome}</title>
<style>:root{--blu:{{COLORE_BLU}};--arancio:{{COLORE_ARANCIO}};--beige:{{COLORE_BEIGE}};}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,"Inter",sans-serif;background:var(--beige);min-height:100vh;color:#1D1D1F;}
.topbar{background:var(--blu);padding:16px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10;}
.topbar img{width:36px;height:36px;border-radius:8px;}
.topbar-title{color:#fff;font-size:15px;font-weight:600;}
.topbar-sub{color:var(--arancio);font-size:11px;text-transform:uppercase;letter-spacing:1px;}
.page{max-width:680px;margin:0 auto;padding:24px 16px 48px;}
.profile-card{background:var(--blu);border-radius:20px;padding:32px 24px;text-align:center;margin-bottom:20px;color:#fff;}
.avatar{width:80px;height:80px;border-radius:50%;background:var(--arancio);font-size:36px;font-weight:700;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:#fff;}
.profile-name{font-size:26px;font-weight:700;}
.profile-tipo{font-size:13px;color:var(--arancio);font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-top:6px;}
.badge{display:inline-block;background:rgba(255,255,255,0.15);padding:4px 14px;border-radius:20px;font-size:12px;margin-top:10px;}
.card{background:#fff;border-radius:16px;padding:20px 24px;margin-bottom:16px;box-shadow:0 2px 12px rgba(44,51,133,0.06);}
.card-title{font-size:11px;font-weight:700;color:var(--blu);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:16px;}
.field{display:flex;justify-content:space-between;align-items:flex-start;padding:10px 0;border-bottom:1px solid rgba(0,0,0,0.05);}
.field:last-child{border-bottom:none;padding-bottom:0;}
.field-label{font-size:13px;color:#86868B;}
.field-value{font-size:14px;font-weight:600;text-align:right;word-break:break-word;max-width:55%;}
code{background:rgba(0,0,0,0.04);padding:2px 6px;border-radius:6px;font-size:12px;font-family:monospace;}
.pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;}
.pill-green{background:#E3F9E5;color:#1A7F2E;}
.pill-red{background:#FFEBEE;color:#C62828;}
.id-box{background:rgba(242,145,4,0.08);border-left:4px solid var(--arancio);padding:16px;border-radius:8px;margin-bottom:16px;}
.id-box-label{font-size:11px;font-weight:700;color:#B06500;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;}
.id-box-value{font-size:22px;font-weight:700;color:var(--blu);letter-spacing:1px;}
.footer{text-align:center;padding:32px 16px 16px;font-size:11px;color:#86868B;}
.footer a{color:var(--blu);text-decoration:none;font-weight:600;}
</style></head>
<body>
<div class="topbar"><img src="${I.LOGO_URL}" alt="Logo">
<div><div class="topbar-title">${I.NOME_GRUPPO}</div><div class="topbar-sub">Portale Membri</div></div></div>
<div class="page">
<div class="profile-card"><div class="avatar">${avatar}</div>
<div class="profile-name">${nome} ${cognome}</div>
<div class="profile-tipo">${tipo}</div>
<div class="badge">🎵 ${gruppo}</div></div>
<div class="id-box"><div class="id-box-label">ID Pratica</div><div class="id-box-value">${idP}</div></div>
<div class="card"><div class="card-title">Dati Personali</div>
<div class="field"><span class="field-label">Codice Fiscale</span><span class="field-value"><code>${cf}</code></span></div>
<div class="field"><span class="field-label">Data di Nascita</span><span class="field-value">${_fmtDate(nascita)}</span></div>
<div class="field"><span class="field-label">Email personale</span><span class="field-value">${email}</span></div>
<div class="field"><span class="field-label">Telefono</span><span class="field-value">${tel||'N/D'}</span></div>
</div>
<div class="card"><div class="card-title">Dati Associativi</div>
<div class="field"><span class="field-label">Email istituzionale</span><span class="field-value"><code>${emailIst}</code></span></div>
<div class="field"><span class="field-label">Gruppo</span><span class="field-value">${gruppo}</span></div>
<div class="field"><span class="field-label">Data ammissione</span><span class="field-value">${dataAmm}</span></div>
<div class="field"><span class="field-label">Quota valida fino al</span><span class="field-value"><strong>${dataScad}</strong></span></div>
<div class="field"><span class="field-label">Stato pagamento</span><span class="field-value"><span class="pill ${pillPag}">${statoPag}</span></span></div>
<div class="field"><span class="field-label">Stato</span><span class="field-value"><span class="pill pill-green">✓ Membro ufficiale</span></span></div>
</div>
<div class="card"><div class="card-title">Accesso Rapido Servizi</div>
<div class="field"><span class="field-label">Gmail</span><span class="field-value"><a href="https://mail.google.com" target="_blank" style="color:{{COLORE_BLU}};">Apri</a></span></div>
<div class="field"><span class="field-label">Google Drive</span><span class="field-value"><a href="https://drive.google.com" target="_blank" style="color:{{COLORE_BLU}};">Apri</a></span></div>
<div class="field"><span class="field-label">Google Chat</span><span class="field-value"><a href="https://chat.google.com" target="_blank" style="color:{{COLORE_BLU}};">Apri</a></span></div>
<div class="field"><span class="field-label">Microsoft 365</span><span class="field-value"><a href="https://office.com" target="_blank" style="color:{{COLORE_BLU}};">Apri</a></span></div>
<div class="field"><span class="field-label">Sito web {{NOME_GRUPPO}}</span><span class="field-value"><a href="https://${I.SITO_WEB}" target="_blank" style="color:{{COLORE_BLU}};">{{DOMINIO}}</a></span></div>
</div></div>
<div class="footer"><p>&copy; ${new Date().getFullYear()} ${I.NOME_LEGALE}</p>
<p style="margin-top:4px;font-size:10px;">Dati riservati — accesso protetto da Google</p></div>
</body></html>`;

  return HtmlService.createHtmlOutput(html)
    .setTitle(`Profilo — ${nome} ${cognome}`)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);
}

function _adminPage(allData) {
  const IDX = PORTAL_CFG.IDX;
  const righe = allData.slice(1).filter(r => r[IDX.MEMBRO_UFFICIALE]==='SI');
  let rows = righe.map(r => {
    const tipo = r[IDX.TIPO_ASSOCIATO];
    const nome = tipo==='Socio Ordinario' ? r[IDX.NOME_SOCIO] : r[IDX.NOME_VOLONTARIO];
    const cog  = tipo==='Socio Ordinario' ? r[IDX.COGNOME_SOCIO] : r[IDX.COGNOME_VOLONTARIO];
    const scad = _fmtDate(r[IDX.DATA_SCADENZA_QUOTA]);
    const pag  = r[IDX.STATO_PAGAMENTO]||'';
    return `<tr><td>${nome} ${cog}</td><td>${tipo}</td><td>${r[IDX.GRUPPO]||''}</td><td><code>${r[IDX.EMAIL_ISTITUZIONALE]||''}</code></td><td>${scad}</td><td style="color:${pag==='Regolare'?'#1A7F2E':'#C62828'}">${pag}</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Admin {{NOME_GRUPPO}}</title>
<style>body{font-family:sans-serif;background:{{COLORE_BEIGE}};padding:32px;}table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;}th{background:{{COLORE_BLU}};color:#fff;padding:12px;text-align:left;font-size:13px;}td{padding:10px 12px;border-bottom:1px solid #eee;font-size:13px;}code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-size:12px;}h1{color:{{COLORE_BLU}};margin-bottom:16px;}</style>
</head><body><h1>Membri ufficiali {{NOME_GRUPPO}} (${righe.length})</h1>
<table><thead><tr><th>Nome</th><th>Tipo</th><th>Gruppo</th><th>Email</th><th>Scadenza quota</th><th>Pagamento</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;

  return HtmlService.createHtmlOutput(html).setTitle('Admin — Portale Membri {{NOME_GRUPPO}}');
}

function _errPage(titolo, msg) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${titolo}</title>
<style>body{font-family:sans-serif;background:{{COLORE_BEIGE}};display:flex;align-items:center;justify-content:center;min-height:100vh;}.card{background:#fff;border-radius:20px;padding:40px 32px;max-width:420px;text-align:center;box-shadow:0 8px 32px rgba(44,51,133,0.1);}h2{color:{{COLORE_BLU}};margin-bottom:16px;}p{color:#424245;line-height:1.6;font-size:15px;}a{color:{{COLORE_BLU}};font-weight:600;}</style>
</head><body><div class="card"><img src="${PORTAL_CFG.LOGO_URL}" style="width:60px;border-radius:12px;margin-bottom:20px;" alt="Logo"><h2>${titolo}</h2><p>${msg}</p>
<p style="margin-top:20px;font-size:13px;color:#86868B;"><a href="mailto:${PORTAL_CFG.EMAIL}">Contatta la Presidenza</a></p></div></body></html>`;
  return HtmlService.createHtmlOutput(html).setTitle(titolo);
}

function _fmtDate(d) {
  if (!d) return 'N/D';
  try {
    const o = (d instanceof Date) ? d : new Date(d);
    return isNaN(o.getTime()) ? String(d) : Utilities.formatDate(o,'Europe/Rome','dd/MM/yyyy');
  } catch(e) { return 'N/D'; }
}
