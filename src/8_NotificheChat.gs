/**
 * MODULO: 8_NotificheChat.gs
 * ══════════════════════════════════════════════════════════════════════
 * Gestione notifiche Google Chat con coda per invio differito fuori orario.
 * Finestra di invio: 09:00 – 22:30.
 *
 * PREREQUISITI:
 *  - CHAT_WEBHOOK_URL_RICHIESTE in CONFIG deve essere valido e attivo
 *  - Google Calendar API (servizio avanzato) abilitato per il link Meet
 *    (opzionale — se non abilitato la notifica viene inviata senza pulsante Meet)
 */

function isWithinNotificationWindow_() {
  const now = new Date();
  const t   = now.getHours() * 60 + now.getMinutes();
  return t >= 540 && t <= 1350; // 09:00–22:30
}

function generaLinkMeet_() {
  try {
    const now   = new Date();
    const event = {
      summary: 'Riunione Pratica {{NOME_GRUPPO}}',
      start: { dateTime: now.toISOString() },
      end:   { dateTime: new Date(now.getTime() + 30 * 60000).toISOString() },
      conferenceData: {
        createRequest: {
          requestId: Utilities.getUuid(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };
    const created = Calendar.Events.insert(event, CONFIG.CALENDAR_ID, { conferenceDataVersion: 1 });
    if (created.conferenceData && created.conferenceData.entryPoints) {
      const ep = created.conferenceData.entryPoints.find(function(ep2) { return ep2.entryPointType === 'video'; });
      if (ep && ep.uri) {
        try { Calendar.Events.remove(CONFIG.CALENDAR_ID, created.id); } catch(e) {}
        return ep.uri;
      }
    }
  } catch (err) {
    traceLog_('[Chat] generaLinkMeet_ non disponibile: ' + err.message);
  }
  return null;
}

function inviaNotificaNuovaPratica(tipoAssociato, nomeRichiedente, nomeGenitore, idPratica) {
  if (!webhookChatValido_(CONFIG.CHAT_WEBHOOK_URL_RICHIESTE)) {
    traceLog_('[Chat] SKIP: CHAT_WEBHOOK_URL_RICHIESTE non configurato.');
    return;
  }
  const dati = {
    tipoAssociato: tipoAssociato,
    nomeRichiedente: nomeRichiedente,
    nomeGenitore: nomeGenitore,
    idPratica: idPratica,
  };
  dati.dedupeKey = chiaveNotificaChat_(dati);
  if (!isWithinNotificationWindow_()) {
    accodaNotifica_(dati);
  } else {
    eseguiInvioChat_(dati);
  }
}

function chiaveNotificaChat_(dati) {
  return [
    dati.tipoAssociato || '',
    dati.nomeRichiedente || '',
    dati.nomeGenitore || '',
    dati.idPratica || '',
  ].join('|').toLowerCase().trim();
}

function accodaNotifica_(dati) {
  const lock  = LockService.getScriptLock();
  const props = PropertiesService.getScriptProperties();
  try {
    lock.waitLock(5000);
    const codaStr = props.getProperty(CONFIG.NOME_CODA_PROPRIETA);
    let coda = [];
    if (codaStr) {
      try {
        coda = JSON.parse(codaStr);
      } catch (e) {
        const backupKey = CONFIG.NOME_CODA_PROPRIETA + '_CORROTTA_' + Date.now();
        props.setProperty(backupKey, codaStr);
        traceLog_('[Chat] WARN: coda corrotta. Backup creato: ' + backupKey);
        coda = [];
      }
    }
    const key = dati.dedupeKey || chiaveNotificaChat_(dati);
    const giaAccodata = coda.some(function(item) {
      return (item.dedupeKey || chiaveNotificaChat_(item)) === key;
    });
    if (giaAccodata) {
      traceLog_('[Chat] Notifica già accodata per "' + dati.nomeRichiedente + '". Nessun duplicato.');
      return;
    }
    coda.push(dati);
    props.setProperty(CONFIG.NOME_CODA_PROPRIETA, JSON.stringify(coda));
    traceLog_('[Chat] Notifica accodata per "' + dati.nomeRichiedente + '". Verrà inviata alle 09:00.');
  } finally {
    lock.releaseLock();
  }
}

function processaCodaNotifiche() {
  const lock    = LockService.getScriptLock();
  const props   = PropertiesService.getScriptProperties();
  let coda = [];

  try {
    lock.waitLock(5000);
    const codaStr = props.getProperty(CONFIG.NOME_CODA_PROPRIETA);
    if (!codaStr) { traceLog_('[Chat] Coda vuota.'); return; }
    try {
      coda = JSON.parse(codaStr);
    } catch (e) {
      const backupKey = CONFIG.NOME_CODA_PROPRIETA + '_CORROTTA_' + Date.now();
      props.setProperty(backupKey, codaStr);
      props.deleteProperty(CONFIG.NOME_CODA_PROPRIETA);
      traceLog_('[Chat] WARN: coda corrotta. Ripulita e salvata in backup: ' + backupKey);
      return;
    }
    props.deleteProperty(CONFIG.NOME_CODA_PROPRIETA);
  } finally {
    lock.releaseLock();
  }

  if (!coda.length) return;
  traceLog_('[Chat] Svuotamento coda: ' + coda.length + ' notifiche.');
  const fallite = [];
  coda.forEach(function(d) {
    const ok = eseguiInvioChat_(d);
    if (!ok) fallite.push(d);
    Utilities.sleep(1500);
  });

  if (fallite.length) {
    try {
      lock.waitLock(5000);
      let residue = [];
      const residuoStr = props.getProperty(CONFIG.NOME_CODA_PROPRIETA);
      if (residuoStr) {
        try { residue = JSON.parse(residuoStr); } catch (e) { residue = []; }
      }
      props.setProperty(CONFIG.NOME_CODA_PROPRIETA, JSON.stringify(fallite.concat(residue)));
      traceLog_('[Chat] Re-accodate ' + fallite.length + ' notifiche non inviate.');
    } finally {
      lock.releaseLock();
    }
  }
}

function eseguiInvioChat_(dati) {
  traceLog_('[Chat] Invio — tipo: "' + dati.tipoAssociato + '" — nome: "' + dati.nomeRichiedente + '"');

  var testo;
  if (dati.tipoAssociato === 'Socio Ordinario') {
    testo = '<b>' + dati.nomeRichiedente + '</b> ha richiesto di entrare nell\'associazione come <b>Socio Ordinario</b>.';
  } else if (dati.tipoAssociato === 'Volontario') {
    var g = dati.nomeGenitore || 'Genitore non specificato';
    testo = '<b>' + dati.nomeRichiedente + '</b>, figlio/a di <b>' + g + '</b>, ha richiesto di entrare come <b>Volontario</b>.';
  } else {
    testo = '<b>' + dati.nomeRichiedente + '</b> ha inviato una nuova richiesta: ' + dati.tipoAssociato + '.';
  }

  var meetUrl = generaLinkMeet_();
  var buttons = [{ text: 'Vedi richiesta', onClick: { openLink: { url: getLinkPresidenza_(dati.idPratica) } } }];
  if (meetUrl) {
    // Il campo "color" sui bottoni non è supportato dai webhook incoming — rimosso per evitare HTTP 400
    buttons.push({
      text: 'Avvia riunione',
      onClick: { openLink: { url: meetUrl } },
    });
  }

  var card = {
    cardsV2: [{
      cardId: 'nuova_pratica_' + Date.now(),
      card: {
        header: {
          title:    'Richiesta di ammissione',
          subtitle: dati.tipoAssociato,
          imageUrl: CONFIG.LOGO_URL,
          imageType: 'CIRCLE',
        },
        sections: [{
          widgets: [
            { textParagraph: { text: testo } },
            { buttonList: { buttons: buttons } },
          ],
        }],
      },
    }],
  };

  var esito = inviaPayloadChat_(CONFIG.CHAT_WEBHOOK_URL_RICHIESTE, card, 'Chat Richieste');
  if (esito.ok) {
    traceLog_('[Chat] ✅ Notifica inviata (HTTP 200).');
    return true;
  }
  if (!esito.skipped) {
    traceLog_('[Chat] ❌ Invio fallito — ' + (esito.code ? ('HTTP ' + esito.code) : (esito.error || 'errore sconosciuto')));
  }
  return false;
}

/** Test webhook — esegui dall'editor per verificare */
function testNotificaChat() {
  eseguiInvioChat_({
    tipoAssociato:   'Socio Ordinario',
    nomeRichiedente: 'Mario Rossi (TEST)',
    nomeGenitore:    null,
    idPratica:       'PR-00000',
  });
}
