/**
 * MODULO: 6_Mail.gs
 * ══════════════════════════════════════════════════════════════════════
 * Tutti i template email del sistema di gestione associati.
 * Usa inviaEmail_() (GmailApp) per deliverability su tutti i domini.
 *
 * Funzioni esportate:
 *  inviaEmailInvitoPagamento_()        → Socio Ordinario ammesso, invito a pagare (Fase 2)
 *  inviaEmailBenvenuto_()              → al membro (email del modulo)
 *  inviaEmailGenitoreAmmissione_()     → al genitore
 *  inviaEmailRifiuto_()                → domanda rifiutata
 *  inviaEmailFirmaGmail_()             → istruzioni firma + HTML grezzo
 *  inviaEmailConfermaRimborso_()       → rimborso post-rifiuto
 *  inviaEmailRimborsoManuale_()        → admin: rimborso manuale
 *  inviaEmailAnnullamentoAbbonamento_()→ socio ha cancellato
 *  inviaEmailVolontarioGenitoreAnnullato_() → volontario avvisato
 *  inviaEmailPagamentoFallito_()       → Stripe payment_failed
 *  inviaEmailConfermaRinnovo_()        → rinnovo riuscito
 *  inviaEmailContraddittorio_()        → proposta di espulsione: invito a
 *                                         esporre le proprie ragioni (Art. 9.3)
 *  inviaEmailEspulsione_()             → espulsione deliberata dall'Assemblea
 *  inviaEmailCessazione_()             → decadenza / recesso / incapacità
 */

// ─────────────────────────────────────────────────────────────────────────────
// INVITO AL PAGAMENTO — Socio Ordinario ammesso, prima del pagamento (Fase 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inviata quando la Presidenza ammette un Socio Ordinario, PRIMA che la quota
 * sia stata pagata. Il modulo completo (dati anagrafici, firma, documento)
 * è già stato compilato in Fase 1: qui manca solo il pagamento, che avviene
 * nel Modulo di Fase 2 identificandosi con ID Pratica + Codice Fiscale.
 * L'onboarding (Workspace, tessera, email di benvenuto) parte da solo, in
 * automatico, non appena Stripe conferma il pagamento — vedi
 * gestisciPagamentoRiuscito_() in 3_StripeAdmin.gs.
 */
function inviaEmailInvitoPagamento_(rowData, idP) {
  const I     = CONFIG.IDX;
  const tipo  = rowData[I.TIPO_ASSOCIATO];
  const dati  = getDatiAnagrafici_(rowData, tipo);
  const quota = (CONFIG.STRIPE.QUOTA_CENTESIMI/100).toFixed(2);

  let linkPagamento = 'https://{{SITO_WEB}}';
  try {
    const baseUrl = ScriptApp.getService().getUrl();
    if (baseUrl) linkPagamento = baseUrl + '?pagina=paga&idPratica=' + encodeURIComponent(idP);
  } catch(e) { traceLog_('[InvitoPagamento] URL web app non disponibile: ' + e.message); }

  const contenuto = `
    <div class="greeting">Ciao ${dati.nome} ${dati.cognome},</div>
    <div class="text">Buone notizie: la Presidenza dell'<strong>${CONFIG.NOME_LEGALE}</strong> ha
      <strong>approvato</strong> la tua domanda di adesione come <strong>${tipo}</strong>.
      Manca un solo passaggio per diventare ufficialmente membro dell'Associazione:
      il pagamento della quota associativa.</div>
    <div class="card">
      <div class="card-title">La tua domanda</div>
      ${_riga('ID Pratica', '<code>'+idP+'</code>')}
      ${_riga('Codice Fiscale', dati.cf || 'N/D')}
      ${_riga('Quota da versare', quota+' EUR / anno')}
    </div>
    <div class="highlight-box">
      <div class="highlight-title">Completa l'iscrizione</div>
      <p style="font-size:14px;color:#424245;line-height:1.6;margin:0 0 16px 0;">
        Clicca il pulsante qui sotto, inserisci <strong>ID Pratica</strong> e
        <strong>Codice Fiscale</strong> (li trovi sopra) e paga con carta in sicurezza su Stripe.
      </p>
      ${_pulsante('Associati adesso &rarr;', linkPagamento, CONFIG.COLORI.ARANCIO)}
    </div>
    <div class="info-note">
      <strong>Cosa succede dopo il pagamento?</strong> Niente: ci pensa il sistema.
      Non appena il pagamento è verificato, in automatico creiamo il tuo account
      Google Workspace istituzionale e ti inviamo un'unica email con le credenziali
      e la tessera associativa in PDF.
    </div>
    ${DISCLAIMER_SICUREZZA}`;

  inviaEmail_(dati.email, 'Domanda approvata — completa l\'iscrizione — '+CONFIG.NOME_GRUPPO,
    _htmlWrapper('Domanda approvata!', contenuto, '#34C759', CONFIG.COLORI.BLU));
}

// ─────────────────────────────────────────────────────────────────────────────
// BENVENUTO — inviato alla EMAIL DEL MODULO (personale), non istituzionale
// ─────────────────────────────────────────────────────────────────────────────

