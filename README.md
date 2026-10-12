# Nonprofit Membership Workflow

> **Beta** · Gestionale soci open-source su Google Apps Script per gli enti del Terzo Settore.
> *Open-source membership management for Italian non-profits (APS, ODV, ETS), built on Google Apps Script.*

Dalla domanda di ammissione alla tessera: un sistema completo che automatizza ammissioni, account, quote, libri sociali e comunicazioni. Sviluppato e mantenuto dall'**Orchestra Giovanile Percussioni APS ETS**.

📖 **Documentazione completa:** <https://newpercussion.it/workflow/>
- [Architettura](https://newpercussion.it/workflow/architettura/) — i moduli, i trigger, i fogli e i servizi esterni
- [Installazione](https://newpercussion.it/workflow/installazione/) — guida passo-passo, fasi A–J
- [Configuratore](https://newpercussion.it/workflow/configura/) — genera il pacchetto personalizzato nel browser
- [Conformità](https://newpercussion.it/workflow/conformita/) — cosa adattare allo statuto del tuo ente
- [Assistenza](https://newpercussion.it/workflow/assistenza/) — problemi frequenti e diagnostica

## L'idea di fondo: domanda e pagamento separati

Chi chiede di entrare e chi paga la quota sono due momenti distinti. La Presidenza valuta prima, e solo chi è stato ammesso riceve l'invito a versare la quota: nessuno compra l'adesione a un'associazione.

1. **Domanda** — modulo web dell'ente: anagrafica, documento, consensi e firma.
2. **Valutazione** — la Presidenza decide dal proprio pannello (l'unico passaggio manuale).
3. **Pagamento** — solo per i Soci Ordinari già ammessi, identificati con ID Pratica + codice fiscale.
4. **Onboarding** — email istituzionale, account, licenze, tessera, sblocco dei volontari collegati, notifiche.
5. **Benvenuto** — tessera con QR reale, firma Gmail, email di benvenuto.

I volontari non versano quota; un volontario minorenne indica il genitore già Socio Ordinario e la sua pratica si sblocca da sola quando il genitore è ammesso e in regola.

## Contenuto del repository

```
src/                      Sorgenti pubblici con segnaposto {{TOKEN}}
  0_Secrets.gs            Valori sensibili (qui solo segnaposto)
  1_CONFIG_V8.gs          Configurazione globale
  2_ … 22_*.gs            Moduli Apps Script
  12_footer               Footer di attribuzione delle email
  *HTML.html              Le quattro pagine delle web app
  appsscript.json         Manifest (servizi avanzati, web app)
  Template_Tessera.pptx   Template della tessera associativa
  LICENSE.txt             Licenza inclusa nel pacchetto
stripe-webhook-proxy/     Cloudflare Worker tra Stripe e Apps Script
LICENSE                   Licenza duale
```

| Modulo | Ruolo | |
|---|---|---|
| `0_Secrets.gs` | Contenitore unico dei valori sensibili | Core |
| `1_CONFIG_V8.gs` | Identità dell'ente, mappa colonne, design email, cessazioni, trigger | Core |
| `2_TriggerAmmissione.gs` | Ammissione, rifiuto, lavori differiti, onboarding, recupero | Core |
| `3_StripeAdmin.gs` | Abbonamenti, rinnovi, morosità, annullamenti, rimborsi | Opzionale |
| `4_WorkspaceAdmin.gs` | Account Google Workspace e Microsoft 365, gruppi di dominio | Opzionale |
| `5_TesseraGenerator.gs` | Tessera PDF da template Slides, con QR | Opzionale |
| `6_Mail.gs` | Circa venticinque email transazionali HTML | Core |
| `7_RouterModuli.gs` | Presa in carico domande, doppi invii, legame volontario–genitore | Core |
| `8_NotificheChat.gs` | Notifiche Google Chat con coda notturna | Opzionale |
| `9_MembroPortal.gs` | Portale membri (progetto Apps Script separato) | Opzionale |
| `10_GmailFirma.gs` | Firma Gmail istituzionale via delega di dominio | Opzionale |
| `11_Tracer.gs` | Diario di bordo con mascheramento dei segreti | Opzionale |
| `12_footer` | Footer di attribuzione nelle email esterne | Core |
| `13_TestFeedback.gs` | Prova grafica dell'email di benvenuto con dati fittizi | Opzionale |
| `14_IntegrazioneFinanza.gs` | Ricevuta PDF e registro movimenti contabili | Opzionale |
| `15_ModuloIscrizioneWebApp.gs` | Router unico delle web app e Fase 1 (domanda) | Core |
| `16_ModuloPagamentoWebApp.gs` | Fase 2 (pagamento quota) | Opzionale |
| `17_PresidenzaAdmin.gs` | Pannello della Presidenza | Core |
| `18_PresidenzaAdminAPI.gs` | Azioni del pannello in JSON per l'app mobile | Opzionale |
| `19_SupabaseSync.gs` | Sincronizzazione con l'app mobile (mai bloccante) | Opzionale |
| `20_LibriSociali.gs` | Libro degli associati e registro dei volontari | Core |
| `21_RegistroEventi.gs` | Registro eventi in sola aggiunta con catena SHA-256 | Opzionale |
| `22_LiberatoriaWebApp.gs` | Liberatoria immagini firmata, revocabile | Opzionale |

**Nucleo minimo:** i moduli 0, 1, 2, 6, 7, 12, 15, 17 e 20, più le pagine del modulo di iscrizione e del pannello. Non richiede né Google Workspace né un servizio di pagamento.

## Installazione rapida

1. Genera il pacchetto personalizzato con il [Configuratore](https://newpercussion.it/workflow/configura/) (tutto avviene nel browser), **oppure** sostituisci a mano i segnaposto `{{TOKEN}}` in `src/`.
2. Dal foglio dati apri *Estensioni › Apps Script* e crea un file per ciascun modulo (0–8 e 10–22) e le quattro pagine HTML, mantenendo gli stessi nomi.
3. Sostituisci il manifest con `src/appsscript.json` e imposta il fuso orario su `Europe/Rome`.
4. Pubblica la web app (*Esegui come: me*, *Accesso: chiunque*).
5. Esegui una sola volta `inizializzaColonneAggiuntive()` e `installaTriggers()`.
6. Se usi Stripe, pubblica il Worker in [`stripe-webhook-proxy/`](stripe-webhook-proxy/): Apps Script risponde ai POST con un redirect 302 che Stripe non segue.

La procedura completa, con collaudo e libri sociali, è nella [guida all'installazione](https://newpercussion.it/workflow/installazione/).

> [!WARNING]
> **Credenziali.** I sorgenti di questo repository contengono solo segnaposto. Dopo la configurazione il tuo `0_Secrets.gs` conterrà chiavi reali: non caricarlo su repository pubblici, non inviarlo per email e, se esposto, ruota subito le chiavi. Per una configurazione più solida sposta i valori nelle *Script Properties* del progetto.

> [!IMPORTANT]
> Ogni modifica al codice delle web app richiede una **nuova versione del deployment** (*Deploy › Manage deployments › Edit › New version*): salvare nell'editor non aggiorna ciò che risponde all'URL `/exec`.

## Licenza

Il software è di proprietà dell'**Orchestra Giovanile Percussioni APS ETS** ed è sviluppato da **Alessio Ciocca**. È distribuito con **licenza duale** (vedi [`LICENSE`](LICENSE)):

- **Uso non-profit — gratuito.** Enti senza scopo di lucro formalmente costituiti (APS, ODV, ETS ai sensi del D.Lgs. 117/2017, o equivalenti esteri), per le attività istituzionali interne.
- **Uso commerciale — su licenza.** Aziende, liberi professionisti e soggetti for-profit devono richiedere una licenza prima dell'utilizzo. I proventi sono reinvestiti nelle attività dell'associazione.
- **Attribuzione.** Le email inviate verso l'esterno mantengono il footer automatico (`12_footer`), che nomina soltanto l'associazione.

Il software non contiene alcun meccanismo di verifica della licenza: non chiama casa e non si disattiva.

Licenze commerciali e informazioni: **direzione@newpercussion.it** — <https://newpercussion.it/workflow/>
