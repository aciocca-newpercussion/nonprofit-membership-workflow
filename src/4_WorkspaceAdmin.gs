/**
 * MODULO: 4_WorkspaceAdmin.gs
 * ══════════════════════════════════════════════════════════════════════
 * Creazione utenti Google Workspace, Microsoft 365 e Google Contacts.
 *
 * PREREQUISITI GOOGLE WORKSPACE:
 *  - Extensions > Advanced Services > Admin SDK Directory API: ON
 *  - Extensions > Advanced Services > People API (Google Contacts): ON
 *    (serve per aggiornare il numero di telefono nel profilo)
 *  - L'account che esegue lo script deve essere Super Admin del dominio
 *  - Crea i 3 Google Groups in Admin Console PRIMA del deploy:
 *      {{GROUP_PRESIDENZA}}
 *      {{GROUP_SOCI}}
 *      {{GROUP_VOLONTARI}}
 *
 * COME FUNZIONA L'INTEGRAZIONE GOOGLE CONTACTS:
 *  Quando un utente viene creato in Workspace, appare automaticamente nella
 *  Directory del dominio (visibile in contacts.google.com > "Directory").
 *  Per aggiungere il numero di telefono, lo script aggiorna il profilo utente
 *  tramite Admin SDK (phones field) subito dopo la creazione.
 *  Il numero sarà visibile a tutti i membri del dominio in Google Contacts.
 *
 * PREREQUISITI MICROSOFT 365:
 *  - Registra app in Azure AD con permessi User.ReadWrite.All e Directory.ReadWrite.All
 *  - Vedi documento Word per istruzioni dettagliate
 */

// ═════════════════════════════════════════════════════════════════════════════
// GOOGLE WORKSPACE + CONTACTS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Crea l'utente Workspace, imposta il numero di telefono nel profilo,
 * e aggiunge l'utente al Google Group corretto.
 *
 * @param {string} email        Email istituzionale
 * @param {string} nome
 * @param {string} cognome
 * @param {string} passwordTemp Password temporanea in chiaro
 * @param {string} gruppo       Valore della colonna "Gruppo" nel foglio
 * @param {string} telefono     Numero di telefono (opzionale)
 * @param {string} tipo         Tipo associato ("Socio Ordinario" | "Volontario") — usato come job title
 */
function creaUtenteWorkspace_(email, nome, cognome, passwordTemp, gruppo, telefono, tipo) {
  traceLog_(`[Workspace] Creazione utente: ${email}`);
  const esito = {
    ok:true,
    creato:false,
    esistente:false,
    passwordTemporanea:false,
    profiloAggiornato:false,
    gruppoEmail:'',
    gruppoAggiunto:false,
    giaNelGruppo:false,
    warning:'',
  };

  // Struttura base dell'utente
  const userRes = {
    primaryEmail: email,
    name: { givenName: nome, familyName: cognome, fullName: `${nome} ${cognome}` },
    password: calcolaHashMD5_(passwordTemp),
    hashFunction: 'MD5',
    changePasswordAtNextLogin: true,
    orgUnitPath: '/',
    suspended: false,
  };

  // Aggiunge il numero di telefono se disponibile
  if (telefono && String(telefono).trim()) {
    userRes.phones = [{
      value: String(telefono).trim(),
      type:  'mobile',
      primary: true,
    }];
  }

  // Qualifica (job title), reparto e organizzazione → visibili in Google Contacts
  userRes.organizations = [{
    name:       CONFIG.NOME_LEGALE,
    title:      tipo || '',
    department: gruppo || '',
    type:       'work',
    primary:    true,
  }];

  try {
    const u = AdminDirectory.Users.insert(userRes);
    traceLog_(`[Workspace] ✅ Utente creato: ${u.primaryEmail}`);
    esito.creato = true;
    esito.passwordTemporanea = true;
  } catch(err) {
    const msg = err.message || '';
    if (msg.includes('already exists') || msg.includes('Entity already exists')) {
      traceLog_(`[Workspace] Utente ${email} già esistente. Non resetto la password; aggiorno solo profilo/telefono.`);
      esito.esistente = true;
      try {
        const update = {};
        if (userRes.phones)        update.phones        = userRes.phones;
        if (userRes.organizations) update.organizations = userRes.organizations;
        if (Object.keys(update).length) {
          AdminDirectory.Users.update(update, email);
          esito.profiloAggiornato = true;
        }
      } catch(e2) {
        esito.warning = `Aggiornamento profilo non completato: ${e2.message}`;
        traceLog_(`[Workspace] WARN aggiornamento: ${e2.message}`);
      }
    } else {
      throw new Error(`[Workspace] Creazione fallita per ${email}: ${msg}`);
    }
  }

  // Aggiungi al gruppo
  const groupEmail = CONFIG.WORKSPACE_GROUPS[gruppo];
  esito.gruppoEmail = groupEmail || '';
  if (!groupEmail) { traceLog_(`[Workspace] WARN: gruppo "${gruppo}" non in CONFIG`); return esito; }

  Utilities.sleep(3000); // attende propagazione

  try {
    AdminDirectory.Members.insert({ email, role:'MEMBER' }, groupEmail);
    esito.gruppoAggiunto = true;
    traceLog_(`[Workspace] ✅ ${email} aggiunto a ${groupEmail}`);
  } catch(err) {
    const msg = err.message||'';
    if (msg.includes('already a member') || msg.includes('Member already exists')) {
      esito.giaNelGruppo = true;
      traceLog_(`[Workspace] ${email} già membro di ${groupEmail}`);
    } else {
      esito.warning = esito.warning ? (esito.warning + ' | Gruppo: ' + msg) : ('Gruppo: ' + msg);
      traceLog_(`[Workspace] WARN aggiunta gruppo: ${msg}`);
    }
  }
  return esito;
}