function inviaEmailBenvenuto_(rowData, tipo, emailIst, pwd, tesseraPDF,
                               dataAmmObj, dataScadenza, wsOk, m365Ok, tesseraUrl, wsPasswordDisponibile) {
  tesseraUrl = tesseraUrl || '';
  wsPasswordDisponibile = wsPasswordDisponibile !== false;
  const I    = CONFIG.IDX;
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[I.ID_PRATICA]||'N/D';

  // Genere: colonna C (SESSO_SOCIO) per Socio Ordinario, colonna K (SESSO_VOLONTARIO) per Volontario
  const sesso     = String(tipo === 'Socio Ordinario' ? rowData[I.SESSO_SOCIO] : rowData[I.SESSO_VOLONTARIO] || '').trim().toUpperCase();
  const benvenuto = sesso === 'F' ? 'Benvenuta!' : 'Benvenuto!';
  const gruppo    = rowData[I.GRUPPO]||'N/D';
  const dataAmmStr= formatData_(dataAmmObj);
  const dataScadStr=formatData_(dataScadenza);
  const chatSpace = (gruppo==='Volontari') ? 'Musicisti' : gruppo;
  const guidesUrl = SECRETS.DRIVE_GUIDE_URL || '#';
  const portalUrl = CONFIG.PORTAL_BASE_URL + '/utenti/' + generaSlugMembro_(dati.nome, dati.cognome);
  const rigaPasswordGWS = wsPasswordDisponibile && pwd
    ? _riga('Password temporanea', '<code>'+pwd+'</code>')
    : _riga('Password', 'Account già esistente: usa la password attuale. Se non la ricordi, richiedi il reset alla Presidenza.');

  // ── Blocco accesso Google Workspace ──────────────────────────────────────
  // Nota: emoji sopra U+FFFF (es. 🔵 🔷) omesse — causano ������ in Outlook/app native
  const bloccoGWS = wsOk
    ? `<div class="card">
        <div class="card-title">Accesso Google Workspace {{NOME_GRUPPO}}</div>
        ${_riga('Email / Username', '<code>'+emailIst+'</code>')}
        ${rigaPasswordGWS}
        ${_riga('Gruppo Google Chat', chatSpace)}
       </div>
       <div class="info-note">
         <strong>Primo accesso Google (obbligatorio):</strong><br>
         1. Vai su <a href="https://accounts.google.com/AccountChooser" style="color:${CONFIG.COLORI.BLU};">accounts.google.com</a>
            e accedi con <code>${emailIst}</code> e la password sopra.<br>
         2. Se ti viene chiesto di impostare una <strong>nuova password</strong>, fallo subito.<br>
         3. Attiva la verifica in due passaggi nelle impostazioni di sicurezza.<br><br>
         <strong>Servizi disponibili:</strong>
         <a href="https://mail.google.com" style="color:${CONFIG.COLORI.BLU};">Gmail per le email</a> &middot;
         <a href="https://drive.google.com" style="color:${CONFIG.COLORI.BLU};">Drive per l'archiviazione</a> &middot;
         <a href="https://chat.google.com" style="color:${CONFIG.COLORI.BLU};">Google Chat per la comunicazione(${chatSpace})</a> &middot;
         <a href="https://calendar.google.com" style="color:${CONFIG.COLORI.BLU};">Calendar per la programmazione</a> &middot;
         <a href="https://meet.google.com" style="color:${CONFIG.COLORI.BLU};">Meet per le riunioni</a> &middot;
         <a href="https://gemini.google.com" style="color:${CONFIG.COLORI.BLU};">Gemini per l'IA</a> &middot;
          <a href="https://tasks.google.com/" style="color:${CONFIG.COLORI.BLU};">Task per i promemoria</a>
       </div>`
    : '<div class="alert-box"><div class="alert-title">Account Google Workspace</div><p class="alert-text">Sarà configurato entro 24 ore. Riceverai una email separata con le credenziali.</p></div>';

  // ── Blocco firma Gmail ─────────────────────────────────────────────────────
  const supportFirmaUrl = 'https://support.google.com/mail/answer/8395?hl=it';
  const bloccoFirma = wsOk
    ? `<div class="card">
        <div class="card-title">Firma Gmail</div>
        <p style="font-size:14px;color:#424245;line-height:1.6;margin:0 0 12px 0;">
          Abbiamo già impostato automaticamente la tua firma istituzionale su <code>${emailIst}</code>,
          con nome, ruolo e contatti. Non devi fare nulla — riceverai anche una email dedicata con
          l'anteprima e il codice pronto da copiare, nel caso volessi personalizzarla.
        </p>
        <p style="font-size:13px;color:#424245;line-height:1.6;margin:0;">
          <strong>Per modificarla manualmente:</strong> Gmail &rarr; icona &#9881; in alto a destra &rarr;
          <strong>Visualizza tutte le impostazioni</strong> &rarr; scheda <strong>Generale</strong> &rarr;
          sezione <strong>Firma</strong> &rarr; modifica &rarr; <strong>Salva modifiche</strong> in fondo alla pagina.
          <a href="${supportFirmaUrl}" style="color:${CONFIG.COLORI.BLU};font-weight:600;">Guida ufficiale Google &rarr;</a>
        </p>
       </div>`
    : '';

  // ── Blocco accesso Microsoft 365 ──────────────────────────────────────────
  const bloccoM365 = m365Ok
    ? `<div class="card">
        <div class="card-title">Accesso Microsoft 365</div>
        ${_riga('Email / Username', '<code>'+emailIst+'</code>')}
        ${_riga('Password temporanea', '<code>'+pwd+'</code>')}
       </div>
       <div class="info-note">
         <strong>Primo accesso Microsoft (obbligatorio):</strong><br>
         1. Vai su <a href="https://office.com" style="color:${CONFIG.COLORI.BLU};">office.com</a>
            e accedi con <code>${emailIst}</code> e la stessa password.<br>
         2. Cambia la password e configura l'autenticazione a pi&ugrave; fattori (MFA).<br><br>
         <strong>Incluso:</strong> Word, Excel, PowerPoint (web) &middot; Teams &middot; Outlook &middot; OneDrive (1TB)
       </div>`
    : '<div class="info-note">Account Microsoft 365 in configurazione &mdash; riceverai le credenziali entro 24 ore.</div>';

  // ── Blocco guide e portale ────────────────────────────────────────────────
  // Calcola il path della guida strumenti in base al gruppo
  const useSoftwarePath = (function() {
    if (gruppo === 'Presidenza') return 'presidenza';
    if (gruppo === 'Volontari')  return 'volontari';
    return 'soci'; // Soci Ordinari e qualsiasi altro valore
  })();
  const useSoftwareUrl = 'https://{{SITO_WEB}}/unisciti/use-software/' + useSoftwarePath + '/';

  const bloccoGuide = `
    <div class="card">
      <div class="card-title">Guide e Risorse</div>
      ${_riga('Guide PDF per nuovi membri',
        '<a href="'+guidesUrl+'" style="color:'+CONFIG.COLORI.BLU+';font-weight:600;">Apri cartella Drive</a>')}
      ${_riga('Il tuo profilo personale',
        '<a href="'+portalUrl+'" style="color:'+CONFIG.COLORI.BLU+';font-weight:600;">'+portalUrl+'</a>')}
    </div>
    <div style="margin:24px 0;background-color:#F5F5F7;border-radius:16px;padding:24px;text-align:center;border:1px solid #E5E5EA;">
      <p style="font-size:13px;color:#424245;line-height:1.55;margin:0 0 16px 0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',Arial,sans-serif;">
        Scopri tutti gli strumenti digitali a tua disposizione: Gmail, Google Chat, Drive, Calendar e altro ancora.
      </p>
      ${_pulsante('Guida agli strumenti digitali &rarr;', useSoftwareUrl, CONFIG.COLORI.BLU)}
    </div>`;

  // ── Riquadro tessera associativa ──────────────────────────────────────────
  const notaTessera = tesseraPDF
    ? `<div class="card">
        <div class="card-title">Tessera personale {{NOME_GRUPPO}}</div>
        <p style="font-size:14px;color:#424245;line-height:1.6;margin:0 0 14px 0;">
          La tua tessera &egrave; allegata a questa email in PDF e contiene il QR code
          per accedere al tuo profilo sul portale. &Egrave; la tessera interna
          dell'Associazione: la <strong>tessera associativa {{RETE_AFFILIAZIONE}}</strong> &egrave; un'altra cosa,
          la emette la rete associativa nazionale a cui siamo affiliati (Art. 8.4 dello Statuto).
        </p>
        ${tesseraUrl
          ? _pulsante('Anteprima tessera', tesseraUrl, CONFIG.COLORI.ARANCIO, 'left')
          : ''}
       </div>`
    : '<div class="alert-box"><div class="alert-title">Tessera personale {{NOME_GRUPPO}}</div><p class="alert-text">Verr&agrave; inviata entro 24 ore.</p></div>';

  const contenuto = `
    <div class="greeting">Ciao ${dati.nome} ${dati.cognome},</div>
    <div class="text">La Presidenza dell'<strong>${CONFIG.NOME_LEGALE}</strong> ha approvato
      la tua domanda di adesione come <strong>${tipo}</strong> in data <strong>${dataAmmStr}</strong>.
      Sei ufficialmente un membro dell'Associazione.</div>
    <div class="highlight-box">
      <div class="highlight-title">Quota associativa valida fino al</div>
      <div class="highlight-value">${dataScadStr}</div>
    </div>
    <div class="card">
      <div class="card-title">La tua iscrizione</div>
      ${_riga('ID Pratica', '<code>'+idP+'</code>')}
      ${_riga('Tipo', tipo)}
      ${_riga('Gruppo', gruppo)}
      ${_riga('Data ammissione', dataAmmStr)}
      ${_riga('Scadenza quota', dataScadStr)}
    </div>
    ${notaTessera}
    ${bloccoGWS}
    ${bloccoFirma}
    ${bloccoM365}
    ${bloccoGuide}
    <div class="info-note">
      <strong>Rinnovo automatico:</strong> La quota si rinnova ogni anno automaticamente.
      Riceverai una email di conferma prima di ogni addebito.
    </div>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0 24px 0; background-color:#FCF6F0; border-radius:20px; border:1px solid rgba(242,145,4,0.15); border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:40px 36px 36px 36px; text-align:center;">
          <div style="font-size:22px; color:${CONFIG.COLORI.ARANCIO}; margin-bottom:18px; letter-spacing:6px;">&#9834;&nbsp;&#9835;&nbsp;&#9834;</div>
          <div style="font-size:21px; font-weight:700; color:#1D1D1F; margin-bottom:16px; line-height:1.3; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',Arial,sans-serif; letter-spacing:-0.5px;">
            Questo &egrave; solo l&rsquo;inizio.
          </div>
          <p style="font-size:14px; color:#424245; line-height:1.6; margin:0 0 16px 0; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',Arial,sans-serif;">
            Ogni grande orchestra nasce da piccoli gesti:<br>
            un saluto, una stretta di mano, un <em>&ldquo;s&igrave;, voglio farne parte&rdquo;</em>.
          </p>
          <p style="font-size:14px; color:#424245; line-height:1.6; margin:0 0 20px 0; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',Arial,sans-serif;">
            Raccontaci com&rsquo;&egrave; andata questa prima esperienza&nbsp;&mdash;<br>
            cosa ti ha colpito, cosa ti ha sorpreso,<br>
            cosa potremmo rendere ancora pi&ugrave; bello per te.
          </p>
          <p style="font-size:15px; font-weight:600; color:#1D1D1F; line-height:1.6; margin:0 0 24px 0; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',Arial,sans-serif;">
            Il tuo punto di vista costruisce l&rsquo;accoglienza<br>per chi verr&agrave; dopo di te.
          </p>
          ${_pulsante('Condividi la tua esperienza &rarr;', '{{URL_FEEDBACK}}', CONFIG.COLORI.ARANCIO)}
          <p style="font-size:11px; color:#86868B; margin:16px 0 0 0; line-height:1.6; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',Arial,sans-serif;">
            Circa 2 minuti &bull; Risposte anonime &bull; Ci aiutano a fare meglio
          </p>
        </td>
      </tr>
    </table>
    ${DISCLAIMER_SICUREZZA}`;

  const opts = { attachments: tesseraPDF ? [tesseraPDF] : [] };

  // Invia alla EMAIL DEL MODULO (personale) — header verde per ammissione
  inviaEmail_(dati.email, benvenuto+' '+CONFIG.NOME_GRUPPO+' — Accesso e Tessera',
    _htmlWrapper(benvenuto, contenuto, '#34C759', CONFIG.COLORI.BLU), opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// BENVENUTO GENITORE — Volontario
// ─────────────────────────────────────────────────────────────────────────────

function inviaEmailGenitoreAmmissione_(rowData, emailIst, pwd, tesseraPDF,
                                        dataAmmObj, dataScadenza, wsOk, m365Ok, tesseraUrl, wsPasswordDisponibile) {
  tesseraUrl = tesseraUrl || '';
  wsPasswordDisponibile = wsPasswordDisponibile !== false;
  const I       = CONFIG.IDX;
  const datiVol = getDatiAnagrafici_(rowData, 'Volontario');
  const idP     = rowData[I.ID_PRATICA]||'N/D';
  const gruppo  = rowData[I.GRUPPO]||'N/D';
  const dataAmmStr  = formatData_(dataAmmObj);
  const dataScadStr = formatData_(dataScadenza);
  const emailGen    = trovaEmailGenitore_(rowData);
  if (!emailGen) { traceLog_('[Mail Genitore] Email genitore non trovata. Skip.'); return; }

  const sesso          = String(rowData[I.SESSO_VOLONTARIO]||'').trim().toUpperCase();
  const siUnito        = sesso === 'F' ? 'si è unita a noi!' : 'si è unito a noi!';
  const tuoFiglio      = sesso === 'F' ? 'Tua figlia' : 'Tuo figlio';
  const tuoFiglioLower = sesso === 'F' ? 'tua figlia' : 'tuo figlio';
  const ammessa        = sesso === 'F' ? 'ammessa' : 'ammesso';
  const chatSpace      = (gruppo==='Volontari') ? 'Musicisti' : gruppo;
  const rigaPasswordGWS = wsPasswordDisponibile && pwd
    ? _riga('Password temporanea', '<code>'+pwd+'</code>')
    : _riga('Password', 'Account già esistente: usare la password attuale. Se non la ricordate, richiedete il reset alla Presidenza.');

  // ── Blocco tessera ─────────────────────────────────────────────────────────
  const notaTessera = tesseraPDF
    ? `<div class="card">
        <div class="card-title">Tessera personale {{NOME_GRUPPO}}</div>
        <p style="font-size:14px;color:#424245;line-height:1.6;margin:0 0 14px 0;">
          La tessera di <strong>${datiVol.nome}</strong> è allegata a questa email in PDF
          e contiene il QR code per accedere al suo profilo sul portale. È la tessera interna
          dell'Associazione: la <strong>tessera associativa {{RETE_AFFILIAZIONE}}</strong> è un'altra cosa,
          la emette la rete associativa nazionale a cui siamo affiliati (Art. 8.4 dello Statuto).
        </p>
        ${tesseraUrl
          ? _pulsante('Anteprima tessera', tesseraUrl, CONFIG.COLORI.ARANCIO, 'left')
          : ''}
       </div>`
    : '<div class="alert-box"><div class="alert-title">Tessera personale {{NOME_GRUPPO}}</div><p class="alert-text">Verrà inviata entro 24 ore.</p></div>';

  // ── Blocco Google Workspace ────────────────────────────────────────────────
  const bloccoGWS = wsOk
    ? `<div class="card">
        <div class="card-title">Accesso Google Workspace {{NOME_GRUPPO}} — ${datiVol.nome}</div>
        ${_riga('Email', '<code>'+emailIst+'</code>')}
        ${rigaPasswordGWS}
        ${_riga('Gruppo Google Chat', chatSpace)}
       </div>
       <div class="info-note">
         <strong>Primo accesso Google (obbligatorio per ${datiVol.nome}):</strong><br>
         1. Vai su <a href="https://accounts.google.com/AccountChooser" style="color:${CONFIG.COLORI.BLU};">accounts.google.com</a>
            e accedi con <code>${emailIst}</code> e la password sopra.<br>
         2. Impostare una <strong>nuova password</strong> quando richiesto.<br>
         3. Attivare la verifica in due passaggi nelle impostazioni di sicurezza.<br><br>
         <strong>Servizi disponibili:</strong>
         <a href="https://mail.google.com" style="color:${CONFIG.COLORI.BLU};">Gmail per le email</a> &middot;
         <a href="https://drive.google.com" style="color:${CONFIG.COLORI.BLU};">Drive per l'archiviazione</a> &middot;
         <a href="https://chat.google.com" style="color:${CONFIG.COLORI.BLU};">Google Chat per la comunicazione (${chatSpace})</a> &middot;
         <a href="https://calendar.google.com" style="color:${CONFIG.COLORI.BLU};">Calendar per gli eventi</a> &middot;
         <a href="https://tasks.google.com/" style="color:${CONFIG.COLORI.BLU};">Task per i promemoria</a>
       </div>`
    : '<div class="alert-box"><div class="alert-title">Account Google Workspace</div><p class="alert-text">Sarà configurato entro 24 ore. Riceverete una email separata con le credenziali.</p></div>';

  // ── Blocco Microsoft 365 ──────────────────────────────────────────────────
  const bloccoM365 = m365Ok
    ? `<div class="card">
        <div class="card-title">Accesso Microsoft 365 — ${datiVol.nome}</div>
        ${_riga('Email / Username', '<code>'+emailIst+'</code>')}
        ${_riga('Password temporanea', '<code>'+pwd+'</code>')}
       </div>
       <div class="info-note">
         <strong>Primo accesso Microsoft (obbligatorio per ${datiVol.nome}):</strong><br>
         1. Vai su <a href="https://office.com" style="color:${CONFIG.COLORI.BLU};">office.com</a>
            e accedi con <code>${emailIst}</code> e la stessa password.<br>
         2. Cambiare la password e configurare l'autenticazione a più fattori (MFA).<br><br>
         <strong>Incluso:</strong> Word, Excel, PowerPoint (web) &middot; Teams &middot; Outlook &middot; OneDrive (1TB)
       </div>`
    : '<div class="info-note">Account Microsoft 365 in configurazione — riceverete le credenziali entro 24 ore.</div>';

  const contenuto = `
    <div class="greeting">Gentile genitore/tutore,</div>
    <div class="text">${tuoFiglio} <strong>${datiVol.nome} ${datiVol.cognome}</strong>
      è stato/a <strong>${ammessa}</strong> dalla Presidenza
      dell'<strong>${CONFIG.NOME_LEGALE}</strong> come <strong>Volontario</strong>
      in data <strong>${dataAmmStr}</strong>.</div>
    <div class="highlight-box">
      <div class="highlight-title">Quota associativa valida fino al</div>
      <div class="highlight-value">${dataScadStr}</div>
    </div>
    <div class="card">
      <div class="card-title">Dati dell'iscrizione</div>
      ${_riga('ID Pratica', '<code>'+idP+'</code>')}
      ${_riga('Tipo', 'Volontario')}
      ${_riga('Gruppo', gruppo)}
      ${_riga('Data ammissione', dataAmmStr)}
      ${_riga('Scadenza quota', dataScadStr)}
    </div>
    ${notaTessera}
    ${bloccoGWS}
    ${bloccoM365}
    <div style="margin:18px 0 0 0;background:{{COLORE_BEIGE}};border-radius:12px;padding:22px 24px;text-align:center;">
      <p style="font-size:13px;color:#5D5F5F;line-height:1.6;margin:0 0 14px 0;">
        Scopri tutti gli strumenti digitali a disposizione di ${datiVol.nome}: Gmail, Google Chat Musicisti, Drive e Calendar.
      </p>
      ${_pulsante('Guida agli strumenti digitali &rarr;', 'https://{{SITO_WEB}}/unisciti/use-software/volontari/', CONFIG.COLORI.BLU)}
    </div>
    <div class="info-note">⚠️ <strong>Nota:</strong> Il mancato pagamento della quota associativa
      annuale comporta la decadenza dalla qualifica di Socio, accertata dalla Presidenza
      (Art. 9.1.b e 9.2 dello Statuto). Poiché l'iscrizione di ${tuoFiglioLower} come Volontario
      è collegata alla tua, anche la sua posizione verrebbe riesaminata.</div>
    ${DISCLAIMER_SICUREZZA}`;

  const opts = { attachments: tesseraPDF ? [tesseraPDF] : [] };
  inviaEmail_(emailGen,
    datiVol.nome+' '+datiVol.cognome+' '+siUnito+' — '+CONFIG.NOME_GRUPPO,
    _htmlWrapper(datiVol.nome+' '+datiVol.cognome+' '+siUnito, contenuto, '#34C759'), opts);
}

function trovaEmailGenitore_(rowData) {
  const I   = CONFIG.IDX;
  const cfG = String(rowData[I.CF_GENITORE]||'').trim().toUpperCase();
  const idG = String(rowData[I.ID_PRATICA_GENITORE]||'').trim().toUpperCase();
  if (!cfG) return null;
  const sheet   = SpreadsheetApp.openById(CONFIG.SHEET_ID).getSheetByName(CONFIG.SHEET_NAME);
  const allData = sheet.getDataRange().getValues();
  for (let i=1;i<allData.length;i++) {
    const r = allData[i];
    if (r[I.TIPO_ASSOCIATO] !== 'Socio Ordinario') continue;
    if (String(r[I.CF_SOCIO]||'').trim().toUpperCase()===cfG &&
        String(r[I.ID_PRATICA]||'').trim().toUpperCase()===idG)
      return r[I.EMAIL_SOCIO] || r[I.EMAIL_ISTITUZIONALE] || null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// RIFIUTO
// ─────────────────────────────────────────────────────────────────────────────

function inviaEmailRifiuto_(rowData, tipo, motivoRifiuto, dataRifStr, rimborsoInfo) {
  const I    = CONFIG.IDX;
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[I.ID_PRATICA]||'N/D';
  const haPag= (tipo === 'Socio Ordinario');

  const bloccoMotivazione = motivoRifiuto
    ? `<div class="highlight-box"><div class="highlight-title">Motivazione</div>
       <div style="font-size:15px;color:#424245;line-height:1.6;margin-top:8px;">${motivoRifiuto}</div></div>`
    : `<div class="info-note">La Presidenza non ha fornito motivazioni aggiuntive.
       Contattaci a <a href="mailto:${CONFIG.EMAIL_MITTENTE}" style="color:${CONFIG.COLORI.BLU};">${CONFIG.EMAIL_MITTENTE}</a>.</div>`;

  // rimborsoInfo.ok riflette l'esito reale già noto prima dell'invio dell'email.
  // Fallback su rowData[I.ID_TRANSAZIONE] per chiamate legacy senza rimborsoInfo.
  const bloccoRimborso = (function() {
    if (!haPag) return '';
    const rimborsoOk = rimborsoInfo
      ? rimborsoInfo.ok
      : !!(String(rowData[I.ID_TRANSAZIONE]||'').trim());
    return rimborsoOk
      ? '<div class="card"><div class="card-title">💰 Restituzione quota</div><p style="font-size:14px;color:#424245;">Il rimborso è stato avviato automaticamente sul metodo di pagamento originale (5–10 giorni lavorativi). Riceverai una email di conferma separata.</p></div>'
      : `<div class="alert-box"><div class="alert-title">💰 Restituzione quota</div><p class="alert-text">La Presidenza ti contatterà entro 5 giorni lavorativi per il rimborso manuale.<br>Contatti: <a href="mailto:${CONFIG.EMAIL_MITTENTE}" style="color:#8F0000;">${CONFIG.EMAIL_MITTENTE}</a></p></div>`;
  })();

  const contenuto = `
    <div class="greeting">Gentile ${dati.nome} ${dati.cognome},</div>
    <div class="text">La Presidenza dell'<strong>${CONFIG.NOME_LEGALE}</strong> ha esaminato
      la tua domanda come <strong>${tipo}</strong> (ID: <code>${idP}</code>) e con delibera
      del <strong>${dataRifStr}</strong> ha comunicato che <strong>la domanda non è stata accolta</strong>.</div>
    ${bloccoMotivazione}
    <div class="card">
      <div class="card-title">I tuoi diritti — Art. 8.3 e 8.5 Statuto</div>
      ${_riga('Riesame', 'Puoi richiedere per iscritto all\'Assemblea il riesame della decisione, che decide in via definitiva alla prima riunione utile.')}
      ${_riga('Come fare', 'Scrivi a '+CONFIG.EMAIL_MITTENTE+' con oggetto "Riesame — ID '+idP+'"')}
      ${_riga('Ratifica', 'La decisione è stata assunta da un componente delegato della Presidenza ed è soggetta a ratifica dell\'organo entro 10 giorni (Art. 8.3).')}
    </div>
    ${bloccoRimborso}
    ${DISCLAIMER_SICUREZZA}`;

  inviaEmail_(dati.email, 'Esito domanda di ammissione — '+CONFIG.NOME_GRUPPO,
    _htmlWrapper('Esito domanda', contenuto, '#C00000'));
}

// ─────────────────────────────────────────────────────────────────────────────
// CESSAZIONE DEL RAPPORTO ASSOCIATIVO (Statuto Art. 9)
// ─────────────────────────────────────────────────────────────────────────────
//
// Tre email, tre momenti diversi del procedimento disciplinare e non:
//   inviaEmailContraddittorio_  la Presidenza propone l'espulsione e
//                               l'interessato viene invitato a esporre le sue
//                               ragioni prima che l'Assemblea deliberi (9.3).
//   inviaEmailEspulsione_       l'Assemblea ha deliberato.
//   inviaEmailCessazione_       le altre cause (decadenza, recesso, incapacità).

/**
 * Invito al contraddittorio previsto dall'Art. 9.3: l'Assemblea può deliberare
 * l'espulsione solo «dopo aver ascoltato l'interessato». Questa email è quel
 * momento, e va detto chiaramente che finché l'Assemblea non delibera non
 * cambia nulla — accessi, quota e posizione restano quelli di prima.
 */
function inviaEmailContraddittorio_(rowData, tipo, motivo, dataStr) {
  const I    = CONFIG.IDX;
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[I.ID_PRATICA]||'N/D';

  const contenuto = `
    <div class="greeting">Gentile ${dati.nome} ${dati.cognome},</div>
    <div class="text">La Presidenza dell'<strong>${CONFIG.NOME_LEGALE}</strong> ha deliberato in data
      <strong>${dataStr}</strong> di proporre all'Assemblea dei Soci la tua espulsione
      (ID: <code>${idP}</code>).</div>
    <div class="highlight-box">
      <div class="highlight-title">Motivo della proposta</div>
      <div style="font-size:15px;color:#424245;line-height:1.6;margin-top:8px;">${motivo}</div>
    </div>
    <div class="card">
      <div class="card-title">Il tuo diritto a essere ascoltato — Art. 9.3 Statuto</div>
      ${_riga('Chi decide', 'L\'Assemblea dei Soci, su proposta della Presidenza. La Presidenza da sola non pu&ograve; espellere.')}
      ${_riga('Prima della delibera', 'Hai diritto a esporre le tue ragioni in contraddittorio: l\'Assemblea delibera solo dopo averti ascoltato.')}
      ${_riga('Come farlo', 'Scrivi a '+CONFIG.EMAIL_MITTENTE+' con oggetto "Contraddittorio — ID '+idP+'" per concordare come e quando essere ascoltato.')}
    </div>
    <div class="info-note">Fino alla delibera dell'Assemblea <strong>non cambia nulla</strong>:
      resti Membro a pieno titolo, gli accessi restano attivi e la quota gi&agrave; versata non &egrave; toccata.</div>
    ${DISCLAIMER_SICUREZZA}`;

  inviaEmail_(dati.email, 'Procedimento disciplinare — invito a esporre le tue ragioni',
    _htmlWrapper('Procedimento disciplinare', contenuto, '#B06500'));
}

/**
 * Comunica l'espulsione deliberata dall'Assemblea dei Soci. Gli estremi della
 * delibera sono parte del messaggio, non un dettaglio interno: sono ciò che
 * rende la comunicazione verificabile da chi la riceve.
 */
function inviaEmailEspulsione_(rowData, tipo, motivo, dataStr, deliberaAssemblea) {
  const I    = CONFIG.IDX;
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[I.ID_PRATICA]||'N/D';
  const delibera = String(deliberaAssemblea||'').trim();

  const contenuto = `
    <div class="greeting">Gentile ${dati.nome} ${dati.cognome},</div>
    <div class="text">L'<strong>Assemblea dei Soci</strong> dell'<strong>${CONFIG.NOME_LEGALE}</strong>,
      su proposta della Presidenza e dopo il contraddittorio previsto dall'Art. 9.3 dello Statuto,
      ha deliberato la tua <strong>espulsione</strong> dall'Associazione, con efficacia
      dal <strong>${dataStr}</strong> (ID: <code>${idP}</code>).</div>
    <div class="highlight-box">
      <div class="highlight-title">Motivazione</div>
      <div style="font-size:15px;color:#424245;line-height:1.6;margin-top:8px;">${motivo}</div>
    </div>
    <div class="card">
      <div class="card-title">Delibera</div>
      ${_riga('Organo', 'Assemblea dei Soci, su proposta della Presidenza (Art. 9.3 Statuto)')}
      ${delibera ? _riga('Estremi', delibera) : ''}
      ${_riga('Efficacia', dataStr)}
    </div>
    <div class="card">
      <div class="card-title">Cosa cambia</div>
      ${_riga('Accessi', 'Gli account istituzionali (Google Workspace, Microsoft 365) sono stati disattivati.')}
      ${_riga('Abbonamento', 'L\'eventuale addebito ricorrente della quota &egrave; stato annullato.')}
      ${_riga('Quota versata', 'Non &egrave; previsto alcun rimborso della quota gi&agrave; versata (Art. 9.7 Statuto).')}
      ${_riga('Obblighi in corso', 'Restano da definire i rapporti giuridici assunti fino a oggi come associato (Art. 9.6).')}
    </div>
    <div class="card">
      <div class="card-title">Impugnazione — Art. 9.4 Statuto</div>
      ${_riga('A chi rivolgersi', '{{ORGANO_GARANZIA}}, competente sulle misure disciplinari.')}
      ${_riga('Riammissione', 'Possibile solo con giudizio del Collegio nazionale dei Probiviri.')}
      ${_riga('Come fare', 'Scrivi a '+CONFIG.EMAIL_MITTENTE+' con oggetto "Probiviri — ID '+idP+'" e ti indicheremo la procedura.')}
    </div>
    ${DISCLAIMER_SICUREZZA}`;

  inviaEmail_(dati.email, 'Delibera dell\'Assemblea dei Soci — '+CONFIG.NOME_GRUPPO,
    _htmlWrapper('Delibera dell\'Assemblea', contenuto, '#C00000'));
}

/**
 * Comunica la cessazione del rapporto per una causa diversa dall'espulsione:
 * decadenza (9.1.b), recesso (9.5), perdita della capacità di agire (9.1.a).
 * Ogni causa ha il suo incipit, perché sono fatti diversi: una decadenza si
 * accerta, un recesso si prende atto.
 */
function inviaEmailCessazione_(rowData, tipo, causa, dettaglio, dataStr) {
  const I    = CONFIG.IDX;
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[I.ID_PRATICA]||'N/D';
  const c    = CONFIG.CAUSE_CESSAZIONE[causa] || {};

  const incipit = {
    'Decadenza': `La Presidenza dell'<strong>${CONFIG.NOME_LEGALE}</strong> ha accertato la tua
      <strong>decadenza</strong> dalla qualifica di Socio per mancato pagamento della quota
      associativa annuale (Art. 9.1.b e 9.2 dello Statuto), con efficacia dal <strong>${dataStr}</strong>.`,
    'Recesso': `Abbiamo preso atto del tuo <strong>recesso</strong> dall'<strong>${CONFIG.NOME_LEGALE}</strong>,
      comunicato per iscritto al Presidente ai sensi dell'Art. 9.5 dello Statuto. Il rapporto
      associativo si &egrave; chiuso il <strong>${dataStr}</strong>.`,
    'Incapacita': `La Presidenza dell'<strong>${CONFIG.NOME_LEGALE}</strong> ha accertato la cessazione
      del rapporto associativo ai sensi dell'Art. 9.1.a dello Statuto, con efficacia dal
      <strong>${dataStr}</strong>.`,
  }[causa] || `Il rapporto associativo con l'<strong>${CONFIG.NOME_LEGALE}</strong> risulta cessato
      dal <strong>${dataStr}</strong>.`;

  const bloccoDettaglio = dettaglio
    ? `<div class="highlight-box">
         <div class="highlight-title">Nota</div>
         <div style="font-size:15px;color:#424245;line-height:1.6;margin-top:8px;">${dettaglio}</div>
       </div>`
    : '';

  const contenuto = `
    <div class="greeting">Gentile ${dati.nome} ${dati.cognome},</div>
    <div class="text">${incipit} (ID: <code>${idP}</code>)</div>
    ${bloccoDettaglio}
    <div class="card">
      <div class="card-title">Cosa cambia</div>
      ${_riga('Riferimento', (c.articolo||'Art. 9')+' dello Statuto')}
      ${_riga('Accessi', 'Gli account istituzionali (Google Workspace, Microsoft 365) sono stati disattivati.')}
      ${_riga('Abbonamento', 'L\'eventuale addebito ricorrente della quota &egrave; stato annullato.')}
      ${_riga('Quota versata', 'Non &egrave; previsto alcun rimborso della quota gi&agrave; versata (Art. 9.7 Statuto).')}
    </div>
    ${causa === 'Recesso' || causa === 'Decadenza'
      ? '<div class="info-note">Puoi presentare una nuova domanda di ammissione in qualsiasi momento: '+
        'scrivi a <a href="mailto:'+CONFIG.EMAIL_MITTENTE+'" style="color:'+CONFIG.COLORI.BLU+';">'+CONFIG.EMAIL_MITTENTE+'</a>.</div>'
      : ''}
    ${DISCLAIMER_SICUREZZA}`;

  inviaEmail_(dati.email, 'Comunicazione della Presidenza — '+CONFIG.NOME_GRUPPO,
    _htmlWrapper('Cessazione del rapporto associativo', contenuto, '#C00000'));
}

// ─────────────────────────────────────────────────────────────────────────────
// ERRORE VOLONTARIO — include TUTTI i dati del modulo
// ─────────────────────────────────────────────────────────────────────────────

function inviaEmailErroreVolontario_(rowData, tipoErrore, genitore) {
  const I    = CONFIG.IDX;
  const dati = getDatiAnagrafici_(rowData, 'Volontario');
  const idP  = rowData[I.ID_PRATICA]||'N/D';

  let motivo = '', soluzione = '';
  if (tipoErrore === 'GENITORE_NON_TROVATO') {
    motivo    = 'Non è stato possibile trovare un Socio Ordinario corrispondente ai dati di garanzia forniti nel modulo.';
    soluzione = `Verifica che il <strong>Codice Fiscale</strong> e l'<strong>ID Pratica</strong> del genitore/tutore siano corretti e corrispondano esattamente a quelli di un Socio Ordinario già iscritto.`;
  } else {
    const nomeGen = genitore ? genitore.nome+' '+genitore.cognome : 'Il genitore indicato';
    motivo    = 'Il genitore/tutore è presente nel database ma non risulta ancora un Socio Ordinario "in regola" — la sua domanda potrebbe non essere ancora stata approvata dalla Presidenza, oppure è stata approvata ma non ha ancora completato l\'iscrizione con il pagamento della quota.';
    soluzione = `<strong>${nomeGen}</strong> deve completare la propria iscrizione come Socio Ordinario (approvazione della Presidenza + pagamento della quota). La tua pratica verrà sbloccata automaticamente non appena il genitore avrà completato entrambi i passaggi con le stesse informazioni inserite nel tuo modulo.
    <br><br>In alternativa, puoi ripresentare la domanda in seguito, assicurandoti che il genitore sia già un Socio Ordinario approvato e in regola con il pagamento.`;
  }

  // Dati inseriti nel modulo (per verifica)
  const cfVolontario  = rowData[I.CF_VOLONTARIO]||'N/D';
  const emailVol      = rowData[I.EMAIL_VOLONTARIO]||'N/D';
  const cfGenitoreIns = rowData[I.CF_GENITORE]||'N/D';
  const idPraticaGen  = rowData[I.ID_PRATICA_GENITORE]||'N/D';
  const dataNasc      = formatData_(rowData[I.DATA_NASCITA_VOLONTARIO]);
  const dataInvio     = formatData_(rowData[I.DATA_INVIO]);

  const contenuto = `
    <div class="greeting">Attenzione ${dati.nome} ${dati.cognome},</div>
    <div class="text">La tua richiesta di ammissione come <strong>Volontario</strong>
      (ID Pratica: <code>${idP}</code>) ha incontrato un problema di validazione automatica.</div>
    <div class="alert-box">
      <div class="alert-title">⚠️ Motivo del blocco</div>
      <p class="alert-text">${motivo}</p>
    </div>
    <div class="info-note">${soluzione}</div>
    <div class="card">
      <div class="card-title">Dati che hai inserito nel modulo — verifica che siano corretti</div>
      ${_riga('Nome Volontario', dati.nome+' '+dati.cognome)}
      ${_riga('Codice Fiscale Volontario', '<code>'+cfVolontario+'</code>')}
      ${_riga('Data di Nascita', dataNasc)}
      ${_riga('Email', emailVol)}
      ${_riga('CF Genitore/Tutore inserito', '<code>'+cfGenitoreIns+'</code>')}
      ${_riga('ID Pratica Genitore inserito', '<code>'+idPraticaGen+'</code>')}
      ${_riga('Data invio modulo', dataInvio)}
    </div>
    <div class="info-note">Se uno dei dati sopra è errato, puoi ripresentare il modulo con i dati corretti,
      oppure contattarci a <a href="mailto:${CONFIG.EMAIL_MITTENTE}" style="color:${CONFIG.COLORI.BLU};">${CONFIG.EMAIL_MITTENTE}</a>
      allegando l'ID Pratica <code>${idP}</code>.
    </div>
    ${DISCLAIMER_SICUREZZA}`;

  inviaEmail_(dati.email, 'Verifica necessaria — richiesta Volontario',
    _htmlWrapper('Verifica necessaria', contenuto, '#C00000'));
}

// ─────────────────────────────────────────────────────────────────────────────
// FIRMA GMAIL — inviata a ENTRAMBE le email (personale e istituzionale)
// ─────────────────────────────────────────────────────────────────────────────

function inviaEmailFirmaGmail_(emailPersonale, emailIstituzionale, nome, cognome, telefono, ruolo) {
  const htmlFirma  = generaHtmlFirma_(nome, cognome, emailIstituzionale, telefono, ruolo);
  const supportUrl = 'https://support.google.com/mail/answer/8395?hl=it&co=GENIE.Platform%3DAndroid&oco=0';

  // Costruisce URL web app per il tasto "Copia firma" (con JS reale nel browser)
  let copiaFirmaUrl = '';
  try {
    const baseUrl = ScriptApp.getService().getUrl();
    if (baseUrl) {
      copiaFirmaUrl = baseUrl + '?' + [
        'nome='    + encodeURIComponent(nome),
        'cognome=' + encodeURIComponent(cognome),
        'email='   + encodeURIComponent(emailIstituzionale),
        'tel='     + encodeURIComponent(telefono || ''),
        'ruolo='   + encodeURIComponent(ruolo),
      ].join('&');
    }
  } catch(e) { traceLog_('[FirmaGmail] URL web app non disponibile: ' + e.message); }

  const bloccoCopia = copiaFirmaUrl
    ? _pulsante('📋&nbsp;Copia firma', copiaFirmaUrl, CONFIG.COLORI.BLU)
    : '';

  const contenuto = `
    <div class="greeting">Ciao ${nome} ${cognome},</div>
    <div class="text">Il tuo account Google Workspace {{NOME_GRUPPO}} è attivo. Segui questi passaggi
      per impostare la tua firma personalizzata in Gmail:</div>
    <div class="card">
      <div class="card-title">Come impostare la firma (5 minuti)</div>
      ${_riga('1.', 'Apri Gmail con il tuo account istituzionale: <code>'+emailIstituzionale+'</code>')}
      ${_riga('2.', 'Clicca ⚙️ in alto a destra → <strong>Visualizza tutte le impostazioni</strong>')}
      ${_riga('3.', 'Vai sulla scheda <strong>Generale</strong> → sezione <strong>Firma</strong>')}
      ${_riga('4.', 'Clicca <strong>Crea nuova firma</strong> → dai un nome, es. "{{NOME_GRUPPO}}"')}
      ${_riga('5.', 'Clicca sui tre puntini nell\'editor (⋮) → <strong>Modifica HTML</strong>')}
      ${_riga('6.', 'Cancella il contenuto esistente → <strong>clicca una volta nel box arancione qui sotto</strong> per selezionare tutto → copia (<kbd style="background:#eee;border:1px solid #ccc;border-radius:4px;padding:1px 5px;font-size:12px;">Ctrl+C</kbd> o <kbd style="background:#eee;border:1px solid #ccc;border-radius:4px;padding:1px 5px;font-size:12px;">Cmd+C</kbd>) → incolla nell\'editor HTML')}
      ${_riga('7.', 'Clicca <strong>OK</strong> → poi <strong>Salva modifiche</strong> in fondo alla pagina')}
    </div>

    <p style="font-size:11px;font-weight:700;color:#86868B;text-transform:uppercase;
              letter-spacing:1.2px;margin:28px 0 8px 0;">
      Clicca una volta nel box per selezionare tutta la firma
    </p>
    <div style="background-color:rgba(242,145,4,0.06);
                border:2px dashed ${CONFIG.COLORI.ARANCIO};
                border-radius:14px;
                padding:6px 24px 24px 24px;">
      <p style="font-size:10px;font-weight:700;color:${CONFIG.COLORI.ARANCIO};
                text-transform:uppercase;letter-spacing:1.5px;
                margin:0 0 16px 0;padding:10px 0;
                border-bottom:1px solid rgba(242,145,4,0.25);">
        Area da copiare
      </p>
      <div style="user-select:all;-webkit-user-select:all;-moz-user-select:all;-ms-user-select:all;cursor:text;">
        ${htmlFirma}
      </div>
    </div>

    ${bloccoCopia}

    <div class="info-note" style="margin-top:20px;">
      <strong>Guida ufficiale Google:</strong>&nbsp;
      <a href="${supportUrl}" style="color:${CONFIG.COLORI.BLU};font-weight:600;">
        Come impostare la firma in Gmail
      </a>
    </div>
    <div class="info-note">
      Hai problemi? Contattaci a
      <a href="mailto:${CONFIG.EMAIL_MITTENTE}" style="color:${CONFIG.COLORI.BLU};">${CONFIG.EMAIL_MITTENTE}</a>
    </div>`;

  const html    = _htmlWrapper('Imposta la tua firma Gmail', contenuto);
  const oggetto = 'Firma Gmail {{NOME_GRUPPO}} — istruzioni e anteprima';
  const stato   = { personale: '-', istituzionale: '-' };

  // Invia a email personale
  if (emailPersonale) {
    try {
      inviaEmail_(emailPersonale, oggetto, html);
      stato.personale = 'OK';
    } catch(err) {
      stato.personale = 'Errore';
      traceLog_('[FirmaGmail] WARN: non inviata a '+emailPersonale+': '+err.message);
    }
  }

  // Invia a email istituzionale
  if (emailIstituzionale) {
    try {
      inviaEmail_(emailIstituzionale, oggetto, html);
      stato.istituzionale = 'OK';
    } catch(err) {
      stato.istituzionale = 'Errore';
      traceLog_('[FirmaGmail] WARN: non inviata a '+emailIstituzionale+': '+err.message);
    }
  }

  return stato;
}

// ─────────────────────────────────────────────────────────────────────────────
// RIMBORSO
// ─────────────────────────────────────────────────────────────────────────────

function inviaEmailConfermaRimborso_(dati, idPratica, refund) {
  const importo = (refund.amount/100).toFixed(2);
  const valuta  = (refund.currency||'eur').toUpperCase();
  const contenuto = `
    <div class="greeting">Gentile ${dati.nome} ${dati.cognome},</div>
    <div class="text">Il rimborso della quota associativa versata è stato avviato.</div>
    <div class="card">
      <div class="card-title">Dettagli rimborso</div>
      ${_riga('Importo', importo+' '+valuta)}
      ${_riga('ID Pratica', '<code>'+idPratica+'</code>')}
      ${_riga('ID Rimborso Stripe', '<code>'+refund.id+'</code>')}
      ${_riga('Tempi accredito', '5–10 giorni lavorativi')}
    </div>
    ${DISCLAIMER_SICUREZZA}`;
  inviaEmail_(dati.email, 'Rimborso quota — '+idPratica, _htmlWrapper('Rimborso quota', contenuto));
}

function inviaEmailRimborsoManuale_(dati, idPratica, idTrans, motivo) {
  GmailApp.sendEmail(CONFIG.EMAIL_ADMIN_ERRORI,
    '⚠️ RIMBORSO MANUALE — Pratica '+idPratica,
    'Rimborso automatico non eseguito per '+dati.nome+' '+dati.cognome+' ('+dati.email+').\n\n'+
    'ID Pratica: '+idPratica+'\nID Transazione: '+(idTrans||'NON PRESENTE')+'\nMotivo: '+motivo+'\n\n'+
    'AZIONE: accedi a dashboard.stripe.com, cerca la transazione e emetti rimborso completo. '+
    'Poi invia conferma a '+dati.email,
    { bcc: CONFIG.EMAIL_TRANSITO_E_VERIFICA });
}

// ─────────────────────────────────────────────────────────────────────────────
// ANNULLAMENTO ABBONAMENTO
// ─────────────────────────────────────────────────────────────────────────────

function inviaEmailAnnullamentoAbbonamento_(rowData, tipo, idPratica, dataScadenzaStr) {
  const dati   = getDatiAnagrafici_(rowData, tipo);
  const gruppo = rowData[CONFIG.IDX.GRUPPO]||'N/D';
  const contenuto = `
    <div class="greeting">Ciao ${dati.nome} ${dati.cognome},</div>
    <div class="text">Abbiamo registrato la cancellazione del tuo abbonamento.</div>
    <div class="highlight-box">
      <div class="highlight-title">Rimani membro fino al</div>
      <div class="highlight-value">${dataScadenzaStr}</div>
    </div>
    <div class="card">
      <div class="card-title">Cosa cambia</div>
      ${_riga('Fino al '+dataScadenzaStr, 'Sei ancora Membro ufficiale a pieno titolo.')}
      ${_riga('Dopo la scadenza', 'Senza rinnovo si decade dalla qualifica di Socio: la decadenza è accertata dalla Presidenza (Art. 9.1.b e 9.2 dello Statuto).')}
      ${_riga('Rinnovo automatico', 'Disattivato. Nessun addebito al prossimo rinnovo.')}
    </div>
    <div class="info-note">
      Hai cambiato idea? Puoi riattivare entro il ${dataScadenzaStr} contattando
      <a href="mailto:${CONFIG.EMAIL_MITTENTE}" style="color:${CONFIG.COLORI.BLU};">${CONFIG.EMAIL_MITTENTE}</a>
    </div>
    <div class="info-note">⚠️ Se sei genitore di un Volontario, anche la sua posizione potrebbe essere interessata.</div>
    ${DISCLAIMER_SICUREZZA}`;
  inviaEmail_(dati.email, 'Cancellazione abbonamento — '+CONFIG.NOME_GRUPPO, _htmlWrapper('Cancellazione abbonamento', contenuto));
}

function inviaEmailVolontarioGenitoreAnnullato_(datiVol, idPratica, nomeGenitore, dataScadenzaStr) {
  const contenuto = `
    <div class="greeting">Ciao ${datiVol.nome} ${datiVol.cognome},</div>
    <div class="text">Il tuo genitore/tutore <strong>${nomeGenitore}</strong> ha cancellato
      il proprio abbonamento all'<strong>${CONFIG.NOME_LEGALE}</strong>.</div>
    <div class="highlight-box">
      <div class="highlight-title">Sei ancora membro fino al</div>
      <div class="highlight-value">${dataScadenzaStr}</div>
    </div>
    <div class="info-note">Dopo questa data la Presidenza riesaminerà la tua posizione, perché la tua
      iscrizione come Volontario è collegata a quella del tuo genitore/tutore.
      Contattaci per chiarimenti: <a href="mailto:${CONFIG.EMAIL_MITTENTE}" style="color:${CONFIG.COLORI.BLU};">${CONFIG.EMAIL_MITTENTE}</a>
    </div>
    ${DISCLAIMER_SICUREZZA}`;
  inviaEmail_(datiVol.email, 'Informazione sulla tua iscrizione — '+CONFIG.NOME_GRUPPO, _htmlWrapper('Informazione iscrizione', contenuto));
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGAMENTO FALLITO / RINNOVO CONFERMATO
// ─────────────────────────────────────────────────────────────────────────────

function inviaEmailPagamentoFallito_(dati, idPratica, dataScadenzaStr) {
  const contenuto = `
    <div class="greeting">Ciao ${dati.nome} ${dati.cognome},</div>
    <div class="text">Il pagamento automatico del rinnovo della tua quota non è andato a buon fine.</div>
    <div class="alert-box">
      <div class="alert-title">⚠️ Pagamento non riuscito</div>
      <p class="alert-text">La quota è valida fino al <strong>${dataScadenzaStr}</strong>.
        Regolarizza entro tale data per evitare la decadenza.<br><br>
        Contattaci: <a href="mailto:${CONFIG.EMAIL_MITTENTE}" style="color:#8F0000;">${CONFIG.EMAIL_MITTENTE}</a></p>
    </div>
    ${DISCLAIMER_SICUREZZA}`;
  inviaEmail_(dati.email, 'Problema rinnovo abbonamento — '+CONFIG.NOME_GRUPPO,
    _htmlWrapper('Pagamento non riuscito', contenuto, '#B06500'));
}

function inviaEmailConfermaRinnovo_(rowData, nuovaScadenza) {
  const I    = CONFIG.IDX;
  const tipo = rowData[I.TIPO_ASSOCIATO];
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[I.ID_PRATICA]||'N/D';
  const scad = formatData_(nuovaScadenza);
  const contenuto = `
    <div class="greeting">Ciao ${dati.nome} ${dati.cognome},</div>
    <div class="text">Il tuo abbonamento è stato rinnovato con successo.</div>
    <div class="highlight-box">
      <div class="highlight-title">Quota valida fino al</div>
      <div class="highlight-value">${scad}</div>
    </div>
    <div class="card">
      ${_riga('ID Pratica', '<code>'+idP+'</code>')}
      ${_riga('Importo addebitato', (CONFIG.STRIPE.QUOTA_CENTESIMI/100).toFixed(2)+' EUR')}
      ${_riga('Nuova scadenza', scad)}
    </div>
    <div class="info-note">Grazie per aver rinnovato! Ci vediamo alle prove 🎵</div>
    ${DISCLAIMER_SICUREZZA}`;
  inviaEmail_(dati.email, 'Rinnovo confermato — '+CONFIG.NOME_GRUPPO, _htmlWrapper('Rinnovo confermato', contenuto));
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOCONTO WORKSPACE — inviato all'amministrazione durante onboarding
// ─────────────────────────────────────────────────────────────────────────────

function inviaEmailResocontoWorkspace_(rowData, row, emailIst, gruppo, esito) {
  esito = esito || {};
  const I    = CONFIG.IDX;
  const tipo = rowData[I.TIPO_ASSOCIATO];
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[I.ID_PRATICA] || 'N/D';

  let stato = 'Account Google Workspace gestito';
  if (esito.creato) stato = 'Account Google Workspace creato';
  else if (esito.esistente) stato = 'Account Google Workspace già esistente';
  else if (esito.ok === false) stato = 'Account Google Workspace con errore';

  const azionePassword = esito.passwordTemporanea
    ? 'Password temporanea generata e comunicabile al membro.'
    : 'Password non modificata. L’utente deve usare la password già esistente o richiedere reset manuale.';

  const gruppoStato = esito.gruppoAggiunto
    ? 'Aggiunto al gruppo.'
    : (esito.giaNelGruppo ? 'Era già membro del gruppo.' : 'Da verificare.');

  const contenuto = `
    <div class="greeting">${stato}</div>
    <div class="text">Resoconto automatico della fase Google Workspace per la riga <strong>#${row}</strong>.</div>
    <div class="card">
      <div class="card-title">Pratica</div>
      ${_riga('ID Pratica', '<code>'+idP+'</code>')}
      ${_riga('Membro', dati.nome+' '+dati.cognome)}
      ${_riga('Tipo', tipo)}
      ${_riga('Email istituzionale', '<code>'+emailIst+'</code>')}
      ${_riga('Gruppo richiesto', gruppo || 'N/D')}
      ${_riga('Google Group', esito.gruppoEmail || 'N/D')}
    </div>
    <div class="card">
      <div class="card-title">Azioni eseguite</div>
      ${_riga('Utente nuovo', esito.creato ? 'SI' : 'NO')}
      ${_riga('Utente già esistente', esito.esistente ? 'SI' : 'NO')}
      ${_riga('Password', azionePassword)}
      ${_riga('Profilo/telefono', esito.profiloAggiornato ? 'Aggiornato' : 'Nessun aggiornamento o non necessario')}
      ${_riga('Gruppo', gruppoStato)}
    </div>
    ${esito.warning
      ? '<div class="alert-box"><div class="alert-title">Avviso</div><p class="alert-text">'+_htmlEscape(esito.warning)+'</p></div>'
      : ''}
    <div class="info-note">Questo resoconto è interno e serve a verificare che l’onboarding non abbia reimpostato password già esistenti.</div>`;

  const html = _htmlWrapper('Resoconto Google Workspace', contenuto, esito.ok === false ? '#C00000' : CONFIG.COLORI.BLU);
  GmailApp.sendEmail(
    CONFIG.EMAIL_TRANSITO_E_VERIFICA,
    '[{{NOME_GRUPPO}} Workspace] '+dati.nome+' '+dati.cognome+' — '+stato,
    '',
    { htmlBody: html, name: CONFIG.NOME_GRUPPO }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RIEPILOGO WORKFLOW — inviato a {{EMAIL_TRANSITO_E_VERIFICA}} al termine onboarding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Email di riepilogo completo del workflow onboarding.
 * Inviata direttamente a CONFIG.EMAIL_TRANSITO_E_VERIFICA (non tramite inviaEmail_ per evitare BCC ricorsivo).
 *
 * @param {Array}  rowData  - Dati riga foglio (già letti)
 * @param {number} rigaNum  - Numero riga nel foglio
 * @param {Object} r        - Risultati accumulati:
 *   { emailIst, pwd, wsOk, m365Ok, tesseraOk, tesseraUrl,
 *     firmaPersonale, firmaIstituzionale, benvenutoOk,
 *     genitoreOk, firmaGenitoreOk, emailGenitore, errori[] }
 */
function inviaEmailRiepilogoWorkflow_(rowData, rigaNum, r) {
  const I    = CONFIG.IDX;
  const tipo = rowData[I.TIPO_ASSOCIATO];
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = rowData[I.ID_PRATICA] || 'N/D';
  const gruppo     = rowData[I.GRUPPO] || 'N/D';
  const ora        = Utilities.formatDate(new Date(), 'Europe/Rome', "dd/MM/yyyy 'alle' HH:mm:ss");

  // ── Status globale ────────────────────────────────────────────────────────
  const haErrori   = r.errori && r.errori.length > 0;
  const benvenutoOk= r.benvenutoOk === true;
  const genitoreOk = tipo !== 'Volontario' || r.genitoreOk === true;
  const tuttoOk    = benvenutoOk && genitoreOk && r.wsOk !== false && !haErrori;
  const headerColor= tuttoOk ? '#34C759' : (haErrori ? '#FF3B30' : '#FF9500');
  const titoloStato= tuttoOk ? '✅ Onboarding completato' : (haErrori ? '❌ Onboarding con errori' : '⚠️ Onboarding con avvisi');
  const sottotitolo= dati.nome + ' ' + dati.cognome + ' — ' + tipo;

  // ── Helper badge ─────────────────────────────────────────────────────────
  function badge(v) {
    const base = 'display:inline-block;padding:2px 10px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:0.3px;';
    if (v === true  || v === 'OK')     return '<span style="'+base+'background:#34C759;color:#fff;">✓ OK</span>';
    if (v === false || v === 'Errore') return '<span style="'+base+'background:#FF3B30;color:#fff;">✗ Errore</span>';
    if (!v || v === '-')               return '<span style="'+base+'background:#8E8E93;color:#fff;">— N/A</span>';
    return '<span style="'+base+'background:#FF9500;color:#fff;">⚠ '+String(v)+'</span>';
  }

  // ── Dati anagrafici completi ──────────────────────────────────────────────
  let anagrafica;
  if (tipo === 'Socio Ordinario') {
    anagrafica =
      _riga('Tipo',              tipo) +
      _riga('Nome',              dati.nome + ' ' + dati.cognome) +
      _riga('Codice Fiscale',    rowData[I.CF_SOCIO]  || 'N/D') +
      _riga('Data di nascita',   formatData_(rowData[I.DATA_NASCITA_SOCIO])) +
      _riga('Email personale',   rowData[I.EMAIL_SOCIO] || 'N/D') +
      _riga('Telefono',          rowData[I.TEL_SOCIO]  || 'N/D') +
      _riga('Stato pagamento',   rowData[I.STATO_PAGAMENTO] || 'N/D');
  } else {
    anagrafica =
      _riga('Tipo',                 tipo) +
      _riga('Nome Volontario',      dati.nome + ' ' + dati.cognome) +
      _riga('Codice Fiscale Vol.',  rowData[I.CF_VOLONTARIO] || 'N/D') +
      _riga('Data di nascita',      formatData_(rowData[I.DATA_NASCITA_VOLONTARIO])) +
      _riga('Sesso',                rowData[I.SESSO_VOLONTARIO] || 'N/D') +
      _riga('Email Volontario',     rowData[I.EMAIL_VOLONTARIO] || 'N/D') +
      _riga('Telefono',             rowData[I.TEL_VOLONTARIO]  || 'N/D') +
      _riga('CF Genitore',          rowData[I.CF_GENITORE] || 'N/D') +
      _riga('ID Pratica Genitore',  rowData[I.ID_PRATICA_GENITORE] || 'N/D') +
      _riga('Email Genitore',       r.emailGenitore || '<span style="color:#FF3B30;font-weight:700;">Non trovata</span>');
  }
  anagrafica +=
    _riga('Gruppo',           gruppo) +
    _riga('Ruolo associativo',rowData[I.RUOLO_ASSOCIATIVO] || '(da gruppo)') +
    _riga('ID Pratica',       '<code>' + idP + '</code>') +
    _riga('ID Submission',    rowData[I.SUBMISSION_ID] || 'N/D') +
    _riga('Riga nel foglio',  '<strong>#' + rigaNum + '</strong>') +
    _riga('Data ammissione',  formatData_(rowData[I.DATA_AMMISSIONE])) +
    _riga('Scadenza quota',   formatData_(rowData[I.DATA_SCADENZA_QUOTA]));

  // ── Credenziali create ────────────────────────────────────────────────────
  const bloccoCredenziali = `
    <div class="card">
      <div class="card-title">Credenziali create per questo onboarding</div>
      ${_riga('Email istituzionale',  '<code>' + (r.emailIst || 'N/D') + '</code>')}
      ${_riga('Password temporanea',  r.pwd ? 'Generata e comunicata solo nelle email operative al membro/genitore.' : 'N/D')}
    </div>`;

  // ── Riepilogo step workflow ────────────────────────────────────────────────
  const stepWorkflow = `
    <div class="card">
      <div class="card-title">Passaggi eseguiti — esito</div>
      ${_riga('1. Email istituzionale',             badge(!!r.emailIst))}
      ${_riga('2. Google Workspace',                badge(r.wsOk))}
      ${_riga('3. Microsoft 365',                   badge(r.m365Ok))}
      ${_riga('4. Tessera PDF generata',            badge(r.tesseraOk))}
      ${_riga('5. Membro Ufficiale = SI',           badge(true))}
      ${_riga('6. Email benvenuto al membro',       badge(r.benvenutoOk))}
      ${_riga('7. Firma Gmail (email personale)',   badge(r.firmaPersonale))}
      ${_riga('8. Firma Gmail (email istituz.)',    badge(r.firmaIstituzionale))}
      ${tipo === 'Volontario'
        ? _riga('9. Email benvenuto al genitore',  badge(r.genitoreOk)) +
          _riga('10. Firma Gmail al genitore',      badge(r.firmaGenitoreOk))
        : ''}
    </div>`;

  // ── Dettaglio email inviate ────────────────────────────────────────────────
  const emailInviate = [];
  const emailPersonale = tipo === 'Socio Ordinario' ? rowData[I.EMAIL_SOCIO] : rowData[I.EMAIL_VOLONTARIO];
  if (r.benvenutoOk !== null)
    emailInviate.push(_riga('Benvenuto → ' + (emailPersonale||'N/D'), badge(r.benvenutoOk)));
  if (r.firmaPersonale !== '-')
    emailInviate.push(_riga('Firma → ' + (emailPersonale||'N/D'), badge(r.firmaPersonale)));
  if (r.firmaIstituzionale !== '-')
    emailInviate.push(_riga('Firma → ' + (r.emailIst||'N/D'), badge(r.firmaIstituzionale)));
  if (tipo === 'Volontario') {
    if (r.genitoreOk !== null)
      emailInviate.push(_riga('Benvenuto genitore → ' + (r.emailGenitore||'N/D'), badge(r.genitoreOk)));
    if (r.firmaGenitoreOk && r.firmaGenitoreOk !== '-')
      emailInviate.push(_riga('Firma genitore → ' + (r.emailGenitore||'N/D'), badge(r.firmaGenitoreOk)));
  }
  const bloccoEmail = emailInviate.length
    ? `<div class="card"><div class="card-title">Email inviate</div>${emailInviate.join('')}</div>`
    : '';

  // ── Tessera su Drive ──────────────────────────────────────────────────────
  const bloccoTessera = r.tesseraUrl
    ? `<div class="info-note">
        <strong>Tessera su Drive:</strong>&nbsp;
        <a href="${r.tesseraUrl}" style="color:${CONFIG.COLORI.BLU};font-weight:600;">Apri PDF</a>
       </div>`
    : '';

  // ── Errori ────────────────────────────────────────────────────────────────
  const bloccoErrori = (r.errori && r.errori.length)
    ? `<div class="alert-box">
        <div class="alert-title">Errori rilevati (${r.errori.length})</div>
        ${r.errori.map(e => '<p class="alert-text" style="margin:6px 0;font-family:monospace;font-size:12px;">'
          + _htmlEscape(String(e)) + '</p>').join('')}
       </div>`
    : '';

  // ── Link al foglio ────────────────────────────────────────────────────────
  const linkFoglio = CONFIG.LINK_FOGLIO_FISSO
    ? _pulsante('Apri foglio associati', CONFIG.LINK_FOGLIO_FISSO, CONFIG.COLORI.BLU)
    : '';

  // ── Composizione contenuto ────────────────────────────────────────────────
  const contenuto = `
    <div class="greeting">${titoloStato}</div>
    <div class="text">
      Riepilogo automatico onboarding completato il <strong>${ora}</strong>.<br>
      Membro: <strong>${dati.nome} ${dati.cognome}</strong> &bull; ${tipo} &bull; ID <code>${idP}</code>
    </div>
    ${bloccoErrori}
    <div class="card">
      <div class="card-title">Dati anagrafici</div>
      ${anagrafica}
    </div>
    ${bloccoCredenziali}
    ${stepWorkflow}
    ${bloccoEmail}
    ${bloccoTessera}
    ${linkFoglio}
    <div class="info-note" style="font-size:11px;color:#86868B;">
      Questo messaggio è generato automaticamente dal sistema gestionale {{NOME_GRUPPO}} v8.
      Non rispondere a questa email.
    </div>`;

  const html    = _htmlWrapper(titoloStato, contenuto, headerColor, CONFIG.COLORI.ARANCIO);
  const oggetto = '[{{NOME_GRUPPO}} Workflow] ' + dati.nome + ' ' + dati.cognome + ' — ' + titoloStato;

  // Invia direttamente (non tramite inviaEmail_ per evitare BCC ricorsivo su se stesso)
  try {
    GmailApp.sendEmail(CONFIG.EMAIL_TRANSITO_E_VERIFICA, oggetto, '', { htmlBody: html, name: CONFIG.NOME_GRUPPO });
    traceLog_('[Workflow] ✅ Riepilogo inviato a ' + CONFIG.EMAIL_TRANSITO_E_VERIFICA + ' per riga ' + rigaNum);
  } catch(err) {
    traceLog_('[Workflow] ❌ Errore invio riepilogo riga ' + rigaNum + ': ' + err.message);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// LIBERATORIA IMMAGINI, VIDEO, AUDIO ED ESECUZIONE (22_LiberatoriaWebApp.gs)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Invito a firmare la liberatoria.
 *
 * Il tono è quello di una richiesta, non di un adempimento: la risposta è
 * libera e va detto in chiaro nella prima riga, perché un consenso che il
 * destinatario percepisce come obbligatorio è un consenso che non regge
 * (art. 7 par. 4 GDPR). Per i Volontari l'email va al genitore firmatario:
 * le credenziali e i consensi di un minorenne non viaggiano mai solo verso lui.
 */
function inviaEmailLiberatoriaInvito_(rowData, tipo, token, contesto) {
  const I    = CONFIG.IDX;
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP  = String(rowData[I.ID_PRATICA] || '').trim();
  const link = libUrlFirma_(token);
  const volontario = (tipo === 'Volontario');

  // Per i Volontari il destinatario è chi ha firmato la domanda, che sta nelle
  // colonne del Socio (vedi CLAUDE.md §3): è il genitore, non il ragazzo.
  const destinatario = volontario
    ? String(rowData[I.EMAIL_SOCIO] || dati.email || '').trim()
    : dati.email;
  const nomeDest = volontario
    ? String(rowData[I.NOME_SOCIO] || '').trim()
    : dati.nome;
  const nomeMinore = volontario
    ? (String(rowData[I.NOME_VOLONTARIO] || '').trim() + ' ' + String(rowData[I.COGNOME_VOLONTARIO] || '').trim()).trim()
    : '';

  const contenuto = `
    <div class="greeting">Ciao ${nomeDest || ''},</div>
    <div class="text">Ci manca una cosa sola, e non è un pagamento: sapere se possiamo
      fotografare, riprendere e registrare ${volontario ? '<strong>' + nomeMinore + '</strong>' : 'te'}
      durante concerti, campus e prove, e quali di questi materiali possiamo pubblicare.</div>
    <div class="text"><strong>Puoi dire no a tutto.</strong> La scelta non incide sull'ammissione,
      sulla quota, sulla partecipazione ai concerti né su nessun altro diritto associativo, e si
      può cambiare in qualsiasi momento. Quello che ci serve è una risposta, qualunque sia.</div>
    <div class="card">
      <div class="card-title">La tua pratica</div>
      ${_riga('ID Pratica', '<code>'+idP+'</code>')}
      ${_riga('Tipo di associato', tipo)}
      ${volontario ? _riga('Giovane musicista', nomeMinore) : ''}
    </div>
    <div class="highlight-box">
      <div class="highlight-title">Rispondi alla richiesta</div>
      <p style="font-size:14px;color:#424245;line-height:1.6;margin:0 0 16px 0;">
        Il collegamento qui sotto è personale e vale ${30} giorni. Si legge il testo,
        si sceglie canale per canale e si firma con il dito o con il mouse.
      </p>
      ${_pulsante('Apri la richiesta &rarr;', link, CONFIG.COLORI.ARANCIO)}
    </div>
    ${volontario ? `<div class="info-note">
      <strong>Servono le firme di entrambi i genitori.</strong> Per un minorenne il consenso lo
      danno i titolari della responsabilità genitoriale (Statuto Art. 8.7, art. 316 c.c.): dopo la
      tua firma indicherai nome, email e codice fiscale dell'altro genitore, che riceverà un
      collegamento suo. Se eserciti da solo la responsabilità genitoriale potrai dichiararlo e
      firmare da solo. Per rifiutare, invece, basta la tua firma.
    </div>` : ''}
    <div class="info-note">
      Non inoltrare questo collegamento: vale come firma. Se pensi che sia arrivato alla persona
      sbagliata, scrivici a ${CONFIG.EMAIL_MITTENTE} e lo annulliamo.
    </div>
    ${DISCLAIMER_SICUREZZA}`;

  inviaEmail_(destinatario,
    'Foto, video e registrazioni: ci serve la tua risposta — ' + CONFIG.NOME_GRUPPO,
    _htmlWrapper('Una richiesta, non un obbligo', contenuto, CONFIG.COLORI.BLU, CONFIG.COLORI.ARANCIO));
  traceLog_('[Liberatoria] Invito inviato a ' + destinatario + ' per ' + idP + ' (' + (contesto || '') + ').');
}

/**
 * Invito al secondo genitore.
 *
 * Il collegamento arriva a un indirizzo indicato dal primo genitore: per questo
 * chi apre deve identificarsi digitando il proprio codice fiscale, che è il solo
 * elemento che il primo non può fornire al posto suo. Il messaggio non contiene
 * dati del minore oltre al nome: se l'indirizzo fosse sbagliato, un estraneo non
 * verrebbe a sapere nulla di più.
 */
function inviaEmailLiberatoriaSecondoGenitore_(rowData, tipo, secondoGenitore, token, nomePrimoGenitore) {
  const I = CONFIG.IDX;
  const idP = String(rowData[I.ID_PRATICA] || '').trim();
  const nomeMinore = (String(rowData[I.NOME_VOLONTARIO] || '').trim() + ' ' +
                      String(rowData[I.COGNOME_VOLONTARIO] || '').trim()).trim();
  const link = libUrlFirma_(token);

  const contenuto = `
    <div class="greeting">Gentile ${secondoGenitore.nome},</div>
    <div class="text">${nomePrimoGenitore} ha autorizzato l'<strong>${CONFIG.NOME_LEGALE}</strong>
      a fotografare, riprendere e registrare <strong>${nomeMinore}</strong> durante le attività
      dell'Associazione, e ha indicato te come altro genitore o tutore.</div>
    <div class="text">Per un minorenne il consenso lo danno <strong>entrambi</strong> i titolari
      della responsabilità genitoriale: finché manca la tua firma l'autorizzazione non è valida e
      nulla viene pubblicato. <strong>Puoi anche dire no</strong>, e in quel caso la richiesta si
      chiude come rifiutata, senza alcuna conseguenza per ${nomeMinore.split(' ')[0] || 'il ragazzo'}.</div>
    <div class="highlight-box">
      <div class="highlight-title">La tua firma</div>
      <p style="font-size:14px;color:#424245;line-height:1.6;margin:0 0 16px 0;">
        Aprendo il collegamento ti verrà chiesto il <strong>tuo codice fiscale</strong>: serve a
        verificare che sia tu e non chi ti ha inoltrato il messaggio.
      </p>
      ${_pulsante('Leggi e firma &rarr;', link, CONFIG.COLORI.ARANCIO)}
    </div>
    <div class="info-note">
      Se non riconosci questa richiesta, o se pensi di averla ricevuta per errore, scrivici a
      ${CONFIG.EMAIL_MITTENTE}: annulliamo il collegamento e non procediamo.
      Riferimento della pratica: <code>${idP}</code>.
    </div>
    ${DISCLAIMER_SICUREZZA}`;

  inviaEmail_(secondoGenitore.email,
    'Serve anche la tua firma — autorizzazione immagini di ' + nomeMinore,
    _htmlWrapper('Consenso di entrambi i genitori', contenuto, CONFIG.COLORI.BLU, CONFIG.COLORI.ARANCIO));
  traceLog_('[Liberatoria] Invito al secondo genitore inviato per ' + idP + '.');
}

/**
 * Conferma di che cosa è stato registrato. Non è una formalità: è la copia che
 * resta all'interessato, e insieme al PDF è ciò che gli permette di accorgersi
 * se qualcuno ha firmato al posto suo.
 */
function inviaEmailLiberatoriaEsito_(rowData, tipo, stato, canali, versione, pdfUrl) {
  const I = CONFIG.IDX;
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP = String(rowData[I.ID_PRATICA] || '').trim();
  const volontario = (tipo === 'Volontario');
  const destinatario = volontario
    ? String(rowData[I.EMAIL_SOCIO] || dati.email || '').trim()
    : dati.email;
  if (!destinatario) return;

  const righeCanali = LIB_CANALI_.map(function(c) {
    return _riga(c.etichetta, canali[c.chiave] ? 'Autorizzato' : 'Non autorizzato');
  }).join('');

  const inAttesa = (stato === 'In attesa 2° genitore');
  const contenuto = `
    <div class="greeting">Ciao ${volontario ? String(rowData[I.NOME_SOCIO]||'') : dati.nome},</div>
    <div class="text">Abbiamo registrato la risposta sulla richiesta relativa a foto, video,
      registrazioni audio ed esecuzione musicale. Questa email è la tua copia.</div>
    <div class="card">
      <div class="card-title">Che cosa risulta</div>
      ${_riga('ID Pratica', '<code>'+idP+'</code>')}
      ${_riga('Stato', stato)}
      ${_riga('Versione del testo firmato', versione)}
      ${righeCanali}
    </div>
    ${inAttesa ? `<div class="info-note">
      <strong>Manca la firma dell'altro genitore.</strong> Gli abbiamo scritto: finché non firma,
      l'autorizzazione non è valida e non pubblichiamo nulla.
    </div>` : ''}
    ${pdfUrl ? `<div class="highlight-box">
      <div class="highlight-title">Il documento firmato</div>
      ${_pulsante('Apri il PDF &rarr;', pdfUrl, CONFIG.COLORI.BLU)}
    </div>` : ''}
    <div class="info-note">
      Puoi cambiare idea quando vuoi, in tutto o su un singolo canale, scrivendo a
      ${CONFIG.EMAIL_MITTENTE} oppure a {{EMAIL_PRIVACY}}. La revoca vale per il futuro:
      rimuoviamo il materiale dai nostri canali entro trenta giorni, ma non possiamo ritirare copie
      già scaricate o ricondivise da terzi.
    </div>
    ${DISCLAIMER_SICUREZZA}`;

  inviaEmail_(destinatario,
    'Risposta registrata — foto, video e registrazioni — ' + CONFIG.NOME_GRUPPO,
    _htmlWrapper('Risposta registrata', contenuto, '#34C759', CONFIG.COLORI.BLU));
}

/**
 * L'avviso dedicato alla Presidenza: dice quale pratica è ferma e perché, con
 * il collegamento alla scheda. Va alla casella della Presidenza, non all'admin
 * degli errori: non è un errore tecnico, è una pratica che aspetta una persona.
 */
function inviaEmailLiberatoriaPresidenza_(rowData, tipo, contesto) {
  const I = CONFIG.IDX;
  const dati = getDatiAnagrafici_(rowData, tipo);
  const idP = String(rowData[I.ID_PRATICA] || '').trim();
  const st = statoLiberatoria_(rowData);

  const contenuto = `
    <div class="greeting">Ciao Presidenza,</div>
    <div class="text">Una pratica è in attesa della <strong>liberatoria immagini, video e audio</strong>.
      Finché non arriva una risposta — anche negativa — il pagamento della quota non può essere
      avviato e l'onboarding resta fermo.</div>
    <div class="card">
      <div class="card-title">La pratica</div>
      ${_riga('ID Pratica', '<code>'+idP+'</code>')}
      ${_riga('Nome', (dati.nome||'') + ' ' + (dati.cognome||''))}
      ${_riga('Tipo', tipo)}
      ${_riga('Stato liberatoria', st.stato)}
      ${_riga('Rilevato', contesto || 'ammissione')}
    </div>
    <div class="highlight-box">
      <div class="highlight-title">Che cosa fare</div>
      <p style="font-size:14px;color:#424245;line-height:1.6;margin:0 0 16px 0;">
        L'invito è già partito verso l'interessato. Se serve rimandarlo, dall'editor Apps Script:
        <code>liberatoriaCreaLinkPerPratica('${idP}')</code>. Il link vecchio viene annullato.
      </p>
      ${_pulsante('Apri in Presidenza &rarr;', getLinkPresidenza_(idP), CONFIG.COLORI.BLU)}
    </div>
    <div class="info-note">
      Ricorda: una risposta negativa è una risposta valida e sblocca il pagamento. Non si chiede a
      nessuno di acconsentire per potersi iscrivere — vedi Statuto Artt. 6.2 e 8.1.
    </div>`;

  inviaEmail_(CONFIG.WORKSPACE_GROUPS['Presidenza'],
    '[Liberatoria] ' + (dati.nome||'') + ' ' + (dati.cognome||'') + ' — in attesa di risposta',
    _htmlWrapper('Liberatoria in attesa', contenuto, CONFIG.COLORI.BLU, CONFIG.COLORI.ARANCIO));
}

/**
 * Card su Chat con chi non ha risposto oltre la scadenza della quota.
 * Non blocca e non sanziona: elenca. La decisione è della Presidenza.
 */
function inviaNotificaLiberatoriaScadute_(elenco) {
  const url = CONFIG.CHAT_WEBHOOK_URL_CONFERME;
  if (!webhookChatValido_(url)) return;

  const righe = elenco.slice(0, 20).map(function(x) { return '• ' + x; }).join('<br>');
  const extra = elenco.length > 20 ? '<br><i>e altri ' + (elenco.length - 20) + '</i>' : '';

  inviaPayloadChat_(url, {
    cardsV2: [{
      cardId: 'liberatoria-scadute-' + Date.now(),
      card: {
        header: {
          title: 'Liberatoria senza risposta',
          subtitle: elenco.length + ' Membri oltre la scadenza della quota',
          imageUrl: CONFIG.LOGO_URL,
          imageType: 'CIRCLE',
        },
        sections: [{
          widgets: [
            { decoratedText: { topLabel: 'Chi non ha ancora risposto', text: righe + extra, wrapText: true } },
            { decoratedText: { topLabel: 'Nota', wrapText: true,
              text: 'Il rinnovo non viene bloccato: fermarlo richiederebbe di cancellare ' +
                    'l\'abbonamento, con le email di annullamento al socio e ai Volontari collegati. ' +
                    'Se serve un provvedimento, lo decide la Presidenza.' } },
          ],
        }],
      },
    }],
  }, 'Liberatorie senza risposta');
}
