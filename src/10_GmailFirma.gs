/**
 * MODULO: 10_GmailFirma.gs
 * ══════════════════════════════════════════════════════════════════════
 * Genera e imposta la firma Gmail tramite Domain-Wide Delegation.
 * L'HTML della firma viene anche inviato via email da 6_Mail.gs.
 *
 * SETUP SERVICE ACCOUNT (necessario per impostare firma automaticamente):
 *  Vedi documento Word — Sezione "Setup Firma Gmail".
 *  In breve: Google Cloud Console > Service Accounts > chiave JSON >
 *  Admin Console > Delegazione dominio > scope gmail.settings.basic.
 *  Poi inserisci SA_CLIENT_EMAIL e SA_PRIVATE_KEY in 0_Secrets.gs.
 *  3500 righi di codice in totale 
 */

/**
 * Chiamata da eseguiEmailBenvenutoRitardata() in 2_TriggerAmmissione.gs, 15 minuti
 * dopo la creazione dell'account (non subito in eseguiOnboarding_): l'account GWS
 * ha bisogno di qualche minuto per propagarsi prima che l'API Gmail lo veda.
 * Tenta l'impostazione automatica via DWD; se fallisce, l'email con
 * le istruzioni manuali viene comunque inviata da inviaEmailFirmaGmail_().
 */
function impostaFirmaGmail_(emailIst, nome, cognome, telefono, ruolo) {
  traceLog_('[Firma] Tentativo impostazione automatica per: '+emailIst);

  if (!SECRETS.SA_CLIENT_EMAIL || SECRETS.SA_CLIENT_EMAIL.includes('INSERISCI')) {
    traceLog_('[Firma] Service account non configurato — firma solo via email istruzioni.');
    return;
  }

  const htmlFirma = generaHtmlFirma_(nome, cognome, emailIst, telefono, ruolo);

  // Attendi propagazione account (max 4 tentativi × 15s = 60s)
  for (let tentativo=1; tentativo<=4; tentativo++) {
    try {
      impostaFirmaViaAPI_(emailIst, htmlFirma);
      traceLog_('[Firma] ✅ Firma impostata automaticamente per '+emailIst);
      return;
    } catch(err) {
      const msg = err.message||'';
      if ((msg.includes('404')||msg.includes('invalid_grant')||msg.includes('not found'))
          && tentativo < 4) {
        traceLog_('[Firma] Account non ancora disponibile (tentativo '+tentativo+'/4). Attendo 15s...');
        Utilities.sleep(15000);
      } else {
        traceLog_('[Firma] WARN: impostazione automatica fallita dopo '+tentativo+' tentativi: '+msg);
        return; // L'email con istruzioni è già stata inviata da 6_Mail.gs
      }
    }
  }
}

// ── Genera HTML firma ─────────────────────────────────────────────────────────