/**
 * Sospende l'utente Workspace e lo rimuove dal Google Group del suo gruppo.
 * Usata dall'espulsione (17_PresidenzaAdmin.gs) — non elimina l'account:
 * i dati (Drive, Gmail) restano recuperabili da un Super Admin se necessario.
 */
function sospendiUtenteWorkspace_(email, gruppo) {
  traceLog_(`[Workspace] Sospensione utente: ${email}`);
  AdminDirectory.Users.update({ suspended: true }, email);
  traceLog_(`[Workspace] ✅ Utente sospeso: ${email}`);

  const groupEmail = CONFIG.WORKSPACE_GROUPS[gruppo];
  if (!groupEmail) return;

  try {
    AdminDirectory.Members.remove(groupEmail, email);
    traceLog_(`[Workspace] ✅ ${email} rimosso da ${groupEmail}`);
  } catch(err) {
    const msg = err.message || '';
    if (!msg.includes('Resource Not Found') && !msg.includes('not found')) {
      traceLog_(`[Workspace] WARN rimozione da gruppo: ${msg}`);
    }
  }
}

function calcolaHashMD5_(str) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, str, Utilities.Charset.UTF_8);
  return bytes.map(b => (b<0?b+256:b).toString(16).padStart(2,'0')).join('');
}

// ═════════════════════════════════════════════════════════════════════════════
// MICROSOFT 365
// ═════════════════════════════════════════════════════════════════════════════

function creaUtenteM365_(nome, cognome, email, passwordTemp) {
  return creaUtenteM365Dettaglio_(nome, cognome, email, passwordTemp).ok;
}

