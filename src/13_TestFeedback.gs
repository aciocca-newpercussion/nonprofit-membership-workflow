/**
 * MODULO: 13_TestFeedback.gs
 * ══════════════════════════════════════════════════════════════════════
 * Script di test per verificare la visualizzazione e il link del box di
 * feedback inserito nella email di benvenuto.
 *
 * Invia email reali all'indirizzo di test specificato.
 */

/**
 * Invia una email di benvenuto di test per un Socio Ordinario.
 * Destinatario: {{EMAIL_ADMIN_ERRORI}}
 */
function testEmailFeedbackSocioOrdinario() {
  const targetEmail = '{{EMAIL_ADMIN_ERRORI}}';
  const I = CONFIG.IDX;

  Logger.log('=== TEST FEEDBACK EMAIL: SOCIO ORDINARIO ===');
  Logger.log('Preparazione dati mock per ' + targetEmail + '...');

  // Inizializza array con indici corretti del foglio
  const rowData = [];
  rowData[I.NOME_SOCIO] = 'Mario';
  rowData[I.COGNOME_SOCIO] = 'Rossi';
  rowData[I.CF_SOCIO] = 'RSSMRA80A01H501U';
  rowData[I.DATA_NASCITA_SOCIO] = new Date(1980, 0, 1);
  rowData[I.EMAIL_SOCIO] = targetEmail;
  rowData[I.TEL_SOCIO] = '+393331234567';
  rowData[I.ID_PRATICA] = 'TEST-SOCIO-12345';
  rowData[I.SESSO_SOCIO] = 'M';
  rowData[I.GRUPPO] = 'Assemblea dei Soci';

  const dataAmmObj = new Date();
  const dataScadenza = new Date();
  dataScadenza.setFullYear(dataScadenza.getFullYear() + 1);

  try {
    Logger.log('Invocazione di inviaEmailBenvenuto_ per Socio Ordinario...');
    inviaEmailBenvenuto_(
      rowData,
      'Socio Ordinario',
      '{{EMAIL_ADMIN_ERRORI}}', // email istituzionale di test
      'P@sswordTemporanea1!',            // password temporanea di test
      null,                              // null per evitare la generazione/allegato del PDF reale
      dataAmmObj,
      dataScadenza,
      true,                              // wsOk = true (mostra il blocco Workspace)
      true,                              // m365Ok = true (mostra il blocco Microsoft 365)
      'https://{{SITO_WEB}}',    // url tessera fittizio
      true                               // wsPasswordDisponibile = true
    );
    Logger.log('✅ Email di test inviata con successo a: ' + targetEmail);
  } catch (err) {
    Logger.log('❌ Errore durante l\'invio dell\'email: ' + err.toString());
  }
}

/**
 * Invia una email di benvenuto di test per un Volontario (con le differenze di testo).
 * Destinatario: {{EMAIL_ADMIN_ERRORI}}
 */
function testEmailFeedbackVolontario() {
  const targetEmail = '{{EMAIL_ADMIN_ERRORI}}';
  const I = CONFIG.IDX;

  Logger.log('=== TEST FEEDBACK EMAIL: VOLONTARIO ===');
  Logger.log('Preparazione dati mock per ' + targetEmail + '...');

  // Inizializza array con indici corretti del foglio
  const rowData = [];
  rowData[I.NOME_VOLONTARIO] = 'Mario';
  rowData[I.COGNOME_VOLONTARIO] = 'Rossi';
  rowData[I.CF_VOLONTARIO] = 'RSSMRA80A01H501U';
  rowData[I.DATA_NASCITA_VOLONTARIO] = new Date(1980, 0, 1);
  rowData[I.EMAIL_VOLONTARIO] = targetEmail;
  rowData[I.TEL_VOLONTARIO] = '+393331234567';
  rowData[I.ID_PRATICA] = 'TEST-VOL-12345';
  rowData[I.SESSO_VOLONTARIO] = 'M';
  rowData[I.GRUPPO] = 'Volontari';

  const dataAmmObj = new Date();
  const dataScadenza = new Date();
  dataScadenza.setFullYear(dataScadenza.getFullYear() + 1);

  try {
    Logger.log('Invocazione di inviaEmailBenvenuto_ per Volontario...');
    inviaEmailBenvenuto_(
      rowData,
      'Volontario',
      '{{EMAIL_ADMIN_ERRORI}}', // email istituzionale di test
      'P@sswordTemporanea1!',            // password temporanea di test
      null,                              // null per evitare la generazione/allegato del PDF reale
      dataAmmObj,
      dataScadenza,
      true,                              // wsOk = true (mostra il blocco Workspace)
      true,                              // m365Ok = true (mostra il blocco Microsoft 365)
      'https://{{SITO_WEB}}',    // url tessera fittizio
      true                               // wsPasswordDisponibile = true
    );
    Logger.log('✅ Email di test inviata con successo a: ' + targetEmail);
  } catch (err) {
    Logger.log('❌ Errore durante l\'invio dell\'email: ' + err.toString());
  }
}