function generaHtmlFirma_(nome, cognome, emailIst, telefono, ruolo) {
  // ☎ (U+260E) e ✉ (U+2709) sono caratteri BMP (3 byte) — sicuri in tutti i client email.
  // Le emoji a 4 byte come 📞 e 🌐 causano ������ in Outlook e alcune app native.
  const telLine = (telefono && String(telefono).trim())
    ? '<tr><td style="padding:2px 0;color:#595959;font-size:13px;font-family:Inter,Helvetica,Arial,sans-serif;">'
      + '&#9742;&nbsp;<a href="tel:'+String(telefono).trim()+'" style="color:#595959;text-decoration:none;">'
      + String(telefono).trim()+'</a></td></tr>'
    : '';

  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Inter,Helvetica,Arial,sans-serif;">
  <tr>
    <td style="padding-right:14px;vertical-align:top;">
      <img src="${CONFIG.LOGO_URL}" width="52" height="52"
           style="border-radius:10px;display:block;" alt="{{NOME_GRUPPO}}">
    </td>
    <td style="vertical-align:top;border-left:3px solid {{COLORE_ARANCIO}};padding-left:12px;">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr><td style="padding:0 0 2px 0;">
          <span style="font-size:15px;font-weight:700;color:{{COLORE_BLU}};font-family:Inter,Helvetica,Arial,sans-serif;">
            ${nome} ${cognome}
          </span>
        </td></tr>
        <tr><td style="padding:0 0 1px 0;">
          <span style="font-size:11px;font-weight:700;color:{{COLORE_ARANCIO}};font-family:Inter,Helvetica,Arial,sans-serif;text-transform:uppercase;letter-spacing:0.5px;">
            ${ruolo}
          </span>
        </td></tr>
        <tr><td style="padding:0 0 8px 0;">
          <span style="font-size:12px;color:#595959;font-family:Inter,Helvetica,Arial,sans-serif;">
            {{NOME_LEGALE}}
          </span>
        </td></tr>
        <tr><td style="padding:2px 0;font-size:13px;color:#595959;font-family:Inter,Helvetica,Arial,sans-serif;">
          &#9993;&nbsp;<a href="mailto:${emailIst}" style="color:{{COLORE_BLU}};text-decoration:none;font-weight:600;">${emailIst}</a>
        </td></tr>
        ${telLine}
        <tr><td style="padding:2px 0;font-size:13px;color:#595959;font-family:Inter,Helvetica,Arial,sans-serif;">
          <a href="https://{{SITO_WEB}}" style="color:{{COLORE_BLU}};text-decoration:none;">{{SITO_WEB}}</a>
        </td></tr>
      </table>
    </td>
  </tr>
</table>`;
}

// ── Ruolo firma ───────────────────────────────────────────────────────────────

function determinaRuoloFirma_(rowData) {
  const I = CONFIG.IDX;
  const custom = String(rowData[I.RUOLO_ASSOCIATIVO]||'').trim();
  if (custom) return custom;
  const tipo = String(rowData[I.TIPO_ASSOCIATO]||'').trim();
  if (tipo === 'Socio Ordinario') return 'Socio';
  if (tipo === 'Volontario')      return 'Volontario';
  return tipo || 'Membro';
}

// ── DWD — imposta firma via Gmail API ─────────────────────────────────────────

function impostaFirmaViaAPI_(emailUtente, htmlFirma) {
  const token = getAccessTokenDWD_(emailUtente);

  const patchResp = UrlFetchApp.fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/'+encodeURIComponent(emailUtente),
    {
      method: 'patch',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer '+token },
      payload: JSON.stringify({ signature: htmlFirma }),
      muteHttpExceptions: true,
    }
  );

  const code = patchResp.getResponseCode();
  if (code !== 200)
    throw new Error('Firma PATCH HTTP '+code+': '+patchResp.getContentText().substring(0,200));
}

function getAccessTokenDWD_(emailUtente) {
  const now    = Math.floor(Date.now()/1000);
  const header = { alg:'RS256', typ:'JWT' };
  const claim  = {
    iss:   SECRETS.SA_CLIENT_EMAIL,
    sub:   emailUtente,
    scope: 'https://www.googleapis.com/auth/gmail.settings.basic',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now, exp: now+3600,
  };

  const b64h   = Utilities.base64EncodeWebSafe(JSON.stringify(header));
  const b64c   = Utilities.base64EncodeWebSafe(JSON.stringify(claim));
  const toSign = b64h+'.'+b64c;
  const pk     = SECRETS.SA_PRIVATE_KEY.replace(/\\n/g,'\n');
  const sig    = Utilities.computeRsaSha256Signature(toSign, pk);
  const jwt    = toSign+'.'+Utilities.base64EncodeWebSafe(sig);

  const resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method:'post', contentType:'application/x-www-form-urlencoded',
    payload:'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion='+jwt,
    muteHttpExceptions:true,
  });

  if (resp.getResponseCode()!==200)
    throw new Error('[Firma] Token DWD fallito: '+resp.getResponseCode()+' '+resp.getContentText().substring(0,200));

  return JSON.parse(resp.getContentText()).access_token;
}

// ── Web App: pagina "Copia firma" ────────────────────────────────────────────
// Chiamata dal router unico in 15_ModuloIscrizioneWebApp.gs (doGet) quando
// l'URL contiene nome/cognome/email — un progetto Apps Script ha un solo doGet.

function doGetFirmaGmail(e) {
  const p       = (e && e.parameter) || {};
  const nome    = p.nome    || '';
  const cognome = p.cognome || '';
  const email   = p.email   || '';
  const tel     = p.tel     || '';
  const ruolo   = p.ruolo   || '';

  if (!nome || !cognome || !email) {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1.0">' +
      '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Inter",Helvetica,Arial,sans-serif;background:{{COLORE_BEIGE}};margin:0;padding:32px;color:#1D1D1F;}' +
      '.box{max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px;box-shadow:0 8px 24px rgba(44,51,133,0.1);}' +
      'h1{font-size:20px;color:{{COLORE_BLU}};margin:0 0 10px;}p{font-size:14px;line-height:1.6;color:#424245;}code{background:#f4f4f4;padding:2px 6px;border-radius:5px;}</style></head>' +
      '<body><div class="box"><h1>Web App {{NOME_GRUPPO}} attiva</h1>' +
      '<p>Questo URL e pronto per ricevere richieste automatiche come webhook Stripe tramite <code>POST</code>.</p>' +
      '<p>La pagina firma Gmail funziona solo con un link completo generato dal sistema, contenente <code>nome</code>, <code>cognome</code> ed <code>email</code>.</p>' +
      '</div></body></html>'
    ).setTitle('Web App {{NOME_GRUPPO}}');
  }

  const htmlFirma  = generaHtmlFirma_(nome, cognome, email, tel, ruolo);
  const firmaJson  = JSON.stringify(htmlFirma);
  const supportUrl = 'https://support.google.com/mail/answer/8395?hl=it&co=GENIE.Platform%3DAndroid&oco=0';

  const page = `<!DOCTYPE html><html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Firma Gmail {{NOME_GRUPPO}} — ${_htmlEscape(nome)} ${_htmlEscape(cognome)}</title>
  <style>
    *{box-sizing:border-box;}
    body{font-family:-apple-system,BlinkMacSystemFont,"Inter",Helvetica,Arial,sans-serif;
         background:{{COLORE_BEIGE}};margin:0;padding:32px 16px;}
    .container{max-width:600px;margin:0 auto;background:#fff;border-radius:20px;
               padding:36px;box-shadow:0 8px 24px rgba(44,51,133,0.1);}
    .logo{width:52px;height:52px;border-radius:12px;margin-bottom:16px;}
    h1{font-size:20px;color:{{COLORE_BLU}};margin:0 0 4px 0;}
    .sub{font-size:13px;color:#86868B;margin:0 0 28px 0;}
    .lbl{font-size:11px;text-transform:uppercase;font-weight:700;color:{{COLORE_BLU}};
         letter-spacing:0.5px;margin:0 0 10px 0;}
    .preview{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:12px;
             padding:20px;margin-bottom:24px;}
    .btn{display:inline-flex;align-items:center;gap:8px;background:{{COLORE_BLU}};color:#fff;
         border:none;border-radius:12px;padding:13px 28px;font-size:15px;font-weight:600;
         cursor:pointer;transition:background 0.2s;text-decoration:none;}
    .btn:hover{background:#1e2460;}
    .btn.ok{background:#1a7a1a;}
    .support{margin-top:24px;font-size:13px;color:#595959;}
    .support a{color:{{COLORE_ARANCIO}};font-weight:600;}
  </style>
</head>
<body>
  <div class="container">
    <img class="logo" src="${CONFIG.LOGO_URL}" alt="{{NOME_GRUPPO}}">
    <h1>Firma Gmail — ${_htmlEscape(nome)} ${_htmlEscape(cognome)}</h1>
    <p class="sub">{{NOME_LEGALE}}</p>

    <p class="lbl">Anteprima firma</p>
    <div class="preview" id="preview">${htmlFirma}</div>

    <button class="btn" id="btn" onclick="copia()">📋&nbsp;Copia firma</button>

    <div class="support">
      📖&nbsp;<a href="${supportUrl}" target="_blank">
        Guida Google: come impostare la firma in Gmail
      </a>
    </div>
  </div>
  <script>
    var F = ${firmaJson};

    async function copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch (err) {
        console.error('Errore durante la copia:', err);
        throw err;
      }
    }

    function copia() {
      var btn = document.getElementById('btn');
      var preview = document.getElementById('preview');
      function ok() {
        btn.innerHTML = '✅ Copiato!';
        btn.classList.add('ok');
        setTimeout(function(){ btn.innerHTML = '📋 Copia firma'; btn.classList.remove('ok'); }, 2500);
      }
      // Copia come HTML formattato (incolla correttamente in Gmail)
      if (navigator.clipboard && window.ClipboardItem) {
        var blob = new Blob([F], { type: 'text/html' });
        navigator.clipboard.write([new ClipboardItem({ 'text/html': blob })]).then(ok).catch(fb);
      } else {
        // Fallback testo semplice via copyToClipboard
        copyToClipboard(preview.innerText).then(ok).catch(fb);
      }
      // Fallback finale: seleziona il preview e copia con execCommand
      function fb() {
        var range = document.createRange();
        range.selectNodeContents(preview);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        try { document.execCommand('copy'); } catch(e) {}
        sel.removeAllRanges();
        ok();
      }
    }
  </script>
</body>
</html>`;

  return HtmlService.createHtmlOutput(page).setTitle('Firma Gmail {{NOME_GRUPPO}}');
}

/** Test: invia email anteprima firma all'admin */
function testFirmaGmail() {
  const html = generaHtmlFirma_('Mario','Rossi','mario.rossi@{{DOMINIO}}','+39 333 1234567','Socio');
  inviaEmail_(CONFIG.EMAIL_ADMIN_ERRORI, '[TEST] Anteprima firma Gmail {{NOME_GRUPPO}}',
    _htmlWrapper('Test Firma',
      '<div class="text">Anteprima firma:</div>'+
      '<div style="padding:16px;background:#f8f8f8;border-radius:12px;border:1px solid #e0e0e0;">'+html+'</div>'+
      '<div style="margin:20px 0;"><p style="font-size:13px;font-weight:700;color:{{COLORE_BLU}};">Codice HTML:</p>'+
      '<div class="code-block"><pre>'+_htmlEscape(html)+'</pre></div></div>'
    ));
  traceLog_('[Test Firma] Inviata a '+CONFIG.EMAIL_ADMIN_ERRORI);
}