function creaUtenteM365Dettaglio_(nome, cognome, email, passwordTemp) {
  const cfg = CONFIG.M365;
  const esito = {
    ok:false,
    creato:false,
    esistente:false,
    licenza:false,
    fase:'INIT',
    codice:'',
    dettaglio:'',
    warning:'',
  };

  if (!cfg.TENANT_ID || cfg.TENANT_ID.includes('INSERISCI')) {
    traceLog_('[M365] Configurazione mancante. Skip.');
    esito.fase = 'CONFIG';
    esito.codice = 'CONFIG_MANCANTE';
    esito.dettaglio = 'TENANT_ID non configurato.';
    return esito;
  }

  const tokenRes = getTokenM365Dettaglio_();
  if (!tokenRes.ok) {
    esito.fase = 'TOKEN';
    esito.codice = tokenRes.codice || 'TOKEN_FALLITO';
    esito.dettaglio = tokenRes.dettaglio || 'Token Microsoft Graph non disponibile.';
    return esito;
  }
  const token = tokenRes.token;

  const payload = {
    accountEnabled: true,
    displayName: `${nome} ${cognome}`,
    givenName: nome, surname: cognome,
    mailNickname: email.split('@')[0],
    userPrincipalName: email,
    usageLocation: 'IT',
    passwordProfile: { forceChangePasswordNextSignIn:true, password: passwordTemp },
  };

  const resp = UrlFetchApp.fetch('https://graph.microsoft.com/v1.0/users', {
    method:'post', contentType:'application/json',
    headers:{ 'Authorization':`Bearer ${token}` },
    payload: JSON.stringify(payload), muteHttpExceptions:true,
  });

  const code = resp.getResponseCode();
  const body = resp.getContentText();
  if (code === 201) {
    const userId = JSON.parse(body).id;
    traceLog_(`[M365] ✅ Utente creato: ${email}`);
    const licenza = assegnaLicenzaM365_(token, userId, email);
    esito.ok = true;
    esito.creato = true;
    esito.licenza = !!(licenza && licenza.ok);
    if (licenza && !licenza.ok) {
      esito.warning = 'Licenza non assegnata: ' + (licenza.dettaglio || licenza.codice || 'errore non specificato');
    }
    return esito;
  } else if (code === 409 || body.match(/already exists|same value|object.*exists/i)) {
    const err = estraiErroreGraph_(body);
    traceLog_(`[M365] Utente ${email} già esistente o presente tra gli utenti eliminati. Password NON impostata dallo script. Dettaglio: ${err.messaggio}`);
    esito.fase = 'CREATE_USER';
    esito.codice = err.codice || 'UTENTE_ESISTENTE';
    esito.dettaglio = 'Utente già esistente o in soft-delete: serve controllo manuale/reset password.';
    esito.esistente = true;
    return esito;
  }
  const err = estraiErroreGraph_(body);
  traceLog_(`[M365] ❌ Errore creazione ${email}: HTTP ${code} | ${err.codice} | ${err.messaggio}`);
  esito.fase = 'CREATE_USER';
  esito.codice = err.codice || ('HTTP_' + code);
  esito.dettaglio = err.messaggio || body;
  return esito;
}

function assegnaLicenzaM365_(token, userId, email) {
  const cfg = CONFIG.M365;
  if (!cfg.LICENSE_SKU_ID || cfg.LICENSE_SKU_ID.includes('INSERISCI')) {
    traceLog_('[M365] LICENSE_SKU_ID non configurato. Skip licenza.');
    return { ok:false, skipped:true, codice:'SKU_MANCANTE', dettaglio:'LICENSE_SKU_ID non configurato.' };
  }
  const resp = UrlFetchApp.fetch(`https://graph.microsoft.com/v1.0/users/${userId}/assignLicense`, {
    method:'post', contentType:'application/json',
    headers:{ 'Authorization':`Bearer ${token}` },
    payload: JSON.stringify({ addLicenses:[{ skuId:cfg.LICENSE_SKU_ID, disabledPlans:cfg.EXCLUDED_PLANS||[] }], removeLicenses:[] }),
    muteHttpExceptions:true,
  });
  if (resp.getResponseCode() === 200) {
    traceLog_(`[M365] ✅ Licenza assegnata a ${email}`);
    return { ok:true };
  }
  const err = estraiErroreGraph_(resp.getContentText());
  traceLog_(`[M365] ⚠️ Errore licenza ${email}: HTTP ${resp.getResponseCode()} | ${err.codice} | ${err.messaggio}`);
  return { ok:false, codice:err.codice || ('HTTP_' + resp.getResponseCode()), dettaglio:err.messaggio };
}

/**
 * Disattiva l'account M365 (accountEnabled:false) senza eliminarlo.
 * Usata dall'espulsione (17_PresidenzaAdmin.gs). Best-effort: un fallimento
 * qui non deve bloccare il resto del flusso di espulsione.
 */
function sospendiUtenteM365_(email) {
  const cfg = CONFIG.M365;
  if (!cfg.TENANT_ID || cfg.TENANT_ID.includes('INSERISCI')) {
    return { ok:false, codice:'CONFIG_MANCANTE', dettaglio:'M365 non configurato.' };
  }

  const tokenRes = getTokenM365Dettaglio_();
  if (!tokenRes.ok) return { ok:false, codice:tokenRes.codice, dettaglio:tokenRes.dettaglio };

  const resp = UrlFetchApp.fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}`, {
    method:'patch', contentType:'application/json',
    headers:{ 'Authorization':`Bearer ${tokenRes.token}` },
    payload: JSON.stringify({ accountEnabled:false }),
    muteHttpExceptions:true,
  });
  const code = resp.getResponseCode();
  if (code === 204) {
    traceLog_(`[M365] ✅ Utente disabilitato: ${email}`);
    return { ok:true };
  }
  if (code === 404) {
    traceLog_(`[M365] Utente ${email} non trovato (già assente).`);
    return { ok:true, assente:true };
  }
  const err = estraiErroreGraph_(resp.getContentText());
  traceLog_(`[M365] ❌ Errore disabilitazione ${email}: HTTP ${code} | ${err.codice} | ${err.messaggio}`);
  return { ok:false, codice:err.codice || ('HTTP_' + code), dettaglio:err.messaggio };
}

function getTokenM365_() {
  const res = getTokenM365Dettaglio_();
  return res.ok ? res.token : null;
}

function getTokenM365Dettaglio_() {
  const cfg   = CONFIG.M365;
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('M365_TOKEN');
  const expiry = parseInt(props.getProperty('M365_TOKEN_EXPIRY')||'0', 10);
  if (cached && Date.now() < expiry) return { ok:true, token:cached, cached:true };

  const resp = UrlFetchApp.fetch(`https://login.microsoftonline.com/${cfg.TENANT_ID}/oauth2/v2.0/token`, {
    method:'post', contentType:'application/x-www-form-urlencoded',
    payload: `client_id=${encodeURIComponent(cfg.CLIENT_ID)}&client_secret=${encodeURIComponent(cfg.CLIENT_SECRET)}&scope=${encodeURIComponent('https://graph.microsoft.com/.default')}&grant_type=client_credentials`,
    muteHttpExceptions:true,
  });
  if (resp.getResponseCode() !== 200) {
    const err = estraiErroreGraph_(resp.getContentText());
    traceLog_(`[M365] Token fallito: HTTP ${resp.getResponseCode()} | ${err.codice} | ${err.messaggio}`);
    return { ok:false, codice:err.codice || ('HTTP_' + resp.getResponseCode()), dettaglio:err.messaggio };
  }
  const data  = JSON.parse(resp.getContentText());
  const token = data.access_token;
  props.setProperty('M365_TOKEN', token);
  props.setProperty('M365_TOKEN_EXPIRY', String(Date.now() + ((data.expires_in||3600)-300)*1000));
  traceLog_('[M365] ✅ Token ottenuto');
  return { ok:true, token:token, cached:false };
}

function estraiErroreGraph_(body) {
  try {
    const data = JSON.parse(body || '{}');
    if (data.error) {
      if (typeof data.error === 'string') {
        return { codice:data.error, messaggio:data.error_description || body };
      }
      return {
        codice:data.error.code || '',
        messaggio:data.error.message || data.error_description || body,
      };
    }
  } catch(e) {}
  return { codice:'', messaggio:String(body || '') };
}

function diagnosticaM365Configurazione() {
  traceLog_('[M365-DIAG] START diagnostica configurazione');
  const tokenRes = getTokenM365Dettaglio_();
  if (!tokenRes.ok) {
    traceLog_('[M365-DIAG] STOP: token non ottenuto — ' + tokenRes.codice + ' — ' + tokenRes.dettaglio);
    return;
  }

  const token = tokenRes.token;
  [
    { label:'Organization', url:'https://graph.microsoft.com/v1.0/organization' },
    { label:'Subscribed SKUs', url:'https://graph.microsoft.com/v1.0/subscribedSkus' },
    { label:'Domains', url:'https://graph.microsoft.com/v1.0/domains' },
  ].forEach(function(test) {
    const resp = UrlFetchApp.fetch(test.url, {
      headers:{ 'Authorization':'Bearer ' + token },
      muteHttpExceptions:true,
    });
    const code = resp.getResponseCode();
    if (code >= 200 && code < 300) {
      traceLog_('[M365-DIAG] OK ' + test.label + ' HTTP ' + code);
    } else {
      const err = estraiErroreGraph_(resp.getContentText());
      traceLog_('[M365-DIAG] KO ' + test.label + ' HTTP ' + code + ' | ' + err.codice + ' | ' + err.messaggio);
    }
  });
  traceLog_('[M365-DIAG] END');
}
